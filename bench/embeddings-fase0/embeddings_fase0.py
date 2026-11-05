"""Fase 0 de docs/plan-embeddings-estaticos.md: ¿los embeddings estáticos mejoran la biblioteca?

Solo mide; no toca la app. Reproduce en Python el BM25 de src-tauri/src/library.rs (mismos
fragmentos, raíces, pesos y «coincidencia débil») y la cuenta de `agent::tests::editorial_benchmark`
(incluida la reformulación simulada de AC-189), y lo compara con coseno y con BM25 + coseno (RRF).

Uso (con el entorno de Python que ya tiene numpy, tokenizers, safetensors, model2vec y psutil):

    python -I bench/embeddings-fase0/embeddings_fase0.py --models D:/dev-cache/emb-models

`--models` es la carpeta con los dos modelos bajados de Hugging Face
(minishlab/potion-multilingual-128M y sentence-transformers/static-similarity-mrl-multilingual-v1,
cada uno en una subcarpeta con su nombre). Imprime las tablas; con `--out archivo.json` guarda además
todo el detalle (puestos por pregunta, barrido del umbral, costos).
"""

import argparse
import json
import math
import os
import sys
import time
import unicodedata
from collections import Counter
from pathlib import Path

import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
FIX = HERE.parent.parent / "tests" / "fixtures"

# ── BM25 de library.rs, línea por línea ──────────────────────────────────────

CHUNK_CHARS = 1000
ROOT_CHARS = 4
LIBRARY_HITS = 4
STOPWORDS = set(
    "el la los las un una unos unas de del al y o u e a en por para con sin que se su sus es son como mas pero lo le "
    "les esta este esto estos estas ese esa eso cual cuales muy ya si no ni hay fue ser sobre entre cuando donde porque tambien the of and "
    "to in is for on with as by an be this that are it or from at which qué que cómo".split()
)
FOLD = {**dict.fromkeys("áàâäã", "a"), **dict.fromkeys("éèêë", "e"), **dict.fromkeys("íìîï", "i"), **dict.fromkeys("óòôöõ", "o"), **dict.fromkeys("úùûü", "u"), "ñ": "n", "ç": "c"}


def normalize(text):  # graph::normalize
    out = []
    for ch in text:
        for c in ch.lower():
            c = FOLD.get(c, c if c.isalnum() else " ")
            if c == " ":
                if out and out[-1] != " ":
                    out.append(" ")
            else:
                out.append(c)
    return "".join(out).rstrip()


def stem(w):
    long = lambda s: len(s) >= 4
    s = w
    if s.endswith("mente") and long(s[:-5]):
        s = s[:-5]
    if s.endswith("s") and long(s[:-1]):
        s = s[:-1]
    if s.endswith("e") and long(s[:-1]):
        s = s[:-1]
    return s


def concepts(text):
    out = []
    for w in normalize(text).split():
        if len(w) > 1 and w not in STOPWORDS:
            s = stem(w)
            root = s[:ROOT_CHARS]
            root = "~" + root if len(root.encode()) < len(s.encode()) else None
            out.append((s, root, w))
    return out


def terms(text):
    return [t for s, r, _ in concepts(text) for t in ([s] if r is None else [s, r])]


def query_words(q):
    return len({s for s, _, _ in concepts(q)})


def page_marker(line):
    t = line.strip()
    if t.startswith("<!-- p:") and t.endswith("-->"):
        try:
            return int(t[7:-3].strip())
        except ValueError:
            return None
    return None


def sections(markdown):
    out, page = [], None
    cur = {"title": "Inicio", "level": 0, "page": None, "md": ""}
    lines = markdown.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    for line in lines:
        line = line.rstrip("\r")
        p = page_marker(line)
        if p is not None:
            page = p
        h = len(line) - len(line.lstrip("#"))
        if 1 <= h <= 3 and line[h:].startswith(" ") and line[h:].strip():
            if cur["md"].strip() or cur["level"] > 0:
                out.append(cur)
            cur = {"title": line[h:].strip(), "level": h, "page": page, "md": f"<!-- p:{page} -->\n\n" if page is not None else ""}
            continue
        cur["md"] += line + "\n"
    if cur["md"].strip() or cur["level"] > 0:
        out.append(cur)
    for s in out:
        s["md"] = s["md"].strip()
        if s["page"] is None:
            s["page"] = next((page_marker(l) for l in s["md"].split("\n") if page_marker(l) is not None), None)
    out = [s for s in out if s["level"] > 0 or any(l.strip() and page_marker(l) is None for l in s["md"].split("\n"))]
    for i, s in enumerate(out):
        s["id"] = i
    return out


def path(secs, i):
    parts, level = [secs[i]["title"]], secs[i]["level"]
    for s in reversed(secs[:i]):
        if 0 < s["level"] < level:
            parts.append(s["title"])
            level = s["level"]
    return " › ".join(reversed(parts))


def chunks(secs):
    out = []
    for s in secs:
        page = start = s["page"]
        text = ""
        for para in s["md"].split("\n\n"):
            p = page_marker(para)
            if p is not None:
                page = p
                if not text:
                    start = page
                continue
            para = para.strip()
            if not para:
                continue
            if text and len(text.encode()) + len(para.encode()) > CHUNK_CHARS:
                out.append({"section": s["id"], "page": start, "text": text})
                text, start = "", page
            text = text + "\n\n" + para if text else para
        if text:
            out.append({"section": s["id"], "page": start, "text": text})
    return out


class Library:
    """Index de library.rs. `books` va del más nuevo al más viejo, como `LibraryStore::all`."""

    def __init__(self, books):
        self.chunks = []  # (book title, path, chunk)
        self.tf, self.len = [], []
        for title, md in books:
            secs = sections(md)
            paths = [path(secs, i) for i in range(len(secs))]
            for c in chunks(secs):
                m = Counter()
                for t in terms(c["text"]):
                    m[t] += 1.0
                for t in terms(paths[c["section"]]):
                    m[t] += 2.0
                self.chunks.append({"book": title, "path": paths[c["section"]], **c})
                self.tf.append(m)
                self.len.append(sum(m.values()))
        self.df = Counter(t for m in self.tf for t in m)
        self.n = len(self.chunks)
        self.avg = max(sum(self.len) / self.n, 1.0)

    def concepts_of(self, query):
        cs = sorted(concepts(query), key=lambda c: (c[0], c[1] is not None, c[1] or "", c[2]))
        out = []
        for c in cs:
            if not out or out[-1][0] != c[0]:
                out.append(c)
        return out

    def matched(self, cs, i):
        tf = self.tf[i]
        return [w for s, r, w in cs if s in tf or (r is not None and r in tf)]

    def scores(self, query):
        """Every chunk's BM25 score (0 when nothing matches)."""
        q = set(terms(query))
        idf = {t: math.log((self.n - self.df[t] + 0.5) / (self.df[t] + 0.5) + 1.0) for t in q if t in self.df}
        k1, b = 1.2, 0.75
        out = []
        for i, tf in enumerate(self.tf):
            s = sum(v * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * self.len[i] / self.avg)) for t, v in idf.items() if t in tf)
            out.append(s)
        return out

    def bm25_weak(self, query):
        """Per chunk: what BM25 says about it (`Hit::weak`, or nothing in common)."""
        cs = self.concepts_of(query)
        sc = self.scores(query)
        return [sc[i] <= 0 or (len(cs) >= 3 and len(self.matched(cs, i)) < 2) for i in range(self.n)], sc, cs

    def search(self, query, limit):
        if not set(terms(query)):
            return []
        sc = self.scores(query)
        order = sorted((i for i in range(self.n) if sc[i] > 0), key=lambda i: -sc[i])  # stable, like sort_by
        cs = self.concepts_of(query)
        return [self.hit(i, cs, sc[i]) for i in order[:limit]]

    def hit(self, i, cs, score, weak=None):
        words = self.matched(cs, i)
        return {"i": i, "section": self.chunks[i]["path"], "score": score, "matched": words, "weak": (len(cs) >= 3 and len(words) < 2) if weak is None else weak, "text": self.chunks[i]["text"]}


def hint(hits, query, hopeless_if_weak=True, top_ok=None):
    """agent::library_search (AC-189): (asks for a reformulation, hopeless)."""
    if not hits:
        return True, True
    all_weak = all(h["weak"] for h in hits)
    partial = len(hits[0]["matched"]) * 2 < query_words(query)
    if top_ok is not None and top_ok(hits[0]):
        partial = False
    return all_weak or partial, all_weak


# ── Embeddings estáticos ─────────────────────────────────────────────────────


class Static:
    """Promedio de las filas de los tokens (sin tokens especiales), normalizado: lo que hacen
    model2vec y StaticEmbedding de sentence-transformers. `dim` recorta (Matryoshka)."""

    def __init__(self, name, tokenizer, weights, key, dim=None, drop_unk=False, int8=False):
        self.name, self.dim = name, dim
        self.tok = Tokenizer.from_file(str(tokenizer))
        e = load_file(str(weights))[key]
        if dim:
            e = np.ascontiguousarray(e[:, :dim])
        if int8:  # una escala por fila, como propone el plan (3.1)
            scale = np.abs(e).max(axis=1, keepdims=True) / 127.0
            scale[scale == 0] = 1.0
            e = (np.round(e / scale).astype(np.int8).astype(np.float32) * scale).astype(np.float32)
        self.e = e
        self.unk = self.tok.token_to_id("[UNK]") if drop_unk else None

    def encode(self, texts):
        out = np.zeros((len(texts), self.e.shape[1]), dtype=np.float32)
        for k, enc in enumerate(self.tok.encode_batch(list(texts), add_special_tokens=False)):
            ids = [t for t in enc.ids if t != self.unk]
            if ids:
                v = self.e[ids].mean(axis=0)
                out[k] = v / (np.linalg.norm(v) or 1.0)
        return out


def model_specs(root):
    p = root / "potion-multilingual-128M"
    s = root / "static-similarity-mrl-multilingual-v1" / "0_StaticEmbedding"
    return {
        "potion-multilingual-128M": dict(tokenizer=p / "tokenizer.json", weights=p / "model.safetensors", key="embeddings", drop_unk=True),
        "static-mrl-1024": dict(tokenizer=s / "tokenizer.json", weights=s / "model.safetensors", key="embedding.weight"),
        "static-mrl-256": dict(tokenizer=s / "tokenizer.json", weights=s / "model.safetensors", key="embedding.weight", dim=256),
    }


# ── Búsqueda híbrida (plan 3.4) ──────────────────────────────────────────────

RRF_K, TOP = 60, 50


class Hybrid:
    def __init__(self, lib, model, priority="none", threshold=0.0):
        self.lib, self.model, self.priority, self.t = lib, model, priority, threshold
        t0 = time.perf_counter()
        # What BM25 also sees: the section path and the chunk.
        self.vecs = model.encode([c["path"] + "\n" + c["text"] for c in lib.chunks])
        self.embed_s = time.perf_counter() - t0

    def cos(self, query):
        return self.vecs @ self.model.encode([query])[0]

    def search(self, query, limit, mode="hybrid"):
        weak_b, sc, cs = self.lib.bm25_weak(query)
        cos = self.cos(query)
        qw = query_words(query)
        if mode == "cosine":
            order = sorted(range(self.lib.n), key=lambda i: -cos[i])
        else:
            bm = sorted((i for i in range(self.lib.n) if sc[i] > 0), key=lambda i: -sc[i])[:TOP]
            cv = sorted(range(self.lib.n), key=lambda i: -cos[i])[:TOP]
            rrf = Counter()
            for r, i in enumerate(bm, 1):
                rrf[i] += 1 / (RRF_K + r)
            for r, i in enumerate(cv, 1):
                rrf[i] += 1 / (RRF_K + r)
            def first(i):  # exact-match priority
                m = len(self.lib.matched(cs, i))
                if self.priority == "all":
                    return cs and m == len(cs)
                if self.priority == "strong":
                    return not weak_b[i] and m * 2 >= qw
                return False
            order = sorted(rrf, key=lambda i: (not first(i), -rrf[i]))
        # Weak only when both signals are low (plan 3.4).
        return [dict(self.lib.hit(i, cs, sc[i], weak=weak_b[i] and cos[i] < self.t), cos=float(cos[i])) for i in order[:limit]]

    def hint(self, hits, query):
        # The AC-189 trigger, except that a top passage similar in meaning is not "partial".
        return hint(hits, query, top_ok=lambda h: h["cos"] >= self.t)


# ── El benchmark (la cuenta de editorial_benchmark) ──────────────────────────


def run_set(items, field, search, hint_of, retry=None, want_of=lambda it: it["section"]):
    n = len(items)
    top1 = top4 = top1_r = top4_r = asked = gave_up = 0
    ranks = []
    for it in items:
        q = it[field]
        want = want_of(it)
        hits = search(q)
        rank = next((k for k, h in enumerate(hits) if h["section"].endswith(want)), None)
        top4 += rank is not None
        top1 += rank == 0
        ask, _ = hint_of(hits, q)
        again, rank2 = [], None
        if ask and retry and retry.get(q):
            asked += 1
            again = search(retry[q])
            rank2 = next((k for k, h in enumerate(again) if h["section"].endswith(want)), None)
            _, hopeless = hint_of(again, retry[q])
            gave_up += rank2 is not None and hopeless
        elif ask:
            asked += 1
        top4_r += rank is not None or rank2 is not None
        top1_r += (rank == 0) if not again else (rank2 == 0)
        ranks.append({"q": q, "rank": rank, "retry": bool(again), "rank2": rank2})
    return {"n": n, "at1": top1 / n, "at4": top4 / n, "hint": asked / n, "at1_r": top1_r / n, "at4_r": top4_r / n, "gave_up_on_found": gave_up, "ranks": ranks}


def negatives(search, queries):
    out = []
    for q in queries:
        hits = search(q)
        out.append({"q": q, "hits": len(hits), "all_weak": all(h["weak"] for h in hits), "top_cos": max((h.get("cos", 0) for h in hits), default=0)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="D:/dev-cache/emb-models")
    ap.add_argument("--out", help="where to write every number as JSON (optional)")
    ap.add_argument("--repo", default=str(HERE.parent.parent), help="the Eureka repo (its tests/fixtures)")
    args = ap.parse_args()
    global FIX
    FIX = Path(args.repo) / "tests" / "fixtures"
    import psutil

    proc = psutil.Process()
    md = (FIX / "libro-editorial.md").read_text(encoding="utf-8")
    q = json.loads((FIX / "libro-editorial.questions.json").read_text(encoding="utf-8"))
    retry = json.loads((FIX / "libro-editorial.retry.json").read_text(encoding="utf-8"))
    cross = json.loads((HERE / "cross-language.json").read_text(encoding="utf-8"))
    title = "Fermentación en la cocina andina"
    es = Library([(title, md)])
    both = Library([(cross["title"], cross["markdown"]), (title, md)])  # newest first
    negs = [n["search"] for n in q["negative"]]
    near = cross["near_negative"]
    retry_en = {it["question"]: it["reformulation_en"] for it in cross["questions"]}
    sets = [("search", q["questions"], "search", None), ("question", q["questions"], "question", None), ("hard", q["hard"], "question", retry["hard"])]
    report = {"chunks_es": es.n, "chunks_both": both.n}

    # 1. BM25: must match libro-editorial.retrieval.json (the Rust benchmark).
    bm = {}
    for name, items, field, rt in sets:
        bm[name] = run_set(items, field, lambda x: es.search(x, LIBRARY_HITS), hint, rt)
    bm["cross"] = run_set(cross["questions"], "question", lambda x: both.search(x, LIBRARY_HITS), hint, retry_en)
    bm["negative"] = negatives(lambda x: es.search(x, LIBRARY_HITS), negs)
    bm["negative_retry"] = negatives(lambda x: es.search(x, LIBRARY_HITS), [retry["negative"][x] for x in negs])
    bm["near_negative"] = negatives(lambda x: es.search(x, LIBRARY_HITS), near)
    rust = json.loads((FIX / "libro-editorial.retrieval.json").read_text(encoding="utf-8"))
    parity = {k: (round(bm[k]["at1"], 4) == round(rust[k]["section_at_1"], 4) and round(bm[k]["at4"], 4) == round(rust[k]["section_at_4"], 4) and round(bm[k]["hint"], 4) == round(rust[k]["retry_hint"], 4)) for k in ("search", "question", "hard")}
    parity["hard_reformulated"] = round(bm["hard"]["at1_r"], 4) == round(rust["hard_reformulated"]["section_at_1"], 4) and round(bm["hard"]["at4_r"], 4) == round(rust["hard_reformulated"]["section_at_4"], 4)
    parity["negative"] = all(a["all_weak"] == r["all_weak"] and a["hits"] == r["hits"] for a, r in zip(bm["negative"], rust["negative"]))
    report["bm25"], report["bm25_matches_rust"] = bm, parity
    print("BM25 portado == Rust:", parity)
    assert all(parity.values()), "the Python BM25 must reproduce the Rust benchmark before comparing"

    specs = model_specs(Path(args.models))
    report["models"] = {}
    for name, spec in specs.items():
        for int8 in (False, True):
            rss0 = proc.memory_info().rss
            t0 = time.perf_counter()
            model = Static(name, int8=int8, **spec)
            load_s = time.perf_counter() - t0
            rss = proc.memory_info().rss - rss0
            label = name + (" int8" if int8 else "")
            r = {"vocab": model.e.shape[0], "dim": model.e.shape[1], "load_s": load_s, "rss_mb": rss / 2**20}
            # Threshold: top-1 cosine of what should be found vs what shouldn't (tuned on this same data).
            h0 = Hybrid(es, model)
            hb0 = Hybrid(both, model)
            pos = [float(h0.cos(it[f]).max()) for _, items, f, _ in sets for it in items] + [float(hb0.cos(it["question"]).max()) for it in cross["questions"]]
            neg = [float(h0.cos(x).max()) for x in negs + near]
            r["top_cos_positive"] = {"min": min(pos), "p10": float(np.percentile(pos, 10)), "median": float(np.median(pos))}
            r["top_cos_negative"] = {"max": max(neg), "values": dict(zip(negs + near, neg))}
            # Diagnosis: the same Spanish questions by cosine over the English text alone.
            en = Library([(cross["title"], cross["markdown"])])
            he = Hybrid(en, model)
            ranks = [next(k for k, i in enumerate(np.argsort(-he.cos(it["question"]), kind="stable")) if en.chunks[i]["path"].endswith(it["section"])) for it in cross["questions"]]
            r["cross_cosine_english_only"] = {"at1": sum(k == 0 for k in ranks) / len(ranks), "at4": sum(k < 4 for k in ranks) / len(ranks), "chunks": en.n}
            r["embed_book_ms"] = h0.embed_s * 1000
            r["embed_both_ms"] = hb0.embed_s * 1000
            r["variants"] = {}
            for prio in ("none", "all", "strong"):
                # Default threshold: just above the highest original negative (2 queries; see doc).
                t = round(max(float(h0.cos(x).max()) for x in negs) + 0.01, 3)
                hy, hyb = Hybrid(es, model, prio, t), Hybrid(both, model, prio, t)
                hy.vecs, hyb.vecs = h0.vecs, hb0.vecs
                v = {"threshold": t}
                for mode in ("cosine", "hybrid") if prio == "none" else ("hybrid",):
                    res = {}
                    for sname, items, field, rt in sets:
                        res[sname] = run_set(items, field, lambda x: hy.search(x, LIBRARY_HITS, mode), hy.hint, rt)
                    res["cross"] = run_set(cross["questions"], "question", lambda x: hyb.search(x, LIBRARY_HITS, mode), hyb.hint, retry_en)
                    res["negative"] = negatives(lambda x: hy.search(x, LIBRARY_HITS, mode), negs)
                    res["negative_retry"] = negatives(lambda x: hy.search(x, LIBRARY_HITS, mode), [retry["negative"][x] for x in negs])
                    res["near_negative"] = negatives(lambda x: hy.search(x, LIBRARY_HITS, mode), near)
                    # Positives the teacher would be told "probably not in the library" (all 4 weak).
                    flagged = {}
                    for sname, items, field, _ in sets:
                        flagged[sname] = sum(all(h["weak"] for h in hy.search(it[field], LIBRARY_HITS, mode)) for it in items)
                    flagged["cross"] = sum(all(h["weak"] for h in hyb.search(it["question"], LIBRARY_HITS, mode)) for it in cross["questions"])
                    res["positives_all_weak"] = flagged
                    v[mode] = res
                if prio == "strong":
                    # Same trigger as today (computed on BM25's own result), second search hybrid:
                    # the teacher reformulates exactly when BM25 alone would ask for it.
                    bh = lambda lib: (lambda hits, x: hint(lib.search(x, LIBRARY_HITS), x))
                    v["hybrid_bm25_hint"] = {
                        "hard": run_set(q["hard"], "question", lambda x: hy.search(x, LIBRARY_HITS), bh(es), retry["hard"]),
                        "cross": run_set(cross["questions"], "question", lambda x: hyb.search(x, LIBRARY_HITS), bh(both), retry_en),
                    }
                r["variants"][prio] = v
            # Threshold sweep for the default variant (strong priority): errors of both kinds.
            sweep = []
            for t in [round(x, 2) for x in np.arange(0.15, 0.80, 0.05)]:
                hy, hyb = Hybrid.__new__(Hybrid), Hybrid.__new__(Hybrid)
                for h, lib, src in ((hy, es, h0), (hyb, both, hb0)):
                    h.lib, h.model, h.priority, h.t, h.vecs = lib, model, "strong", t, src.vecs
                pos_flag = sum(all(x["weak"] for x in hy.search(it[f], LIBRARY_HITS)) for _, items, f, _ in sets for it in items) + sum(all(x["weak"] for x in hyb.search(it["question"], LIBRARY_HITS)) for it in cross["questions"])
                neg_ok = sum(all(x["weak"] for x in hy.search(x2, LIBRARY_HITS)) for x2 in negs)
                near_ok = sum(all(x["weak"] for x in hy.search(x2, LIBRARY_HITS)) for x2 in near)
                sweep.append({"t": t, "positives_flagged": pos_flag, "of": len(pos), "negatives_flagged": neg_ok, "near_flagged": near_ok})
            r["sweep"] = sweep
            # Cost per query: tokenize + average + dot over the chunks + RRF (Python).
            hy = Hybrid.__new__(Hybrid)
            hy.lib, hy.model, hy.priority, hy.t, hy.vecs = es, model, "strong", 0.5, h0.vecs
            qs = [it["question"] for it in q["hard"] + q["questions"]]
            for x in qs[:5]:
                hy.search(x, LIBRARY_HITS)
            t0 = time.perf_counter()
            for x in qs:
                model.encode([x])
            r["encode_query_ms"] = (time.perf_counter() - t0) * 1000 / len(qs)
            t0 = time.perf_counter()
            for x in qs:
                hy.search(x, LIBRARY_HITS)
            r["hybrid_query_ms_python"] = (time.perf_counter() - t0) * 1000 / len(qs)
            t0 = time.perf_counter()
            for x in qs:
                es.search(x, LIBRARY_HITS)
            r["bm25_query_ms_python"] = (time.perf_counter() - t0) * 1000 / len(qs)
            big = np.random.default_rng(0).standard_normal((50_000, model.e.shape[1])).astype(np.float32)
            qv = model.encode([qs[0]])[0]
            t0 = time.perf_counter()
            for _ in range(20):
                np.argpartition(-(big @ qv), 50)[:50]
            r["cosine_50k_chunks_ms"] = (time.perf_counter() - t0) * 1000 / 20
            report["models"][label] = r
            print(f"{label}: listo ({load_s:.1f} s de carga, +{rss / 2**20:.0f} MB RSS)")
            del model, h0, hb0
    # Sizes and pruning estimate, from the tables.
    report["sizes"] = sizes(specs)
    report["parity_model2vec"] = parity_model2vec(Path(args.models), specs)
    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print_tables(report)


def latin_only(tok):
    t = tok.removeprefix("##").replace("▁", "")
    if not t:
        return True
    for c in t:
        if c.isascii():
            continue
        n = unicodedata.name(c, "")
        if "LATIN" not in n and unicodedata.category(c)[0] not in "PSNZ":
            return False
    return True


def sizes(specs):
    out = {}
    for name, spec in specs.items():
        tok = Tokenizer.from_file(str(spec["tokenizer"]))
        vocab = tok.get_vocab()
        from safetensors import safe_open

        with safe_open(str(spec["weights"]), "np") as f:
            rows, dim = f.get_slice(spec["key"]).get_shape()
        dim = spec.get("dim") or dim
        keep = sum(latin_only(t) for t in vocab)
        out[name] = {"rows": rows, "dim": dim, "f32_mb": rows * dim * 4 / 1e6, "int8_mb": (rows * dim + rows * 4) / 1e6, "latin_rows": keep, "latin_f32_mb": keep * dim * 4 / 1e6, "latin_int8_mb": (keep * dim + keep * 4) / 1e6, "tokenizer_mb": os.path.getsize(spec["tokenizer"]) / 1e6}
    return out


def parity_model2vec(root, specs):
    """The hand-written average against model2vec's own encode (plan, section 6)."""
    from model2vec import StaticModel

    m2v = StaticModel.from_pretrained(str(root / "potion-multilingual-128M"))
    mine = Static("potion", **specs["potion-multilingual-128M"])
    q = json.loads((FIX / "libro-editorial.questions.json").read_text(encoding="utf-8"))
    texts = [it["question"] for it in q["hard"]] + [it["answer"] for it in q["questions"][:8]]
    a, b = mine.encode(texts), m2v.encode(texts)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    c = (a * b).sum(axis=1)
    return {"sentences": len(texts), "min_cos": float(c.min())}


def pct(x):
    return f"{x * 100:.0f} %"


def print_tables(r):
    print("\n## Fragmentos:", r["chunks_es"], "(libro) /", r["chunks_both"], "(libro + texto en inglés)")
    b = r["bm25"]
    print("\n| Modo | search @1/@4 | question @1/@4 | hard @1/@4 | hard + reformulación @1/@4 | inglés @1/@4 | inglés + reformulación en inglés @1/@4 |")
    print("|---|---|---|---|---|---|---|")

    def row(label, s):
        print(f"| {label} | {pct(s['search']['at1'])} / {pct(s['search']['at4'])} | {pct(s['question']['at1'])} / {pct(s['question']['at4'])} | {pct(s['hard']['at1'])} / {pct(s['hard']['at4'])} | {pct(s['hard']['at1_r'])} / {pct(s['hard']['at4_r'])} | {pct(s['cross']['at1'])} / {pct(s['cross']['at4'])} | {pct(s['cross']['at1_r'])} / {pct(s['cross']['at4_r'])} |")

    row("BM25", b)
    for name, m in r["models"].items():
        for prio, v in m["variants"].items():
            if "cosine" in v and prio == "none":
                row(f"{name} coseno", v["cosine"])
            row(f"{name} híbrido (prioridad {prio}, umbral {v['threshold']})", v["hybrid"])
        h = m["variants"]["strong"]["hybrid_bm25_hint"]
        print(f"| {name} híbrido strong, aviso de BM25 | | | | {pct(h['hard']['at1_r'])} / {pct(h['hard']['at4_r'])} | | {pct(h['cross']['at1_r'])} / {pct(h['cross']['at4_r'])} |")
    print("\nPor pregunta (hard): puesto de la sección (0 = 1.º, - = fuera del top 4), y tras reformular")
    fmt = lambda x: "-" if x is None else str(x + 1)
    cols = [("BM25", b["hard"])] + [(f"{n} {k}", m["variants"]["strong"][k]["hard"] if k != "cosine" else m["variants"]["none"]["cosine"]["hard"]) for n, m in r["models"].items() if "int8" not in n for k in ("cosine", "hybrid", "hybrid_bm25_hint")]
    print("| Pregunta | " + " | ".join(c for c, _ in cols) + " |")
    print("|---|" + "---|" * len(cols))
    for k, it in enumerate(b["hard"]["ranks"]):
        print(f"| {it['q']} | " + " | ".join(f"{fmt(s['ranks'][k]['rank'])} → {fmt(s['ranks'][k]['rank2']) if s['ranks'][k]['retry'] else '·'}" for _, s in cols) + " |")
    print("\nNegativas y umbral:")
    for name, m in r["models"].items():
        v = m["variants"]["strong"]["hybrid"]
        print(name, "| negativas todas débiles:", [n["all_weak"] for n in v["negative"]], "| reformuladas:", [n["all_weak"] for n in v["negative_retry"]], "| cercanas:", [n["all_weak"] for n in v["near_negative"]], "| positivas marcadas débiles:", v["positives_all_weak"])
        print("   coseno 1.º positivas", {k: round(x, 3) for k, x in m["top_cos_positive"].items()}, "negativas", {k: round(x, 3) for k, x in m["top_cos_negative"]["values"].items()})
        print("   barrido", [(s["t"], s["positives_flagged"], s["negatives_flagged"], s["near_flagged"]) for s in m["sweep"]])
        print("   inglés solo (coseno):", m["cross_cosine_english_only"])
        print(f"   costo: carga {m['load_s']:.1f} s, +{m['rss_mb']:.0f} MB RSS, libro {m['embed_book_ms']:.0f} ms, consulta (encode) {m['encode_query_ms']:.2f} ms, híbrida {m['hybrid_query_ms_python']:.2f} ms vs BM25 {m['bm25_query_ms_python']:.2f} ms (Python), coseno 50k fragmentos {m['cosine_50k_chunks_ms']:.2f} ms")
    print("\nTamaños:", json.dumps(r["sizes"], indent=1))
    print("Paridad con model2vec:", r["parity_model2vec"])


if __name__ == "__main__":
    main()

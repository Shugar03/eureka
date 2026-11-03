"""Builds tests/fixtures/apuntes-fisica.pdf: a 4-page reading with bookmarks
(two chapters and a subsection), a running header, page numbers and a
hyphenated word, for the library e2e test (AC-69).

Run: python tests/fixtures/make-book-pdf.py
"""
from pathlib import Path

HEADER = "Física básica — Apuntes de cátedra"

# (size, text) per line; None = blank line.
PAGES = [
    [(18, "Capítulo 1: Energía"), None,
     (11, "La energía es la capacidad de un sistema para realizar tra-"),
     (11, "bajo. Se mide en joules y se conserva en un sistema aislado."), None,
     (11, "La energía cinética depende de la masa y de la velocidad.")],
    [(14, "1.1 Trabajo"), None,
     (11, "El trabajo es la fuerza aplicada por la distancia recorrida"),
     (11, "en la dirección de la fuerza. Una fuerza que no desplaza no trabaja.")],
    [(18, "Capítulo 2: Calor"), None,
     (11, "El calor es energía en tránsito entre cuerpos a distinta temperatura."),
     (11, "Fluye siempre del cuerpo más caliente al más frío.")],
    [(11, "La conducción, la convección y la radiación son las tres formas"),
     (11, "en que se transmite el calor de un cuerpo a otro.")],
]

OUTLINE = [("Capítulo 1: Energía", 0, [("1.1 Trabajo", 1)]), ("Capítulo 2: Calor", 2, [])]


def s(text: str) -> bytes:
    raw = text.encode("cp1252")
    return b"(" + raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def content(n: int, lines) -> bytes:
    ops = [b"BT", b"/F1 9 Tf", b"56 770 Td", s(HEADER) + b" Tj", b"ET"]
    y = 730
    for line in lines:
        if line is None:
            y -= 14
            continue
        size, text = line
        ops += [b"BT", b"/F1 %d Tf" % size, b"56 %d Td" % y, s(text) + b" Tj", b"ET"]
        y -= size + 6
    ops += [b"BT", b"/F1 9 Tf", b"300 40 Td", s(str(n)) + b" Tj", b"ET"]
    return b"\n".join(ops)


def build() -> bytes:
    objs: dict[int, bytes] = {}
    font, pages_id, outlines_id = 3, 2, 4
    nxt = 5
    page_ids = []
    for i, lines in enumerate(PAGES):
        page_id, content_id = nxt, nxt + 1
        nxt += 2
        stream = content(i + 1, lines)
        objs[content_id] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        objs[page_id] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % content_id
        page_ids.append(page_id)
    # Outline items.
    top_ids = []
    for title, page, kids in OUTLINE:
        top_ids.append(nxt)
        nxt += 1
        kid_ids = list(range(nxt, nxt + len(kids)))
        nxt += len(kids)
        for k, (kt, kp) in zip(kid_ids, kids):
            objs[k] = b"<< /Title %s /Parent %d 0 R /Dest [%d 0 R /XYZ null null null] >>" % (s(kt), top_ids[-1], page_ids[kp])
        first_last = b" /First %d 0 R /Last %d 0 R /Count %d" % (kid_ids[0], kid_ids[-1], len(kid_ids)) if kid_ids else b""
        objs[top_ids[-1]] = (title, page, first_last)  # finished below (needs Prev/Next)
    for i, oid in enumerate(top_ids):
        title, page, first_last = objs[oid]
        links = (b" /Prev %d 0 R" % top_ids[i - 1] if i > 0 else b"") + (b" /Next %d 0 R" % top_ids[i + 1] if i + 1 < len(top_ids) else b"")
        objs[oid] = b"<< /Title %s /Parent %d 0 R%s%s /Dest [%d 0 R /XYZ null null null] >>" % (s(title), outlines_id, links, first_last, page_ids[page])
    objs[1] = b"<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /PageMode /UseOutlines >>"
    objs[pages_id] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % p for p in page_ids), len(page_ids))
    objs[font] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    objs[outlines_id] = b"<< /Type /Outlines /First %d 0 R /Last %d 0 R /Count %d >>" % (top_ids[0], top_ids[-1], len(top_ids))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = {}
    for i in range(1, nxt):
        offsets[i] = len(out)
        out += b"%d 0 obj\n" % i + objs[i] + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % nxt
    for i in range(1, nxt):
        out += b"%010d 00000 n \n" % offsets[i]
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (nxt, xref)
    return bytes(out)


if __name__ == "__main__":
    path = Path(__file__).with_name("apuntes-fisica.pdf")
    path.write_bytes(build())
    print(path)

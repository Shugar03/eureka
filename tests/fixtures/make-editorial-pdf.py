"""Builds the library benchmark (AC-69…72, NF-22):

- tests/fixtures/libro-editorial.pdf: a ~25-page invented book ("Fermentación
  en la cocina andina", Editorial Marea) with two chapters, ten sections, a
  running header, page numbers and no bookmarks (headings come from font
  sizes, the harder path).
- tests/fixtures/libro-editorial.questions.json: questions only this book
  answers (its facts are invented), each with the section and page where the
  answer is printed, in two phrasings: as the learner asks and as the teacher
  would search. Plus questions the book does NOT answer.

Run: python tests/fixtures/make-editorial-pdf.py
"""
import json
import random
import textwrap
from pathlib import Path

random.seed(7)
HEADER = "Fermentación en la cocina andina — Editorial Marea"
WIDTH = 88  # characters per line at 11 pt
LINES_PER_PAGE = 40

FILLER = [
    "Los microorganismos transforman los azúcares disponibles en ácidos, gases y aromas, y cada etapa depende de la temperatura, la humedad y el tiempo de reposo.",
    "En la práctica doméstica conviene observar el color, el olor y la textura de la preparación antes de decidir si el proceso avanza como se espera.",
    "La acidez creciente protege a la mezcla de bacterias indeseadas, pero un exceso de acidez detiene a las levaduras y vuelve áspero el sabor final.",
    "Las cocineras de los valles registraban sus resultados en cuadernos familiares, anotando la estación del año, el recipiente usado y el tiempo de espera.",
    "La sal cumple varias funciones a la vez: selecciona a los microorganismos que sobreviven, retiene agua en los tejidos y refuerza el sabor.",
    "El recipiente influye más de lo que parece, porque la arcilla, la madera y el vidrio intercambian calor y humedad con el entorno de manera distinta.",
    "Un buen registro permite repetir una preparación exitosa y corregir la siguiente, algo que la tradición oral transmitía con refranes y gestos.",
    "La altura modifica la presión, la temperatura de ebullición y la velocidad de evaporación, y por eso las recetas del altiplano difieren de las de la costa.",
    "El reposo nocturno suele ser el momento en que más cambia la mezcla, cuando la temperatura baja y la actividad microbiana se vuelve más lenta.",
    "Los aromas que aparecen durante el proceso son compuestos volátiles que indican qué microorganismos dominan en cada momento.",
]

# Ten sections, two invented facts each (the answers), in order.
BOOK = [
    ("Capítulo 1: Fundamentos de la fermentación", [
        ("1.1 Qué es fermentar", [
            "El cronista Eusebio Tarifa llamó a la fermentación «la cocina invisible» en su tratado de 1794, porque ocurre sin fuego y sin que nadie la vea.",
            "Según la clasificación de Editorial Marea, existen cuatro familias de fermentos andinos: los de maíz, los de papa, los de quinua y los de frutos silvestres.",
        ]),
        ("1.2 El índice de Quispe", [
            "El índice de Quispe mide la madurez de una chicha dividiendo la acidez por los grados de azúcar restante; un valor de 0,8 indica que está lista para servir.",
            "Rosa Quispe propuso su índice en 1961 en la cooperativa de Maras, después de comparar cuarenta y dos tandas de chicha durante tres cosechas.",
        ]),
        ("1.3 Levaduras nativas", [
            "La levadura Tolar-7 fue aislada de la piel de la tuna en Huancavelica y tolera hasta 14 grados de alcohol sin detener su trabajo.",
            "Las levaduras nativas de altura sobreviven a heladas de hasta seis grados bajo cero porque acumulan trehalosa en sus paredes.",
        ]),
        ("1.4 Temperatura y altura", [
            "La regla de Condori indica que por cada mil metros de altura hay que sumar un día de reposo a la fermentación del maíz.",
            "A 3800 metros, en la orilla del lago, la chicha de jora alcanza su punto en nueve días en lugar de los cinco que tarda en el valle.",
        ]),
        ("1.5 Seguridad alimentaria", [
            "El protocolo de las tres lunas exige descartar cualquier fermento que huela a acetona durante tres noches seguidas.",
            "La señal de alarma más confiable, según el manual de Marea, es una película rosada en la superficie, que delata contaminación por bacterias.",
        ]),
    ]),
    ("Capítulo 2: Técnicas tradicionales y su ciencia", [
        ("2.1 La chicha de jora", [
            "La jora es maíz germinado durante exactamente siete días sobre hojas de achira, y luego secado al sol sobre los techos.",
            "En la receta de Ollantaytambo se usan doce litros de agua por cada kilo de jora, y el hervor dura seis horas.",
        ]),
        ("2.2 El chuño y la fermentación en frío", [
            "El chuño blanco o tunta se fermenta sumergido en el río durante tres semanas antes de secarse al sol de junio.",
            "El experimento de Laguna Saltada de 1987 demostró que la tunta conserva el ochenta por ciento de su almidón durante cinco años.",
        ]),
        ("2.3 Masato y fermentos de yuca", [
            "En la Amazonía, el masato se inicia masticando una parte de la yuca, porque la saliva aporta las enzimas que rompen el almidón.",
            "La cofradía de Lamas fijó en 1950 que el masato debe reposar cuatro días en tinajas de barro enterradas hasta la mitad.",
        ]),
        ("2.4 Recipientes de barro", [
            "Las tinajas de Pucará tienen una porosidad del diecinueve por ciento, y por eso la chicha respira y se enfría por evaporación.",
            "Antes de usar una tinaja nueva se la cura con suero de leche durante dos semanas para sellar sus poros más grandes.",
        ]),
        ("2.5 La regla 4-2-1 del remojo", [
            "La regla 4-2-1 del remojo indica cuatro horas de agua fría, dos de agua tibia y una de agua con ceniza para la quinua.",
            "La ceniza de molle usada en el último remojo elimina la saponina amarga de la quinua mejor que el lavado con agua sola.",
        ]),
    ]),
]

QUESTIONS = [
    # (as the learner asks, as the teacher would search, section, fact index)
    ("¿Qué mide el índice de Quispe y qué valor indica que la chicha está lista?", "índice Quispe madurez chicha acidez azúcar valor", "1.2 El índice de Quispe", 0),
    ("¿Quién propuso ese índice y en qué año?", "Rosa Quispe propuso índice año cooperativa Maras", "1.2 El índice de Quispe", 1),
    ("¿De dónde se aisló la levadura Tolar-7 y cuánto alcohol tolera?", "levadura Tolar-7 aislada tuna alcohol grados", "1.3 Levaduras nativas", 0),
    ("¿Por qué las levaduras de altura aguantan las heladas?", "levaduras altura heladas trehalosa sobreviven frío", "1.3 Levaduras nativas", 1),
    ("¿Cuántos días de reposo hay que sumar según la altura?", "regla Condori altura metros día reposo maíz", "1.4 Temperatura y altura", 0),
    ("¿En cuántos días está lista la chicha de jora a 3800 metros?", "chicha jora 3800 metros días lago punto", "1.4 Temperatura y altura", 1),
    ("¿Qué dice el protocolo de las tres lunas?", "protocolo tres lunas descartar fermento acetona noches", "1.5 Seguridad alimentaria", 0),
    ("¿Cuál es la señal de alarma más confiable de contaminación?", "señal alarma película rosada superficie contaminación bacterias", "1.5 Seguridad alimentaria", 1),
    ("¿Cuántos días germina el maíz para hacer jora y sobre qué?", "jora maíz germinado días hojas achira", "2.1 La chicha de jora", 0),
    ("¿Cuánta agua lleva la receta de Ollantaytambo?", "receta Ollantaytambo litros agua kilo jora hervor", "2.1 La chicha de jora", 1),
    ("¿Cómo se fermenta la tunta?", "chuño blanco tunta fermenta sumergido río semanas", "2.2 El chuño y la fermentación en frío", 0),
    ("¿Qué demostró el experimento de Laguna Saltada?", "experimento Laguna Saltada 1987 tunta almidón años", "2.2 El chuño y la fermentación en frío", 1),
    ("¿Por qué se mastica la yuca para el masato?", "masato yuca masticar saliva enzimas almidón", "2.3 Masato y fermentos de yuca", 0),
    ("¿Qué porosidad tienen las tinajas de Pucará?", "tinajas Pucará porosidad por ciento chicha respira", "2.4 Recipientes de barro", 0),
    ("¿Con qué se cura una tinaja nueva?", "curar tinaja nueva suero leche semanas poros", "2.4 Recipientes de barro", 1),
    ("¿Qué es la regla 4-2-1 del remojo?", "regla 4-2-1 remojo horas agua fría tibia ceniza quinua", "2.5 La regla 4-2-1 del remojo", 0),
    ("¿Para qué sirve la ceniza de molle?", "ceniza molle saponina quinua amarga remojo", "2.5 La regla 4-2-1 del remojo", 1),
    ("¿Cómo llamó Eusebio Tarifa a la fermentación?", "Eusebio Tarifa llamó fermentación cocina invisible tratado", "1.1 Qué es fermentar", 0),
]

# Paraphrased as a student would ask, avoiding the book's own words and names.
HARD = [
    ("¿Cómo sé si una bebida de maíz ya está madura para tomar?", "1.2 El índice de Quispe", 0),
    ("¿Qué sustancia protege a los hongos del congelamiento?", "1.3 Levaduras nativas", 1),
    ("¿Cuánto tiempo extra necesita el maíz cuando cocino en la montaña?", "1.4 Temperatura y altura", 0),
    ("¿Qué olor me obliga a tirar la preparación?", "1.5 Seguridad alimentaria", 0),
    ("¿Qué color en la superficie indica que se echó a perder?", "1.5 Seguridad alimentaria", 1),
    ("¿Cuánto tiempo se deja brotar el grano antes de secarlo?", "2.1 La chicha de jora", 0),
    ("¿Cuánto tiempo pasa la papa en el agua corriente?", "2.2 El chuño y la fermentación en frío", 0),
    ("¿Cuánto dura guardada la papa deshidratada sin perder su almidón?", "2.2 El chuño y la fermentación en frío", 1),
    ("¿Por qué se mastica la mandioca para la bebida amazónica?", "2.3 Masato y fermentos de yuca", 0),
    ("¿Por qué la vasija de arcilla enfría la bebida?", "2.4 Recipientes de barro", 0),
    ("¿Cómo se prepara un cántaro nuevo antes de usarlo?", "2.4 Recipientes de barro", 1),
    ("¿Cómo se le quita lo amargo a la quinua?", "2.5 La regla 4-2-1 del remojo", 1),
]

NEGATIVE = [
    ("¿Quién ganó el mundial de fútbol de 1986?", "mundial fútbol 1986 ganador"),
    ("¿Cómo se calcula la derivada de un polinomio?", "derivada polinomio cálculo regla potencia"),
]


def s(text: str) -> bytes:
    raw = text.encode("cp1252")
    return b"(" + raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def layout():
    """Lines of the book as (size, text) with page breaks; remembers where each fact lands."""
    pages: list[list] = [[]]
    fact_page: dict[tuple[str, int], int] = {}

    def room(n: int):
        if len(pages[-1]) + n > LINES_PER_PAGE:
            pages.append([])

    def para(text: str, key=None):
        lines = textwrap.wrap(text, WIDTH)
        room(len(lines) + 1)
        if key:
            fact_page[key] = len(pages)
        pages[-1].extend((11, l) for l in lines)
        pages[-1].append(None)

    for ci, (chapter, sections) in enumerate(BOOK):
        if pages[-1]:
            pages.append([])
        pages[-1] += [(18, chapter), None]
        for title, facts in sections:
            room(6)
            pages[-1] += [(14, title), None]
            filler = FILLER[:]
            random.shuffle(filler)
            # ~2.4 pages per section: filler around the two facts.
            body = filler[:4] + [facts[0]] + filler[4:8] + [facts[1]] + filler[8:] + random.choices(FILLER, k=21)
            for p in body:
                fi = facts.index(p) if p in facts else None
                para(p, (title, fi) if fi is not None else None)
    return pages, fact_page


def content(n: int, lines) -> bytes:
    ops = [b"BT", b"/F1 9 Tf", b"56 770 Td", s(HEADER) + b" Tj", b"ET"]
    y = 740
    for line in lines:
        if line is None:
            y -= 8
            continue
        size, text = line
        ops += [b"BT", b"/F1 %d Tf" % size, b"56 %d Td" % y, s(text) + b" Tj", b"ET"]
        y -= size + 5
    ops += [b"BT", b"/F1 9 Tf", b"300 36 Td", s(str(n)) + b" Tj", b"ET"]
    return b"\n".join(ops)


def build(pages) -> bytes:
    objs: dict[int, bytes] = {1: b"<< /Type /Catalog /Pages 2 0 R >>", 3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"}
    nxt, page_ids = 4, []
    for i, lines in enumerate(pages):
        page_id, content_id = nxt, nxt + 1
        nxt += 2
        stream = content(i + 1, lines)
        objs[content_id] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        objs[page_id] = b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % content_id
        page_ids.append(page_id)
    objs[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % p for p in page_ids), len(page_ids))
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
    pages, fact_page = layout()
    here = Path(__file__).parent
    (here / "libro-editorial.pdf").write_bytes(build(pages))
    facts = {title: f for _, secs in BOOK for title, f in secs}
    qs = [{"question": q, "search": k, "section": sec, "page": fact_page[(sec, fi)], "answer": facts[sec][fi]} for q, k, sec, fi in QUESTIONS]
    hard = [{"question": q, "section": sec, "page": fact_page[(sec, fi)], "answer": facts[sec][fi]} for q, sec, fi in HARD]
    neg = [{"question": q, "search": k} for q, k in NEGATIVE]
    (here / "libro-editorial.questions.json").write_text(json.dumps({"pages": len(pages), "questions": qs, "hard": hard, "negative": neg}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(pages)} páginas, {len(qs)} preguntas")

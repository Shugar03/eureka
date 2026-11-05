"""Builds tiny Word, PowerPoint, EPUB and OpenDocument files for the library
tests (AC-191): tests/fixtures/apuntes-volcanes.docx, clase-volcanes.pptx,
libro-volcanes.epub and apuntes-volcanes.odt. Hand-written XML with the
standard library only, fixed timestamps so the bytes don't change between
runs. The text is invented for these tests (no copyrighted material).

Run: python tests/fixtures/make-office-docs.py
"""
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent
STAMP = (2026, 11, 1, 12, 0, 0)

# (heading level or 0 for a paragraph, text)
DOC = [
    (1, "Volcanes de la Puna"),
    (0, "La Puna tiene volcanes altos y secos, con cráteres que guardan lagunas saladas."),
    (2, "El cono de Tamberías"),
    (0, "El cono de Tamberías creció con tres erupciones cortas; su ceniza blanca cubre el salar vecino."),
    (2, "Fumarolas y azufre"),
    (0, "Las fumarolas del cerro Aguila sueltan vapor con azufre que se deposita en cristales amarillos."),
]

SLIDES = [
    ("Clase 3: volcanes", ["Qué es un volcán", "Partes: cámara, chimenea, cráter"]),
    ("Tipos de erupción", ["Efusiva: lava que corre", "Explosiva: ceniza y bombas"]),
    ("La regla del semáforo", ["Verde: calma", "Amarillo: temblores", "Rojo: evacuar"]),
]


def write_zip(path: Path, files: list[tuple[str, str]], stored_first: bool = False) -> None:
    with zipfile.ZipFile(path, "w") as z:
        for i, (name, data) in enumerate(files):
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_STORED if stored_first and i == 0 else zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8"))


def docx() -> None:
    body = []
    for level, text in DOC:
        style = f'<w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr>' if level else ""
        body.append(f"<w:p>{style}<w:r><w:t>{escape(text)}</w:t></w:r></w:p>")
    styles = "".join(
        f'<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:pPr><w:outlineLvl w:val="{n - 1}"/></w:pPr></w:style>' for n in (1, 2, 3)
    )
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    write_zip(
        HERE / "apuntes-volcanes.docx",
        [
            ("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
            ("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
            ("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
            ("word/styles.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:styles {w}>{styles}</w:styles>'),
            ("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document {w}><w:body>{"".join(body)}</w:body></w:document>'),
        ],
    )


def pptx() -> None:
    p = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    files = [
        ("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
         + "".join(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' for i in range(1, len(SLIDES) + 1))
         + "</Types>"),
        ("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'),
        ("ppt/_rels/presentation.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>' for i in range(1, len(SLIDES) + 1))
         + "</Relationships>"),
        ("ppt/presentation.xml", f'<?xml version="1.0" encoding="UTF-8"?><p:presentation {p}><p:sldIdLst>'
         + "".join(f'<p:sldId id="{255 + i}" r:id="rId{i}"/>' for i in range(1, len(SLIDES) + 1))
         + "</p:sldIdLst></p:presentation>"),
    ]
    for i, (title, bullets) in enumerate(SLIDES, 1):
        def shape(n: int, kind: str, paras: list[str]) -> str:
            ph = f'<p:nvPr><p:ph type="{kind}"/></p:nvPr>' if kind == "title" else '<p:nvPr><p:ph idx="1"/></p:nvPr>'
            text = "".join(f"<a:p><a:r><a:t>{escape(t)}</a:t></a:r></a:p>" for t in paras)
            return f'<p:sp><p:nvSpPr><p:cNvPr id="{n}" name="s{n}"/><p:cNvSpPr/>{ph}</p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>{text}</p:txBody></p:sp>'
        files.append((f"ppt/slides/slide{i}.xml", f'<?xml version="1.0" encoding="UTF-8"?><p:sld {p}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{shape(2, "title", [title])}{shape(3, "body", bullets)}</p:spTree></p:cSld></p:sld>'))
    write_zip(HERE / "clase-volcanes.pptx", files)


def epub() -> None:
    chapters = [
        ("cap1.xhtml", "<h1>Capítulo 1: El fuego de abajo</h1><p>El magma sube por grietas cuando la presión del gas vence a la roca.</p><h2>1.1 La cámara</h2><p>La cámara magmática del volcán Ojos Quietos está a nueve kilómetros de profundidad.</p>"),
        ("cap2.xhtml", "<h1>Capítulo 2: Vivir cerca</h1><p>Los pueblos de la Puna aprovechan el suelo volcánico para cultivar papa andina.</p>"),
    ]
    files = [
        ("mimetype", "application/epub+zip"),
        ("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
        ("OEBPS/content.opf", '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">volcanes-prueba</dc:identifier><dc:title>Volcanes de prueba</dc:title><dc:language>es</dc:language></metadata><manifest>'
         + "".join(f'<item id="c{i}" href="{name}" media-type="application/xhtml+xml"/>' for i, (name, _) in enumerate(chapters))
         + "</manifest><spine>"
         + "".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
         + "</spine></package>"),
    ]
    for name, html in chapters:
        files.append((f"OEBPS/{name}", f'<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>{html}</body></html>'))
    # The EPUB spec wants `mimetype` first and uncompressed.
    write_zip(HERE / "libro-volcanes.epub", files, stored_first=True)


def odt() -> None:
    body = []
    for level, text in DOC:
        body.append(f'<text:h text:outline-level="{level}">{escape(text)}</text:h>' if level else f"<text:p>{escape(text)}</text:p>")
    ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"'
    write_zip(
        HERE / "apuntes-volcanes.odt",
        [
            ("mimetype", "application/vnd.oasis.opendocument.text"),
            ("META-INF/manifest.xml", '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
            ("content.xml", f'<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}><office:body><office:text>{"".join(body)}</office:text></office:body></office:document-content>'),
        ],
        stored_first=True,
    )


if __name__ == "__main__":
    docx()
    pptx()
    epub()
    odt()
    print("apuntes-volcanes.docx, clase-volcanes.pptx, libro-volcanes.epub, apuntes-volcanes.odt")

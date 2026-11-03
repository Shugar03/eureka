"""Builds tests/fixtures/guia-examen.pdf: a one-page exam guide with real PDF
text (Helvetica, WinAnsi), bullets and accents, for the PDF import e2e test.

Run: python tests/fixtures/make-guide-pdf.py
"""
from pathlib import Path

LINES = [
    "Guía del examen Google Cloud Digital Leader",
    "",
    "Dominio 1: Transformación digital con Google Cloud (30%)",
    "• Por qué la nube cambia el negocio",
    "– Escalabilidad y costo variable",
    "– Innovación más rápida",
    "",
    "Dominio 2: Innovación con datos e IA (40%)",
    "• Valor de los datos",
    "– Data warehouse y data lake",
    "• Inteligencia artificial responsable",
    "– Sesgos y explicabilidad",
    "",
    "Dominio 3: Seguridad y operaciones (30%)",
    "• Modelo de responsabilidad compartida",
    "– Qué protege Google y qué el cliente",
]


def pdf_string(s: str) -> bytes:
    raw = s.encode("cp1252")
    return b"(" + raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)") + b")"


def build() -> bytes:
    ops = [b"BT", b"/F1 11 Tf", b"16 TL", b"56 760 Td"]
    for line in LINES:
        ops.append(pdf_string(line) + b" Tj T*")
    ops.append(b"ET")
    stream = b"\n".join(ops)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


if __name__ == "__main__":
    path = Path(__file__).with_name("guia-examen.pdf")
    path.write_bytes(build())
    print(path)

"""Builds tests/fixtures/foto-guia.png (a small image) and
tests/fixtures/guia-escaneada.pdf (a PDF with a drawing but no text, like a
scan), for the vision e2e tests (AC-63).

Run: python tests/fixtures/make-image-fixtures.py
"""
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).parent


def png(w: int, h: int) -> bytes:
    raw = b"".join(b"\x00" + b"".join(bytes([255, 255, 255]) if (x + y) % 7 else bytes([30, 30, 30]) for x in range(w)) for y in range(h))
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def scanned_pdf() -> bytes:
    stream = b"0.2 g 72 600 400 120 re f 0.6 g 72 450 300 40 re f"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
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
    (HERE / "foto-guia.png").write_bytes(png(64, 32))
    (HERE / "guia-escaneada.pdf").write_bytes(scanned_pdf())
    print("ok")

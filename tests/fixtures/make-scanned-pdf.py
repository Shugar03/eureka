"""Builds two image-only PDFs (no text layer, like a photocopy) for the OCR e2e
tests (AC-187): tests/fixtures/fotocopia-celula.pdf (3 pages, read without
asking) and tests/fixtures/fotocopia-larga.pdf (12 pages, asks first), plus
tests/fixtures/foto-apunte.png, a photo of printed notes for the chat (AC-188).
The text is written for these tests (no copyrighted material).

Run: python tests/fixtures/make-scanned-pdf.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent

PAGES = [
    "La célula es la unidad básica de la vida. Todos los seres vivos están formados por una o más células.",
    "La mitocondria produce la energía que la célula usa para crecer, moverse y dividirse.",
    "El ribosoma arma las proteínas siguiendo las instrucciones que copia del ADN.",
]


def page(text: str, n: int, size=(850, 1100)) -> Image.Image:
    img = Image.new("L", size, 250)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf" if Path("/usr/share/fonts").exists() else "arial.ttf", 30)
    except OSError:
        font = ImageFont.load_default(size=30)
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) > 40:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    lines.append(cur)
    for i, line in enumerate(lines):
        d.text((70, 120 + i * 48), line, fill=20, font=font)
    d.text((size[0] // 2 - 10, size[1] - 80), str(n), fill=60, font=font)
    return img


def save(path: Path, pages: list[Image.Image]) -> None:
    pages[0].save(path, "PDF", resolution=100, save_all=True, append_images=pages[1:], quality=55)


if __name__ == "__main__":
    save(HERE / "fotocopia-celula.pdf", [page(t, i + 1) for i, t in enumerate(PAGES)])
    long = [page(f"Página {i + 1} del apunte largo. {PAGES[i % 3]}", i + 1, (425, 550)) for i in range(12)]
    save(HERE / "fotocopia-larga.pdf", long)
    page("Mitocondria: produce la energía de la célula. Ribosoma: arma las proteínas.", 1, (900, 300)).convert("RGB").save(HERE / "foto-apunte.png")
    print("ok")

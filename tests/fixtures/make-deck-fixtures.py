"""Builds the deck files for AC-152 and AC-154:

- tests/fixtures/mazo-anki.apkg: an Anki package in the classic layout
  (collection.anki2, SQLite, only the `notes` table Eureka reads), with a
  basic note, a cloze, an image-only note and math in MathJax.
- tests/fixtures/mazo-compartido.eureka: a shared deck, with one empty card.

Run: python tests/fixtures/make-deck-fixtures.py
"""
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).parent

NOTES = [
    "Hola\x1fHello",
    "La {{c1::mitocondria}} produce ATP.\x1f",
    '<img src="celula.png">\x1fUna célula',
    "La derivada de \\(x^2\\)\x1f\\(2x\\)",
]

with tempfile.TemporaryDirectory() as tmp:
    db = Path(tmp) / "collection.anki2"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE notes (id integer primary key, flds text not null)")
    con.executemany("INSERT INTO notes VALUES (?, ?)", list(enumerate(NOTES, 1)))
    con.commit()
    con.close()
    with zipfile.ZipFile(HERE / "mazo-anki.apkg", "w", zipfile.ZIP_DEFLATED) as z:
        z.write(db, "collection.anki2")
        z.writestr("media", "{}")

shared = {
    "eureka": "mazo",
    "version": 1,
    "name": "Verbos irregulares",
    "cards": [
        {"front": "to go", "back": "went · gone"},
        {"front": "to see", "back": "saw · seen"},
        {"front": "", "back": "sin frente"},
    ],
}
(HERE / "mazo-compartido.eureka").write_text(json.dumps(shared, ensure_ascii=False, indent=2), encoding="utf-8")
print("ok")

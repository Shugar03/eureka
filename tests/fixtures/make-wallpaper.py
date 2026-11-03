"""Writes fondo-rojo.png: a 160x90 sunset-like picture, mostly red, for the
"Mi espacio" e2e (the accent must be suggested from its colours)."""
import struct, zlib
W, H = 160, 90
rows = []
for y in range(H):
    row = bytearray([0])
    for x in range(W):
        t = y / H
        r, g, b = (int(200 - 60 * t), int(50 + 20 * t), int(60 + 20 * t))  # red -> darker red
        if x > 120 and y < 20:
            r, g, b = 60, 90, 200  # a little blue corner
        row += bytes((r, g, b))
    rows.append(bytes(row))
raw = b"".join(rows)
def chunk(t, d):
    c = struct.pack(">I", len(d)) + t + d
    return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
open(__file__.replace("make-wallpaper.py", "fondo-rojo.png"), "wb").write(png)
print(len(png), "bytes")

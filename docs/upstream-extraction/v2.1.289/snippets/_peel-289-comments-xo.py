#!/usr/bin/env python3
"""Peel densable 2.1.289 comments Xo/gb + lTm/HEo sites (latin1)."""
from pathlib import Path

EXE = Path("/tmp/official-289/package/claude")
OUT = Path(__file__).resolve().parent


def ascii_slice(data: bytes, start: int, end: int) -> str:
    a = max(0, start)
    b = min(len(data), end)
    return "".join(
        chr(c) if c in (9, 10, 13) or 32 <= c <= 126 else "."
        for c in data[a:b]
    )


def main() -> None:
    data = EXE.read_bytes()
    peels = {
        "gold-289-Xo@182147842.js": (182147842, 182147960),
        "gold-289-Gf-Fee@186941396.js": (186941396, 186941576),
        "gold-289-HEo@194377575.js": (194377575, 194377795),
        "gold-289-comment-thread-analyst-Xo@194396736.txt": (
            194396536,
            194397016,
        ),
        "gold-289-comments-check@210871235.js": (210871157, 210873700),
        "gold-289-comments-scoped-dispatch@210883997.txt": (
            210883917,
            210884077,
        ),
        "gold-289-comments-census-HEo@210885115.txt": (210884900, 210885400),
    }
    for name, (start, end) in peels.items():
        (OUT / name).write_text(ascii_slice(data, start, end) + "\n", encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()

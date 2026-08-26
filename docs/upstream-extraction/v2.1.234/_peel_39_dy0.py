"""Peel gold Dy0/Oy0 assembler from heap 312214149 with a long after-window."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_39_dy0.txt")
OFF = 312214149


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        parts.append(f"===== Dy0/Oy0 @{OFF} before=200 after=8000 =====\n")
        parts.append(js_window(mm, OFF, 200, 8000))

        # also locate function Oy0( and function Dy0(
        for n in (b"function Oy0(", b"function Dy0(", b"function wRc(", b"function Hy0("):
            i = mm.find(n, 312200000)
            parts.append(f"\n\n===== {n!r} @{i} =====\n")
            if i >= 0:
                parts.append(js_window(mm, i, 50, 4000))

        # SKILL.md Reading Guide around the on-demand sentence
        i = mm.find(b"none of those files' content is included above", 311500000)
        parts.append(f"\n\n===== reading guide @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 800, 2500))

        # language hint after `${e}/cla`
        i = mm.find(b"${e}/cla", 312200000)
        parts.append(f"\n\n===== ${{e}}/cla @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 100, 2500))

        # User Request append
        i = mm.find(b"## User Request", 312200000)
        parts.append(f"\n\n===== User Request @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 200, 1500))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

"""Peel gold popEditableAt helper ke(), CLAUDE_CODE_KB_COHESION_FIXES, fii( call sites."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_ke.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        needles = [
            b"CLAUDE_CODE_KB_COHESION_FIXES",
            b"function ke(",
            b"popOne",
            b"fii(",
            b"popAllEditable(",
            b"popEditableAt",
            b"aria-label\":\"selected:",
            b'selected:',
        ]
        for n in needles:
            hits: list[int] = []
            start = 0
            while len(hits) < 8:
                i = mm.find(n, start)
                if i < 0:
                    break
                hits.append(i)
                start = i + 1
            parts.append(f"\n===== {n!r} hits={hits} =====\n")
            for i in hits[:5]:
                after = 2200 if n in (b"function ke(", b"CLAUDE_CODE_KB_COHESION_FIXES") else 900
                parts.append(f"\n----- @{i} -----\n")
                parts.append(js_window(mm, i, 250, after))

        # ke used as ke(Ft,Fe,Xe) near popAll @295688467
        i = 295688200
        parts.append(f"\n===== window around popAllEditable body @{i} =====\n")
        parts.append(js_window(mm, i, 2500, 500))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

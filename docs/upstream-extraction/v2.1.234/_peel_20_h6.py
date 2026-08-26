"""Find gold h6 / Phe / selectionHighlight non-brief in PromptInput heap."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_h6.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        # around LI definition — find function Phe / h6 nearby
        for n in (b"function h6(", b"h6=()", b"let h6", b"h6=", b"function Phe(", b"Phe=()"):
            hits = []
            start = 308900000
            while len(hits) < 5:
                i = mm.find(n, start)
                if i < 0 or i > 309050000:
                    break
                hits.append(i)
                start = i + 1
            parts.append(f"\n===== {n!r} in PromptInput heap {hits} =====\n")
            for i in hits[:3]:
                parts.append(f"\n----- @{i} -----\n")
                parts.append(js_window(mm, i, 120, 400))

        # selectionHighlight non-brief in j3i after brief return
        i = mm.find(b"selectionHighlight===", 306540000)
        parts.append(f"\n===== selectionHighlight=== @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 200, 2500))

        # second occurrence
        i2 = mm.find(b"selectionHighlight===", i + 1) if i >= 0 else -1
        parts.append(f"\n===== selectionHighlight=== #2 @{i2} =====\n")
        if i2 >= 0:
            parts.append(js_window(mm, i2, 200, 1500))

        # hTy env coerce for KB_COHESION
        i = mm.find(b"hTy=", 288800000)
        parts.append(f"\n===== hTy= @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 80, 400))

        i = mm.find(b"function hTy", 280000000)
        parts.append(f"\n===== function hTy @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 50, 400))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

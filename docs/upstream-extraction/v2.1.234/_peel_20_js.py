"""Peel gold queueEditIndex JS heap hits. mmap only."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_js.txt")

HITS = [
    304517644,
    308960986,
    308974942,
    308974995,
    308975025,
    308975141,
    308975792,
    308985884,
    308986199,
    308986666,
    308987395,
]


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for i in HITS:
            parts.append(f"\n\n========== queueEditIndex @{i} before=800 after=2500 ==========\n")
            parts.append(js_window(mm, i, 800, 2500))

        extra = [
            b"onSubmitProceed",
            b"historyEntry",
            b"function JDr",
            b"JDr(",
        ]
        for n in extra:
            hits: list[int] = []
            start = 300000000
            while len(hits) < 8:
                i = mm.find(n, start)
                if i < 0 or i > 320000000:
                    break
                hits.append(i)
                start = i + 1
            parts.append(f"\n\n===== {n!r} heap hits={hits} =====\n")
            for i in hits[:5]:
                parts.append(f"\n----- @{i} -----\n")
                parts.append(js_window(mm, i, 300, 1500))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

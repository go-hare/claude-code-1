"""Peel gold queueEditIndex / historyEntry / onSubmitProceed for #20. mmap only."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_queue.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


NEEDLES = [
    b"queueEditIndex",
    b"onSubmitProceed",
    b"historyEntry",
    b"queued messages reappearing",
    b"selecting queued",
    b"queueEdit",
    b"editable queued",
    b"setQueueEdit",
]


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        parts.append(f"SEA size={len(mm)}\n")
        for n in NEEDLES:
            hits: list[int] = []
            start = 0
            while len(hits) < 12:
                i = mm.find(n, start)
                if i < 0:
                    break
                hits.append(i)
                start = i + 1
            parts.append(f"\n===== {n!r} hits={hits} =====\n")
            for i in hits[:8]:
                parts.append(f"\n----- @{i} -----\n")
                parts.append(js_window(mm, i, 400, 1800))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

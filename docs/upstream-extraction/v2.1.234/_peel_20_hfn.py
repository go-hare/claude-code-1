"""Peel gold HFn / lJ / NMt / GEc / F3i / selectionHighlight for #20. mmap only."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_hfn.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


NEEDLES = [
    b"function HFn(",
    b"function NMt(",
    b"function lJ(",
    b"GEc=",
    b"selectionHighlight",
    b"queue-pull-needs-empty-input",
    b"input_queue_pop_to_edit",
    b"function SQw(",
    b"Clear the input to edit this queued shell command",
]


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for n in NEEDLES:
            i = mm.find(n, 280000000)
            parts.append(f"\n\n===== {n!r} @{i} =====\n")
            if i >= 0:
                after = 3500 if n.startswith(b"function") else 2000
                parts.append(js_window(mm, i, 200, after))

        # also HFn def around PromptInput heap
        i = mm.find(b"function HFn(", 308000000)
        parts.append(f"\n\n===== HFn near PromptInput @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 100, 4000))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

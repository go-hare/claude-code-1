"""Mmap-only peel of gold Fws + processUserInput task-notification wrap."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_49_fws.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def find_all(mm: mmap.mmap, n: bytes, limit: int = 12) -> list[int]:
    out: list[int] = []
    start = 0
    while len(out) < limit:
        i = mm.find(n, start)
        if i < 0:
            break
        out.append(i)
        start = i + 1
    return out


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        needles = [
            b"function Fws(",
            b"function ELi(",
            b"queueMode=",
            b"queueOrigin=",
            b"SYSTEM NOTIFICATION - NOT USER INPUT",
            b"wrapTaskNotification",
            b'kind==="task-notification"',
            b"J9i(",
            b"function J9i(",
            b"function Q9i(",
        ]
        for n in needles:
            offs = find_all(mm, n, 12)
            heap = [o for o in offs if o > 290000000]
            parts.append(f"\n===== {n!r} heap={heap} all={offs[:8]} =====\n")
            for o in (heap or offs)[:3]:
                if o < 90000000:
                    continue
                parts.append(f"\n----- @{o} -----\n")
                parts.append(js_window(mm, o, 400, 1400))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

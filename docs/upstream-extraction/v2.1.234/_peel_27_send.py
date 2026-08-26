"""Extract gold Yrf call site + interactiveHandler permission relay."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_27_send.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for label, off, before, after in [
            ("Yrf def 298108507", 298108507, 200, 400),
            ("input_preview heap 298111711", 298111711, 2500, 1800),
            ("permission_channel_relay heap 298111827", 298111827, 800, 1200),
            ("Yrf( call", mm.find(b"Yrf("), 400, 600),
        ]:
            parts.append(f"\n===== {label} =====\n")
            if off < 0:
                parts.append("NOT FOUND")
                continue
            parts.append(js_window(mm, off, before, after))

        # all Yrf( call sites
        start = 0
        hits = []
        while True:
            i = mm.find(b"Yrf(", start)
            if i < 0:
                break
            hits.append(i)
            start = i + 1
        parts.append(f"\nYrf( offs={hits}\n")
        for o in hits:
            if o > 290000000:
                parts.append(f"\n===== Yrf( @{o} =====\n")
                parts.append(js_window(mm, o, 500, 700))

        # isServerRegistered
        start = 0
        hits = []
        while True:
            i = mm.find(b"isServerRegistered", start)
            if i < 0:
                break
            hits.append(i)
            start = i + 1
            if len(hits) > 12:
                break
        parts.append(f"\nisServerRegistered offs={hits}\n")
        for o in hits:
            if o > 290000000:
                parts.append(f"\n===== isServerRegistered @{o} =====\n")
                parts.append(js_window(mm, o, 400, 500))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

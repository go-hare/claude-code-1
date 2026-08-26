"""mmap-only peel for densable 2.1.234 #27 inbound trust + permission opt-out."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_27_hits.txt")

needles = [
    b"channel/permission",
    b"permission_request",
    b"trust gate",
    b"inbound trust",
    b"permission preview",
    b"opt-out",
    b"opt out",
    b"channelPermission",
    b"claude/channel/permission",
    b"filterPermission",
    b"permission-capability",
    b"permission capability",
    b"admitted",
    b"tengu_harbor_permissions",
    b"tengu_harbor_ledger",
]


def windows(mm: mmap.mmap, needle: bytes, width: int = 400, limit: int = 8) -> list[tuple[int, bytes]]:
    hits: list[tuple[int, bytes]] = []
    start = 0
    while len(hits) < limit:
        i = mm.find(needle, start)
        if i < 0:
            break
        a = max(0, i - width)
        b = min(len(mm), i + len(needle) + width)
        hits.append((i, mm[a:b]))
        start = i + 1
    return hits


def main() -> None:
    lines: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        lines.append(f"size={len(mm)}")
        for n in needles:
            count = 0
            start = 0
            first = -1
            while True:
                i = mm.find(n, start)
                if i < 0:
                    break
                if first < 0:
                    first = i
                count += 1
                start = i + 1
            lines.append(f"COUNT {n!r} {count} first={first}")

        for n in [
            b"channel/permission",
            b"permission_request",
            b"trust gate",
            b"opt-out",
            b"tengu_harbor_permissions",
        ]:
            lines.append(f"\n===== WINDOW {n!r} =====")
            for off, chunk in windows(mm, n, width=500, limit=6):
                text = chunk.decode("latin-1", errors="replace")
                lines.append(f"--- off={off} ---")
                lines.append(text)
                lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

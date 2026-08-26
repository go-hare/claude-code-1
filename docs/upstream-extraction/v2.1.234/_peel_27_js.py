"""Extract gold JS around gate + permission relay (heap ~298101803)."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_27_js.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    raw = mm[a:b]
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in raw)


def find_all(mm: mmap.mmap, n: bytes, limit: int = 8) -> list[int]:
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
    chunks: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        # Gold gate starts at capability skip
        gate = 298101803
        chunks.append("===== GATE @298101803-6k =====\n")
        chunks.append(js_window(mm, gate, 3500, 2800))

        # Permission relay send — look near Vrf usage / experimental permission
        for n in [
            b"Vrf()",
            b"claude/channel/permission",
            b"permission_channel_relay",
            b"e2a",
            b"input_preview",
        ]:
            offs = find_all(mm, n, 6)
            chunks.append(f"\n===== offs {n!r} {offs} =====\n")

        # JS heap copies of permission capability near 29810xxxx
        heap_perm = [o for o in find_all(mm, b"claude/channel/permission", 12) if o > 290000000]
        chunks.append(f"\nheap perm offs={heap_perm}\n")
        for o in heap_perm:
            chunks.append(f"\n===== perm @{o} =====\n")
            chunks.append(js_window(mm, o, 800, 1200))

        # Vrf() call sites (not definition)
        vrf_calls = find_all(mm, b"Vrf()", 8)
        chunks.append(f"\nVrf() offs={vrf_calls}\n")
        for o in vrf_calls:
            chunks.append(f"\n===== Vrf call @{o} =====\n")
            chunks.append(js_window(mm, o, 600, 800))

        # Filter likely uses type==="connected" + experimental + gate
        for n in [
            b'type==="connected"',
            b'type==="connected"&&',
            b"experimental?.",
        ]:
            offs = [o for o in find_all(mm, n, 20) if 297800000 < o < 298400000]
            chunks.append(f"\n===== {n!r} in heap {offs} =====\n")

    OUT.write_text("\n".join(chunks), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

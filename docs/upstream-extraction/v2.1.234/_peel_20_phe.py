"""Narrow windows: Phe/h6 near LI, Io body, Vag highlight, type-clear, clamp."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_phe.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def find_all(mm: mmap.mmap, needle: bytes, start: int, end: int, limit: int = 12) -> list[int]:
    hits: list[int] = []
    i = start
    while len(hits) < limit:
        j = mm.find(needle, i, end)
        if j < 0:
            break
        hits.append(j)
        i = j + 1
    return hits


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        heap0, heap1 = 304500000, 310200000

        parts.append("\n===== LI window large @308985884 =====\n")
        parts.append(js_window(mm, 308985884, 2500, 3500))

        parts.append("\n===== Io / queue-pull-needs-empty-input =====\n")
        i = mm.find(b"queue-pull-needs-empty-input", heap0, heap1)
        parts.append(f"hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 800, 1800))

        parts.append("\n===== input_queue_pop_to_edit =====\n")
        for hit in find_all(mm, b"input_queue_pop_to_edit", heap0, heap1, 8):
            parts.append(f"\n----- @{hit} -----\n")
            parts.append(js_window(mm, hit, 200, 400))

        parts.append("\n===== Phe( near LI heap =====\n")
        for n in (b"function Phe", b"Phe=()", b"Phe=Ts", b"let Phe", b",Phe=", b"Phe()||"):
            hits = find_all(mm, n, heap0, heap1, 8)
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:3]:
                parts.append(f"\n----- @{h} -----\n")
                parts.append(js_window(mm, h, 200, 600))

        parts.append("\n===== h6= / function h6 / h6()===N =====\n")
        for n in (b"h6()===N", b"function h6", b"h6=()", b"let h6=", b"h6=Ts"):
            hits = find_all(mm, n, heap0, heap1, 8)
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:3]:
                parts.append(f"\n----- @{h} -----\n")
                parts.append(js_window(mm, h, 150, 400))

        parts.append("\n===== selectionHighlight: =====\n")
        for n in (b"selectionHighlight:", b"selectionHighlight=", b"queueEditIndex"):
            hits = find_all(mm, n, heap0, heap1, 10)
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:4]:
                parts.append(f"\n----- @{h} -----\n")
                parts.append(js_window(mm, h, 180, 700))

        parts.append("\n===== Clear the input to edit this queued =====\n")
        i = mm.find(b"Clear the input to edit this queued", 0)
        parts.append(f"hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 80, 200))

        parts.append("\n===== GEc / frameExpanded type-clear =====\n")
        for n in (b"footerSelection:null,frameExpanded:!1", b"queueEditIndex!==null)mr(null)"):
            hits = find_all(mm, n, heap0, heap1, 6)
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:2]:
                parts.append(f"\n----- @{h} -----\n")
                parts.append(js_window(mm, h, 250, 500))

        parts.append("\n===== clamp queueEditIndex =====\n")
        for n in (b"if(yo===0)mr(null)", b"Er>yo-1)mr(yo-1)"):
            hits = find_all(mm, n, heap0, heap1, 4)
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:2]:
                parts.append(js_window(mm, h, 200, 400))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

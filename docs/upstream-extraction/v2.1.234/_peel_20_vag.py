"""Peel Vag PromptInputQueuedCommands: lis/yho assignment + h6 getter."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_vag.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        parts.append("\n===== Vag around 308960000 =====\n")
        parts.append(js_window(mm, 308960800, 200, 4500))

        parts.append("\n===== function Vag =====\n")
        i = mm.find(b"function Vag", 308900000, 309100000)
        parts.append(f"hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 80, 5000))

        parts.append("\n===== eQw / lis= / yho= around queued commands =====\n")
        for n in (b"function eQw", b"lis=", b"yho=", b"eQw(", b"gr!==null"):
            hits = []
            start = 308950000
            while len(hits) < 6:
                j = mm.find(n, start, 309020000)
                if j < 0:
                    break
                hits.append(j)
                start = j + 1
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:3]:
                parts.append(f"\n----- @{h} -----\n")
                parts.append(js_window(mm, h, 80, 500))

        parts.append("\n===== h6= near PromptInput 308974000 =====\n")
        for n in (b"function h6", b"h6=()", b"let h6", b"h6=Ts.use", b"h6=vt", b"const h6"):
            hits = []
            start = 308650000
            while len(hits) < 5:
                j = mm.find(n, start, 309050000)
                if j < 0:
                    break
                hits.append(j)
                start = j + 1
            parts.append(f"\n{n!r} {hits}\n")
            for h in hits[:2]:
                parts.append(js_window(mm, h, 100, 250))

        # fii = popAllEditable wrapper
        parts.append("\n===== fii= =====\n")
        i = mm.find(b"fii=(...e)=>", 295000000, 296000000)
        parts.append(f"hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 80, 200))
        i = mm.find(b"popAllEditable:(...e)=>", 295680000, 295700000)
        parts.append(f"\npopAllEditable wrapper hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 50, 300))

        # we( analytics
        parts.append("\n===== we= / function we =====\n")
        i = mm.find(b"function we(", 288000000, 296000000)
        parts.append(f"function we( hit={i}\n")
        if i >= 0:
            parts.append(js_window(mm, i, 40, 300))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

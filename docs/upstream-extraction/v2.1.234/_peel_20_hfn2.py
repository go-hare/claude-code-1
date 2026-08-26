"""Find gold HFn / lte / pop-at-index. mmap only."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_hfn2.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


NEEDLES = [
    b"HFn=",
    b"function HFn",
    b"HFn=function",
    b"HFn=(",
    b"let HFn",
    b"var HFn",
    b"HFn(Er",
    b"function lte(",
    b"lte=()",
    b"function Phe(",
]


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for n in NEEDLES:
            hits: list[int] = []
            start = 290000000
            while len(hits) < 6:
                i = mm.find(n, start)
                if i < 0 or i > 320000000:
                    break
                hits.append(i)
                start = i + 1
            parts.append(f"\n===== {n!r} hits={hits} =====\n")
            for i in hits[:3]:
                parts.append(f"\n----- @{i} -----\n")
                parts.append(js_window(mm, i, 150, 2500))

        # pop-at-index likely near ve / popAllEditable
        for n in (b"function ve(", b"popAllEditable", b"Ft=Je===", b"je.filter"):
            i = mm.find(n, 295000000)
            parts.append(f"\n===== {n!r} @{i} =====\n")
            if i >= 0:
                parts.append(js_window(mm, i, 80, 2000))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

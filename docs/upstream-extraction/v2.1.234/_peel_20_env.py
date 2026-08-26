"""Narrow windows at known JS heap offsets."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_20_env.txt")


def js_window(mm: mmap.mmap, off: int, before: int, after: int) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    return "".join(chr(c) if 32 <= c < 127 else "\n" for c in mm[a:b])


def main() -> None:
    parts: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for off, before, after, label in [
            (288834126, 400, 1500, "env string heap"),
            (294989241, 80, 200, "lte()"),
            (295688000, 3500, 800, "ke + popAll body"),
            (308985884, 50, 900, "LI/na history up/down"),
        ]:
            parts.append(f"\n===== {label} @{off} =====\n")
            parts.append(js_window(mm, off, before, after))

        # find ke helper by unique call ke(Ft,Fe,Xe)
        i = mm.find(b"function ke(", 295680000)
        parts.append(f"\n===== function ke( from 295680000 @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 50, 2500))

        i = mm.find(b"ke=(", 295680000)
        parts.append(f"\n===== ke=( @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 200, 2500))

        # look for helper that extracts text+entries
        i = mm.find(b".entries", 295687000)
        parts.append(f"\n===== .entries near popAll @{i} =====\n")
        if i >= 0:
            parts.append(js_window(mm, i, 800, 400))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

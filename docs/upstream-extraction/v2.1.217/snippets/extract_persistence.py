"""Extract densable Gsn/x0t/ere/FORCE persistence helpers."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_fn(needle: bytes, name: str, length: int = 500) -> None:
    i = DATA.find(needle)
    print(name, i)
    if i < 0:
        return
    R = i
    while R < len(DATA) and R - i < length and 32 <= DATA[R] <= 126:
        R += 1
    (OUT / f"tx3-{name}.txt").write_text(
        DATA[i:R].decode("ascii", "ignore"), encoding="utf-8"
    )


def main() -> None:
    dump_fn(b"function Gsn(){", "Gsn", 500)
    dump_fn(b"function TO(){", "TO", 200)
    dump_fn(b"function x0t", "x0t", 400)
    dump_fn(b"function ere(){", "ere", 400)
    # FORCE near usage
    i = DATA.find(b"CLAUDE_CODE_FORCE_SESSION_PERSISTENCE")
    hits = 0
    while i >= 0 and hits < 6:
        L = max(0, i - 250)
        R = min(len(DATA), i + 500)
        run = "".join(chr(b) if 32 <= b <= 126 else "." for b in DATA[L:R])
        (OUT / f"tx3-force-{hits}.txt").write_text(run, encoding="utf-8")
        print("force hit", hits, i)
        hits += 1
        i = DATA.find(b"CLAUDE_CODE_FORCE_SESSION_PERSISTENCE", i + 1)


if __name__ == "__main__":
    main()

"""Extract densable budget-halt post-action and related helpers."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_hexish(path: Path, data: bytes) -> None:
    text = "".join(
        chr(b) if 32 <= b <= 126 else ("\\n" if b == 10 else f"\\x{b:02x}")
        for b in data
    )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    needle = b"stopping background agents."
    positions: list[int] = []
    start = 0
    while True:
        j = DATA.find(needle, start)
        if j < 0:
            break
        positions.append(j)
        start = j + 1
    print("positions", positions)
    for j in positions:
        dump_hexish(OUT / f"budget-halt-after-{j}.txt", DATA[j : j + 2500])
        print("wrote after", j)

    i = DATA.find(b"if($am(d.maxBudgetUsd")
    print("callsite", i)
    if i >= 0:
        dump_hexish(OUT / "budget-halt-callsite-raw.txt", DATA[i : i + 3000])

    # helpers near kill after budget
    for name, n in [
        ("print-budget-halt-msg", b"print budget halt"),
        ("Budget-limit-reached", b"Budget limit reached ($"),
        ("error_max_budget_usd", b"error_max_budget_usd"),
        ("budget_exhausted", b"budget_exhausted"),
        ("subagent_budget_exhausted", b"subagent_budget_exhausted"),
    ]:
        idx = DATA.find(n)
        print(name, idx)
        if idx >= 0:
            L = idx
            while L > 0 and 32 <= DATA[L - 1] <= 126:
                L -= 1
            R = idx
            while R < len(DATA) and 32 <= DATA[R] <= 126:
                R += 1
            run = DATA[L:R].decode("ascii", "ignore")
            off = idx - L
            window = run[max(0, off - 200) : off + 2200]
            (OUT / f"{name}-ctx.txt").write_text(window, encoding="utf-8")


if __name__ == "__main__":
    main()

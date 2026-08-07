"""Extract densable 2.1.217 Batch C needles for remaining AUDIT items."""
from __future__ import annotations

import re
from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_runs(name: str, needle: bytes, limit: int = 6, min_run: int = 40) -> None:
    lines: list[str] = []
    start = 0
    hits = 0
    while hits < limit:
        i = DATA.find(needle, start)
        if i < 0:
            break
        L = i
        while L > 0 and 32 <= DATA[L - 1] <= 126:
            L -= 1
        R = i
        while R < len(DATA) and 32 <= DATA[R] <= 126:
            R += 1
        run = DATA[L:R].decode("ascii", "ignore")
        if len(run) >= min_run:
            off = i - L
            window = run[max(0, off - 500) : off + 900]
            lines.append(f"--- {needle!r} @{i} runlen={len(run)} ---")
            lines.append(window)
            lines.append("")
            hits += 1
        start = i + 1
    body = "\n".join(lines) if lines else f"{needle!r}: NOT FOUND\n"
    (OUT / f"{name}.txt").write_text(body, encoding="utf-8")
    print(name, "hits", hits, "bytes", len(body))


def main() -> None:
    pairs = [
        ("session-saving-off", b"session saving"),
        ("transcript-write-fail", b"Failed to write"),
        ("transcript-save", b"Transcript"),
        ("mcp-truncate-full", b"truncated"),
        ("symlink-cwd", b"realpath"),
        ("canonicalize-cwd", b"canonicalize"),
        ("auto-compact-over", b"over limit"),
        ("screen-reader", b"screen reader"),
        ("thinking-status", b"thinking"),
        ("OTEL_EXPORTER", b"OTEL_EXPORTER_OTLP_ENDPOINT"),
        ("malformed-attachment", b"malformed"),
        ("attachment-TypeError", b"TypeError"),
        ("bg-shell-stop", b"backgrounded"),
        ("max-budget-usd", b"max-budget-usd"),
        ("maxBudgetUsd", b"maxBudgetUsd"),
        ("budget-halt", b"budget"),
        ("attach-gap", b"attach"),
    ]
    for name, needle in pairs:
        dump_runs(name, needle, limit=4)


if __name__ == "__main__":
    main()

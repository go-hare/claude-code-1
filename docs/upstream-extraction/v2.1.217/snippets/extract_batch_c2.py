"""Deeper densable 2.1.217 Batch C extracts — better needles."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_runs(name: str, needle: bytes, limit: int = 8, min_run: int = 30) -> None:
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
            window = run[max(0, off - 600) : off + 1200]
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
        # #20 budget
        ("budget-halt-print", b"print budget halt"),
        ("budget-stopping-bg", b"stopping background agents"),
        ("budget-exhausted", b"subagent_budget_exhausted"),
        ("budget-Hrr", b"Hrr("),
        ("budget-$am", b"$am("),
        ("New agents cannot", b"New agents cannot be started"),
        # #2 transcript
        ("transcript-failing", b"transcript"),
        ("session-saving-is", b"session saving is"),
        ("CLAUDE_CODE_DISABLE_SESSION", b"CLAUDE_CODE_DISABLE"),
        ("disable-session", b"disableSession"),
        ("saving is off", b"saving is off"),
        ("writes are failing", b"writes are failing"),
        ("disk full", b"disk full"),
        ("Failed to save", b"Failed to save"),
        ("session storage", b"session storage"),
        ("transcript write", b"transcript write"),
        ("unable to write", b"unable to write"),
        # #3 MCP truncate
        ("MCP tool output", b"MCP tool"),
        ("untruncated", b"untruncated"),
        ("truncated result", b"truncated result"),
        ("content too large", b"content too large"),
        ("maxResultSize", b"maxResultSize"),
        ("truncateMcp", b"truncate"),
        # #5 symlink
        ("symlinked working", b"symlink"),
        ("realPathSync", b"realpathSync"),
        ("canonicalPath", b"canonical"),
        # #6 opus 4.8 bedrock
        ("opus-4-8", b"opus-4-8"),
        ("auto-compact", b"auto-compact"),
        ("autoCompact", b"autoCompact"),
        ("compact over", b"over the limit"),
        # #8 screen reader
        ("screenReader", b"screenReader"),
        ("screen-reader-mode", b"screen reader"),
        ("startup announcement", b"announcement"),
        # #9 OTEL
        ("OTEL_EXPORTER_OTLP_ENDPOINT", b"OTEL_EXPORTER_OTLP_ENDPOINT"),
        ("signal-specific", b"signal"),
        # #10 malformed attachment
        ("malformed attachment", b"malformed"),
        ("attachment entry", b"attachment"),
        # #12 bg shell stop
        ("background shells", b"background shell"),
        ("impossible to stop", b"impossible to stop"),
        ("task_stop", b"task_stop"),
        ("killShell", b"killShell"),
        # #14 attach gap
        ("one-line gap", b"one-line"),
        ("transcript preview", b"transcript preview"),
        ("attach gap", b"attach"),
    ]
    for name, needle in pairs:
        # sanitize filename
        safe = name.replace(" ", "-").replace("/", "_").replace("(", "").replace(")", "")
        dump_runs(safe, needle, limit=5)


if __name__ == "__main__":
    main()

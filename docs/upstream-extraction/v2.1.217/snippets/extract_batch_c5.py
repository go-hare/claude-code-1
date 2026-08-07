"""densable 2.1.217 Batch C5 — Xqc/qXn, OTEL managed supremacy, attachment migrate, MCP leak, attach gap."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_runs(
    name: str,
    needle: bytes,
    limit: int = 6,
    min_run: int = 16,
    before: int = 500,
    after: int = 2500,
) -> None:
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
            window = run[max(0, off - before) : off + after]
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
        # #8 Xqc / qXn around srStartupQuietTimer
        ("c5-function-Xqc", b"function Xqc"),
        ("c5-Xqc=", b"Xqc="),
        ("c5-function-qXn", b"function qXn"),
        ("c5-qXn=", b"qXn="),
        ("c5-sr-quiet-ms", b"STARTUP_QUIET"),
        ("c5-quiet-ms", b"quietMs"),
        ("c5-INK_SCREEN", b"INK_SCREEN_READER"),
        ("c5-thinking-for", b"thinking for"),
        ("c5-token-count-status", b"tokens \xb7"),
        ("c5-SpinnerMessage", b"SpinnerMessage"),
        ("c5-status-row", b"status row"),
        ("c5-elapsed-seconds", b"elapsedSeconds"),
        # #9 managed OTEL
        ("c5-managed-env-apply", b"policySettings"),
        ("c5-settings-env", b"settings.env"),
        ("c5-otel-endpoint-managed", b"OTEL_EXPORTER_OTLP_ENDPOINT"),
        ("c5-delete-env", b"delete process.env"),
        ("c5-delete-Z", b"delete Z."),
        ("c5-signal-override", b"signal-specific"),
        ("c5-lower-scope", b"lower-scope"),
        ("c5-env-source", b"envSource"),
        ("c5-managed-wins", b"managedWins"),
        # #10 malformed attachment TypeError
        ("c5-Cannot-destructure", b"Cannot destructure property"),
        ("c5-attachment-undefined", b"attachment is undefined"),
        ("c5-optional-attachment", b"message.attachment"),
        ("c5-type-attachment", b'type:"attachment"'),
        ("c5-migrate-attachment", b"new_directory"),
        ("c5-safe-attachment", b"attachment?."),
        # #3 MCP full buffer
        ("c5-content-a-replace", b"content:a}"),
        ("c5-KLg-replace", b"function KLg"),
        ("c5-replacements-map", b"replacements.set"),
        ("c5-null-out", b"content=null"),
        ("c5-delete-content", b"delete e.content"),
        # #6 opus 4.8 supports 1m
        ("c5-modelSupports1M", b"modelSupports1M"),
        ("c5-supports_1m_beta", b"supports_1m_beta"),
        ("c5-native_1m", b"native_1m"),
        ("c5-opus-4-8-1m", b"opus-4-8"),
        ("c5-W_e", b"function W_e"),
        ("c5-pNe", b"function pNe"),
        # #5 bg isolation
        ("c5-session-kind", b'CLAUDE_CODE_SESSION_KIND==="bg"'),
        ("c5-bg-backend", b"CLAUDE_BG_BACKEND"),
        ("c5-sandbox-roots", b"sandboxRoots"),
        ("c5-allowed-cwd", b"allowedCwd"),
        ("c5-cwd-boundary", b"cwdBoundary"),
        ("c5-workspace-boundary", b"workspaceBoundary"),
        ("c5-realpath-sync", b"realpathSync"),
        # #12
        ("c5-killShellTasks", b"killShellTasks"),
        ("c5-shell-pressure", b"pressure"),
        ("c5-stop-bg-shell", b"stopBackground"),
        ("c5-taskkill-T-F", b'"/T","/F"'),
        ("c5-JobObject", b"JobObject"),
        # #14 attach gap
        ("c5-marginBottom-1", b"marginBottom:1"),
        ("c5-paddingBottom-1", b"paddingBottom:1"),
        ("c5-PromptInput", b"PromptInput"),
        ("c5-Messages-gap", b"Messages"),
        ("c5-footer-gap", b"footer"),
    ]
    for name, needle in pairs:
        dump_runs(name, needle, limit=4)


if __name__ == "__main__":
    main()

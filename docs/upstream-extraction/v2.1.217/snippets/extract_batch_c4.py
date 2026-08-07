"""densable 2.1.217 Batch C4 — precise function-body extracts."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_runs(name: str, needle: bytes, limit: int = 8, min_run: int = 20, before: int = 400, after: int = 2000) -> None:
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
        # #3 densable Qmu path + message-level budget that replaces content
        ("c4-Qmu", b"async function Qmu"),
        ("c4-Jmu", b"async function Jmu"),
        ("c4-ter", b"async function ter("),
        ("c4-Iit", b"async function Iit"),
        ("c4-Rit", b"function Rit"),
        ("c4-KLg", b"function KLg"),
        ("c4-YLg", b"async function YLg"),
        ("c4-ohu", b"async function ohu"),
        ("c4-message-budget", b"Per-message budget"),
        ("c4-replacements", b"replacements.set"),
        ("c4-newlyReplaced", b"newlyReplaced"),
        # #5 bg isolation cwd
        ("c4-bg-cwd", b"CLAUDE_CODE_BGS"),
        ("c4-session-kind-bg", b"CLAUDE_CODE_SESSION_KIND"),
        ("c4-workspace-root", b"workspaceRoot"),
        ("c4-sandbox-cwd", b"sandboxCwd"),
        ("c4-restrict-cwd", b"restrictToCwd"),
        ("c4-path-inside", b"pathIsInside"),
        ("c4-isPathInside", b"isPathInside"),
        ("c4-resolve-path", b"resolvePath"),
        ("c4-safe-cwd", b"safeCwd"),
        ("c4-original-cwd-real", b"originalCwd"),
        # #6 compact over limit / bedrock
        ("c4-over-context", b"over the context"),
        ("c4-context-too-long", b"context_too_long"),
        ("c4-prompt-too-long", b"prompt is too long"),
        ("c4-input-too-long", b"input is too long"),
        ("c4-compacting", b"Compacting"),
        ("c4-manual-compact", b"manual compact"),
        ("c4-isOverCompact", b"isOverCompact"),
        ("c4-effectiveWindow", b"effectiveWindow"),
        ("c4-getContextWindow", b"getContextWindow"),
        ("c4-tokenCountWith", b"tokenCountWith"),
        # #8 screen reader quiet timer
        ("c4-srStartupQuiet", b"srStartupQuietTimer"),
        ("c4-quietTimer", b"QuietTimer"),
        ("c4-startup-quiet", b"startupQuiet"),
        ("c4-screen-reader-quiet", b"screen reader"),
        ("c4-LogoV2", b"LogoV2"),
        ("c4-thinking-elapsed", b"thinking for"),
        ("c4-Spinner", b"elapsedTime"),
        # #9 managed OTEL supremacy
        ("c4-managed-settings-otel", b"managedSettings"),
        ("c4-applyManagedEnv", b"applyManagedEnv"),
        ("c4-HOST_OTEL", b"HOST_OTEL"),
        ("c4-delete-signal", b"OTLP_TRACES_ENDPOINT"),
        ("c4-strip-signal", b"stripSignal"),
        ("c4-clear-signal-endpoint", b"TRACES_ENDPOINT"),
        ("c4-managed-env-keys", b"OTEL_EXPORTER_OTLP_ENDPOINT"),
        # #10 malformed attachment
        ("c4-transform-attachment", b"transformLegacy"),
        ("c4-attachment-type", b'"attachment"'),
        ("c4-message-attachment", b"message.attachment"),
        ("c4-new_file", b"new_file"),
        ("c4-displayPath", b"displayPath"),
        ("c4-invoked_skills", b"invoked_skills"),
        ("c4-skill_listing", b"skill_listing"),
        # #12 bg shell stop after bg
        ("c4-backgroundedByUser", b"backgroundedByUser"),
        ("c4-sent-to-background", b"sent to the background"),
        ("c4-stop-local-shell", b"stopLocalShell"),
        ("c4-LocalShellTask", b"local_bash"),
        ("c4-kill-on-exit", b"killOnExit"),
        ("c4-session-exit-kill", b"session exit"),
        ("c4-orphaned", b"orphaned"),
        ("c4-reap", b"reapShell"),
        # #14 attach gap
        ("c4-attach-preview", b"attachTranscript"),
        ("c4-cold-attach", b"cold attach"),
        ("c4-preview-frame", b"previewFrame"),
        ("c4-margin-bottom-1", b"marginBottom:1"),
        ("c4-padding-bottom-1", b"paddingBottom:1"),
        ("c4-gap-1", b"gap:1"),
    ]
    for name, needle in pairs:
        dump_runs(name, needle, limit=5)


if __name__ == "__main__":
    main()

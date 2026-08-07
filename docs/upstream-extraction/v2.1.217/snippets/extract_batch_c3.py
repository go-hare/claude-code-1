"""densable 2.1.217 Batch C remaining AUDIT extracts."""
from __future__ import annotations

from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT = Path(__file__).resolve().parent


def dump_runs(name: str, needle: bytes, limit: int = 10, min_run: int = 24) -> None:
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
            window = run[max(0, off - 800) : off + 1600]
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
        # #3 MCP truncate memory leak
        ("mcp-maxResultSizeChars", b"maxResultSizeChars"),
        ("mcp-tool_result_persisted", b"tengu_tool_result_persisted"),
        ("mcp-persisted-output", b"persisted-output"),
        ("mcp-Old-tool-result", b"Old tool result content cleared"),
        ("mcp-MAX_MCP_OUTPUT", b"MAX_MCP_OUTPUT"),
        ("mcp-mcp_output_tokens", b"mcp_output"),
        ("mcp-full-content-released", b"full content"),
        ("mcp-release-result", b"releaseResult"),
        ("mcp-clearToolResult", b"clearToolResult"),
        ("mcp-toolResultStorage", b"toolResultStorage"),
        ("mcp-originalContent", b"originalContent"),
        ("mcp-untruncated-content", b"untruncatedContent"),
        ("mcp-content-replaced", b"content replaced"),
        ("mcp-preview-only", b"preview only"),
        ("mcp-Jdo", b"Jdo"),
        # #5 symlink cwd canonicalize for bg isolation
        ("bg-isolate", b"background session isolation"),
        ("bg-workspace-folder", b"workspace folder"),
        ("bg-symlink-cwd", b"symlinked working"),
        ("bg-canonicalize", b"canonicalize"),
        ("bg-realpath-cwd", b"realpath"),
        ("bg-getOriginalCwd", b"getOriginalCwd"),
        ("bg-resolveCwd", b"resolveCwd"),
        ("bg-session-cwd", b"sessionCwd"),
        ("bg-isolated-cwd", b"isolatedCwd"),
        ("bg-escape-workspace", b"escape"),
        # #6 opus 4.8 bedrock auto-compact
        ("opus48-bedrock", b"opus-4-8"),
        ("opus48-model-id", b"claude-opus-4-8"),
        ("compact-over-limit", b"over the limit"),
        ("compact-never-trigger", b"never trigger"),
        ("autoCompact-enabled", b"autoCompactEnabled"),
        ("isAutoCompact", b"isAutoCompact"),
        ("compact-threshold", b"compactThreshold"),
        ("bedrock-compact", b"bedrock"),
        ("token-count-for-compact", b"tokenCount"),
        ("context-window-compact", b"context window"),
        # #8 screen reader
        ("sr-startup", b"Screen reader"),
        ("sr-mode", b"screenReaderMode"),
        ("sr-announcement", b"aria-live"),
        ("sr-thinking-status", b"thinking status"),
        ("sr-elapsed", b"elapsed"),
        ("sr-re-render", b"token counts"),
        ("sr-isScreenReader", b"isScreenReaderEnabled"),
        ("sr-announce", b"announce"),
        # #9 OTEL managed endpoint
        ("otel-endpoint", b"OTEL_EXPORTER_OTLP_ENDPOINT"),
        ("otel-traces", b"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
        ("otel-metrics", b"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
        ("otel-logs", b"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"),
        ("otel-managed", b"managed endpoint"),
        ("otel-signal-specific", b"signal-specific"),
        ("otel-applyManaged", b"applyManaged"),
        ("otel-otlp", b"OTLP"),
        # #10 malformed attachment
        ("att-malformed", b"malformed attachment"),
        ("att-TypeError", b"TypeError"),
        ("att-attachment-type", b"attachment"),
        ("att-parseAttachment", b"parseAttachment"),
        ("att-isAttachment", b"isAttachment"),
        ("att-safeParse", b"safeParse"),
        ("att-content-block", b"content block"),
        # #12 bg shell stop
        ("shell-impossible", b"impossible to stop"),
        ("shell-background-stop", b"background shells"),
        ("shell-task-stop", b"taskStop"),
        ("shell-kill-pg", b"killProcessTree"),
        ("shell-tree-kill", b"tree-kill"),
        ("shell-taskkill", b"taskkill"),
        ("shell-CTRL_BREAK", b"CTRL_BREAK"),
        ("shell-job-object", b"JobObject"),
        ("shell-AssignProcess", b"AssignProcessToJobObject"),
        ("shell-isWindowsShell", b"Windows"),
        ("shell-abortController", b"abortController"),
        ("shell-stopped-bg", b"stopped background"),
        # #14 attach gap
        ("attach-one-line-gap", b"one-line gap"),
        ("attach-transcript-preview", b"TranscriptPreview"),
        ("attach-flush", b"flush against"),
        ("attach-input-area", b"input area"),
        ("attach-marginBottom", b"marginBottom"),
        ("attach-paddingBottom", b"paddingBottom"),
        ("attach-starting-bg", b"starting background"),
        ("attach-live-layout", b"live layout"),
    ]
    for name, needle in pairs:
        safe = (
            name.replace(" ", "-")
            .replace("/", "_")
            .replace("(", "")
            .replace(")", "")
        )
        dump_runs(safe, needle, limit=6)


if __name__ == "__main__":
    main()

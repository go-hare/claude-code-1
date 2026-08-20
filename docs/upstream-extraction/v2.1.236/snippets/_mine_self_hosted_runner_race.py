#!/usr/bin/env python3
"""Mine SEA for self-hosted-runner release/retire vs post-session hook await order."""
from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/_mine_self_hosted_runner_race.out.txt"
)
data = SEA.read_bytes()


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def dump(lines: list[str], needle: bytes, radius: int = 550, limit: int = 20) -> None:
    start = 0
    shown = 0
    lines.append(f"\n==== {needle.decode('utf-8', 'replace')} ====")
    while shown < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        lo = max(0, i - radius)
        hi = min(len(data), i + len(needle) + radius)
        lines.append(f"--- offset {i} ---")
        lines.append(printable(data[lo:hi]))
        lines.append("")
        start = i + 1
        shown += 1
    lines.append(f"(shown {shown}, total {data.count(needle)})")


lines: list[str] = []
lines.append(f"SEA={SEA}")
lines.append(f"size={len(data)}")

needles = [
    b"not awaiting",
    b"fire-and-forget",
    b"before hook",
    b"after hook",
    b"hook completed",
    b"hook complete",
    b"hook starting",
    b"[runner:retire]",
    b"[runner:hook] post-session",
    b"[runner:hook:post-session]",
    b"SELF_HOSTED_RUNNER_SESSION_IDLE_MS",
    b"SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS",
    b"can be resumed",
    b"claimable",
    b"push-outcome-on-release",
    b"release-idle-session-min",
    b"--retire-at",
    b"startup-timeout-min",
    b"post-session-hook-timeout-sec",
]

for n in needles:
    dump(lines, n, 600, 15)

# Filtered reclaim near runner/session/idle/hook
lines.append("\n==== filtered reclaim near runner|session|idle|hook|retire ====")
start = 0
shown = 0
while shown < 20:
    i = data.find(b"reclaim", start)
    if i < 0:
        break
    text = printable(data[max(0, i - 400) : i + 500])
    low = text.lower()
    if any(k in low for k in ("runner", "session", "idle", "hook", "retire", "release")):
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
        shown += 1
    start = i + 1
lines.append(f"(shown {shown})")

# Filtered retiring/retired near release/hook
for label, needle in [
    ("retiring", b"retiring"),
    ("retired", b"retired"),
    ("releasing", b"releasing"),
    ("released", b"released"),
]:
    lines.append(f"\n==== filtered '{label}' near runner|hook|idle|post-session ====")
    start = 0
    shown = 0
    while shown < 25:
        i = data.find(needle, start)
        if i < 0:
            break
        text = printable(data[max(0, i - 350) : i + 450])
        low = text.lower()
        if any(
            k in low
            for k in (
                "[runner",
                "post-session",
                "release-idle",
                "idle session",
                "startup-timeout",
                "hook",
            )
        ):
            lines.append(f"--- offset {i} ---")
            lines.append(text)
            lines.append("")
            shown += 1
        start = i + 1
    lines.append(f"(shown {shown})")

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT} bytes={OUT.stat().st_size}")

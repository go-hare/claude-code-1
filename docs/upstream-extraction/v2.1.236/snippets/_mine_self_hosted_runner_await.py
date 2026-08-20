#!/usr/bin/env python3
"""Mine SEA for release vs post-session await order / gates."""
from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/_mine_self_hosted_runner_await.out.txt"
)
data = SEA.read_bytes()


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def dump(lines: list[str], needle: bytes, radius: int = 900, limit: int = 12) -> None:
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
for n in [
    b"releaseForRetire",
    b"idle-release",
    b"awaiting server deassign",
    b"in-flight release",
    b"post-session hook",
    b"async function jxy",
    b"function jxy",
    b"etu()",
    b"inFlight++",
    b"parked, resumable",
    b"released (parked",
    b"sessions were released",
    b"can be resumed",
    b"claimable",
    b"SELF_HOSTED_RUNNER_RETIRE_AT",
    b"SELF_HOSTED_RUNNER_IDLE_SHUTDOWN_MS",
    b"SELF_HOSTED_RUNNER_DRAIN_GRACE_MS",
    b"SELF_HOSTED_RUNNER_SESSION_IDLE_MS",
    b"SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS",
    b"push-outcome-on-release",
    b"releaseForIdle",
    b"releaseIdle",
    b"onRelease",
    b"sessionIdle",
    b"startup timeout",
    b"startup-timeout",
    b"[runner:startup]",
    b"[runner:session]",
]:
    dump(lines, n, 1000 if b"jxy" in n or b"post-session" in n or b"releaseFor" in n else 700, 10)

# Large window around the jxy hook implementation (minified JS)
needle = b"async function jxy(e){"
i = data.find(needle)
if i >= 0:
    lines.append("\n==== FULLISH jxy window ====")
    lines.append(f"--- offset {i} ---")
    lines.append(printable(data[i : i + 6000]))

# Window around releaseForRetire usages
needle = b"releaseForRetire"
start = 0
shown = 0
while shown < 8:
    i = data.find(needle, start)
    if i < 0:
        break
    lines.append(f"\n==== releaseForRetire WINDOW {shown} @ {i} ====")
    lines.append(printable(data[max(0, i - 1500) : i + 2500]))
    start = i + 1
    shown += 1

# idle-release windows
needle = b"idle-release"
start = 0
shown = 0
while shown < 10:
    i = data.find(needle, start)
    if i < 0:
        break
    lines.append(f"\n==== idle-release WINDOW {shown} @ {i} ====")
    lines.append(printable(data[max(0, i - 1200) : i + 2200]))
    start = i + 1
    shown += 1

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT} bytes={OUT.stat().st_size}")

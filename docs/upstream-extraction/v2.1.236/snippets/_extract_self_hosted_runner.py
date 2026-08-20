#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-self-hosted-runner.txt"
)


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def contexts(needle: bytes, radius: int = 200, limit: int = 40):
    start = 0
    hits = []
    while len(hits) < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        lo = max(0, i - radius)
        hi = min(len(data), i + len(needle) + radius)
        hits.append((i, printable(data[lo:hi])))
        start = i + 1
    return hits, data.count(needle)


lines: list[str] = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version: 2.1.236 (claude --version)")
lines.append("bullet: #17 key=self-hosted-runner")
lines.append("")

patterns = [
    b"self-hosted runner",
    b"self-hosted-runner",
    b"selfHostedRunner",
    b"SelfHostedRunner",
    b"post-session hook",
    b"postSessionHook",
    b"post_session_hook",
    b"retire",
    b"retireSession",
    b"retire runner",
    b"runner retire",
]

lines.append("=== pattern counts ===")
for p in patterns:
    lines.append(f"{p!r}: {data.count(p)}")
lines.append("")

# Exact requested patterns
for label, needle in [
    ("self-hosted runner", b"self-hosted runner"),
    ("post-session hook", b"post-session hook"),
    ("retire", b"retire"),
]:
    hits, total = contexts(needle, 200, 40)
    lines.append(f"=== exact '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Related / refined
for label, needle in [
    ("self-hosted-runner", b"self-hosted-runner"),
    ("selfHostedRunner", b"selfHostedRunner"),
    ("SelfHostedRunner", b"SelfHostedRunner"),
    ("postSessionHook", b"postSessionHook"),
    ("retireSession", b"retireSession"),
    ("retire runner", b"retire runner"),
]:
    hits, total = contexts(needle, 220, 25)
    lines.append(f"=== related '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Prefer retire hits that also mention runner/session/hook nearby
lines.append("=== filtered 'retire' contexts containing runner|session|hook ===")
hits, total = contexts(b"retire", 240, 80)
kept = 0
for i, text in hits:
    low = text.lower()
    if any(k in low for k in ("runner", "session", "hook", "self-hosted")):
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
        kept += 1
lines.append(f"(kept {kept} of first {len(hits)} retire hits; total retire={total})")
lines.append("")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out} bytes={out.stat().st_size}")

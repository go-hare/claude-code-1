#!/usr/bin/env python3
from pathlib import Path

sea = Path("/tmp/official-236/plat/package/claude")
data = sea.read_bytes()
out = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/hit-cloud-env-empty.txt"
)


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def contexts(needle: bytes, radius: int = 200, limit: int = 50):
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


patterns = [
    b"cloud environments list",
    b"empty or malformed",
    # related variants
    b"cloud environment",
    b"cloudEnvironments",
    b"CloudEnvironments",
    b"environments list",
    b"empty or malformed",
    b"malformed environment",
    b"CloudEnv",
    b"cloud_env",
    b"listCloudEnvironments",
    b"cloud environments",
]

lines = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version: 2.1.236 (Claude Code)")
lines.append("key: cloud-env-empty")
lines.append('patterns: ["cloud environments list","empty or malformed"]')
lines.append("")
lines.append("=== pattern counts ===")
seen = set()
for p in patterns:
    key = p.decode("latin1")
    if key in seen:
        continue
    seen.add(key)
    c = data.count(p)
    lines.append(f"{p!r}: {c}")
lines.append("")

# Exact requested patterns with context
for label, needle in [
    ("cloud environments list", b"cloud environments list"),
    ("empty or malformed", b"empty or malformed"),
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

# Related contexts that may co-locate with the empty/malformed path
for label, needle in [
    ("cloud environments", b"cloud environments"),
    ("cloud environment", b"cloud environment"),
    ("listCloudEnvironments", b"listCloudEnvironments"),
    ("cloudEnvironments", b"cloudEnvironments"),
    ("CloudEnvironments", b"CloudEnvironments"),
]:
    hits, total = contexts(needle, 200, 30)
    lines.append(f"=== related '{label}' hits total={total} ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    lines.append("")

# Cross-check: empty or malformed near cloud
needle = b"empty or malformed"
start = 0
cloud_near = []
while True:
    i = data.find(needle, start)
    if i < 0:
        break
    lo = max(0, i - 400)
    hi = min(len(data), i + len(needle) + 400)
    window = data[lo:hi]
    if b"cloud" in window.lower() or b"environment" in window.lower():
        cloud_near.append((i, printable(window)))
    start = i + 1

lines.append(
    f"=== 'empty or malformed' windows mentioning cloud/environment total={len(cloud_near)} ==="
)
if not cloud_near:
    lines.append("(none)")
for i, text in cloud_near[:40]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")

out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out}")
print("\n".join(lines[:80]))

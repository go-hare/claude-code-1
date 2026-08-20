#!/usr/bin/env python3
from pathlib import Path

data = Path("/tmp/official-236/plat/package/claude").read_bytes()


def extract(off: int, before: int = 100, after: int = 700) -> str:
    start = max(0, off - before)
    end = min(len(data), off + after)
    text = data[start:end].decode("latin1")
    out = []
    for ch in text:
        o = ord(ch)
        if ch in "\n\r\t" or 32 <= o < 127:
            out.append(ch)
        else:
            out.append(".")
    return "".join(out)


def find_all(pat: bytes, limit: int = 40):
    hits = []
    start = 0
    while len(hits) < limit:
        i = data.find(pat, start)
        if i < 0:
            break
        hits.append(i)
        start = i + 1
    return hits


print("=== process.env.ANTHROPIC_MODEL ===")
for off in [0x10ACB688, 0x1104E1AA, 0x1104E1D1, 0x1208FECB, 0x121331D0, 0x1225DE4E]:
    print(f"\n@{hex(off)}")
    print(extract(off, 150, 350))

print("\n=== V.ANTHROPIC_MODEL ===")
for off in [0x10AD05B5, 0x1104A073, 0x114A5A67, 0x114A5B8F, 0x11CD83A1]:
    print(f"\n@{hex(off)}")
    print(extract(off, 120, 300))

print("\n=== qxt ===")
print(extract(0x10ACD4F0, 20, 200))

i = data.find(b"function ibn(")
print("\nibn at", hex(i) if i >= 0 else None)
if i >= 0:
    print(extract(i, 20, 500))

print("\n=== kv_ ===")
print(extract(0x10991542, 400, 1200))

print("\n=== tengu event wider ===")
print(extract(0x1225DE2F, 80, 250))

print("\n=== startup telemetry wider ===")
print(extract(0x12086244, 80, 450))

print("\n=== fallback wider ===")
print(extract(0x1208FE9A, 80, 250))

# helpers around zxt guards
for name in [b"function Z0e(", b"function zYs(", b"function dhd(", b"function Hu(", b"function A7e("]:
    offs = find_all(name, 3)
    print(f"\n{name!r} {[hex(x) for x in offs]}")
    if offs:
        print(extract(offs[0], 10, 350))

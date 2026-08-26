from pathlib import Path

p = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-214/package/claude.exe")
data = p.read_bytes()
print("size", len(data))


def to_text(chunk: bytes) -> str:
    out = []
    for c in chunk:
        if 32 <= c < 127 or c in (9, 10, 13):
            out.append(chr(c))
        else:
            out.append("\\x{:02x}".format(c))
    return "".join(out)


def find_all(needle: bytes, maxn: int = 20, min_off: int = 0, max_off: int | None = None):
    i = min_off
    pos = []
    while len(pos) < maxn:
        j = data.find(needle, i)
        if j < 0:
            break
        if max_off is not None and j >= max_off:
            break
        pos.append(j)
        i = j + 1
    return pos


def dump_at(label: str, off: int, before: int = 500, after: int = 1500):
    a = max(0, off - before)
    b = min(len(data), off + after)
    print("\n" + "=" * 80)
    print(f"{label} @ {off}")
    print(to_text(data[a:b]))


def dump_needle(label: str, needle: bytes, before=500, after=1500, min_off=0, maxn=5, max_off=None):
    pos = find_all(needle, maxn=maxn, min_off=min_off, max_off=max_off)
    if not pos:
        print(f"\n{label}: none in range min_off={min_off}")
        return
    for off in pos:
        dump_at(label, off, before=before, after=after)


# High-offset JS region probes
for label, needle in [
    ("fd redirect", b"fd redirect"),
    ("--connection", b"--connection"),
    ("--identity", b"--identity"),
    ("fail-closed", b"fail-closed"),
    ("podman", b"podman"),
    ("pkill", b"pkill"),
    ("magic-file", b"magic-file"),
    ("files-from", b"files-from"),
    ("10000", b"10000"),
    ("self kill", b"self"),
]:
    dump_needle(label + " HIGH", needle, before=700, after=2000, min_off=220_000_000, maxn=4)

# Mid pkill
print("\n### pkill MID")
for off in find_all(b"pkill", maxn=15, min_off=100_000_000, max_off=120_000_000):
    dump_at("pkill mid", off, before=500, after=1500)

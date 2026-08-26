"""mmap-only extract of gold gateChannelServer + permission relay filter."""

import mmap
from pathlib import Path

SEA = Path(r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe")
OUT = Path(__file__).with_name("_peel_27_gate.txt")

needles = [
    b"function Vrf()",
    b"function jrf(",
    b"function qrf(",
    b"action:\"skip\",kind:\"capability\"",
    b"kind:\"allowlist\"",
    b"kind:\"disabled\"",
    b"kind:\"auth\"",
    b"kind:\"policy\"",
    b"kind:\"session\"",
    b"kind:\"marketplace\"",
    b"claude/channel/permission",
    b"dangerously-load-development-channels",
    b"allowedChannelPlugins",
    b"channelsEnabled",
    b"filterPermission",
    b"permission_request failed",
    b"Channel permission_request",
    b"input_preview",
    b"tengu_harbor_permissions",
]


def extract_js(mm: mmap.mmap, off: int, before: int = 2500, after: int = 4500) -> str:
    a = max(0, off - before)
    b = min(len(mm), off + after)
    raw = mm[a:b]
    # keep printable + common js
    out = []
    for ch in raw:
        if 32 <= ch < 127 or ch in (9, 10, 13):
            out.append(chr(ch))
        else:
            out.append("\n" if len(out) and out[-1] != "\n" else "")
    text = "".join(out)
    # collapse huge blank runs
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text


def main() -> None:
    lines: list[str] = []
    with SEA.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
        for n in needles:
            i = mm.find(n)
            count = 0
            start = 0
            first = -1
            while True:
                j = mm.find(n, start)
                if j < 0:
                    break
                if first < 0:
                    first = j
                count += 1
                start = j + 1
            lines.append(f"COUNT {n!r} {count} first={first}")

        # Primary JS heap around allowlist skip (seen at ~298103488)
        target = mm.find(b'is not on the approved channels allowlist')
        lines.append(f"\n===== allowlist reason off={target} =====\n")
        if target >= 0:
            lines.append(extract_js(mm, target, 4000, 2500))

        # Also Vrf/jrf nearby (tengu_harbor_permissions function)
        vrf = mm.find(b"function Vrf()")
        lines.append(f"\n===== Vrf off={vrf} =====\n")
        if vrf >= 0:
            lines.append(extract_js(mm, vrf, 200, 3500))

        # Permission request send site
        send = mm.find(b"Channel permission_request failed")
        if send < 0:
            send = mm.find(b"permission_request failed for")
        lines.append(f"\n===== send fail off={send} =====\n")
        if send >= 0:
            lines.append(extract_js(mm, send, 3500, 1500))

        # Filter of clients — look for experimental permission check near send
        filt = mm.find(b'experimental?.["claude/channel/permission"]')
        if filt < 0:
            filt = mm.find(b'["claude/channel/permission"]')
        lines.append(f"\n===== perm cap check off={filt} =====\n")
        if filt >= 0:
            lines.append(extract_js(mm, filt, 1800, 1800))

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

"""Extract densable 2.1.217 Batch B artifacts (emoji map, regexes)."""
from __future__ import annotations

import codecs
import json
import re
from pathlib import Path

DATA = Path(
    r"C:/Users/ADMINI~1/AppData/Local/Temp/official-217/package/claude.exe"
).read_bytes()
OUT_DIR = Path(__file__).resolve().parent
SRC_EMOJI = Path(
    r"D:/work/py/claude/claude-code/src/utils/emoji/shortcodes.json"
)


def extract_emoji_map() -> dict[str, str]:
    start = DATA.find(b"bZo={")
    # densable: bZo={...}});var axf=...  → match starts at outer `}` after object close
    end = DATA.find(b"});var axf={};rt(axf,{getEmojiSuggestions")
    if start < 0 or end < 0:
        raise SystemExit(f"map bounds missing start={start} end={end}")
    # include object-closing `}` only (char before outer `}` of the match)
    text = DATA[start + len(b"bZo=") : end].decode("ascii")
    i = 1  # skip {
    n = len(text) - 1  # exclude final }
    emoji_map: dict[str, str] = {}
    while i < n:
        while i < n and text[i] in " \t\n\r,":
            i += 1
        if i >= n:
            break
        if text[i] == '"':
            i += 1
            key_chars: list[str] = []
            while i < n:
                ch = text[i]
                if ch == "\\" and i + 1 < n:
                    key_chars.append(text[i : i + 2])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                key_chars.append(ch)
                i += 1
            key_raw = "".join(key_chars)
        else:
            j = i
            while i < n and (text[i].isalnum() or text[i] in "_+-"):
                i += 1
            key_raw = text[j:i]
        if i >= n or text[i] != ":":
            raise SystemExit(f"no colon at {i}: {text[i : i + 40]!r}")
        i += 1
        if i >= n or text[i] != '"':
            raise SystemExit(f"no value quote at {i}: {text[i : i + 40]!r}")
        i += 1
        val_chars: list[str] = []
        while i < n:
            ch = text[i]
            if ch == "\\" and i + 1 < n:
                val_chars.append(text[i : i + 2])
                i += 2
                continue
            if ch == '"':
                i += 1
                break
            val_chars.append(ch)
            i += 1
        key = codecs.decode(key_raw, "unicode_escape")
        val = codecs.decode("".join(val_chars), "unicode_escape")
        emoji_map[key] = val
    return emoji_map


def extract_emoji_regex_zone() -> str:
    zone = DATA[248690400:248750000].decode("ascii", "ignore")
    lines: list[str] = []
    for pat in (
        "WtS=",
        "LGa=",
        "jtS=",
        "PGa=",
        "function GtS",
        "function EWt",
        "function NtS",
        "function OtS",
        "LtS=",
    ):
        pos = zone.find(pat)
        lines.append(f"### {pat} @ {pos}")
        if pos >= 0:
            lines.append(zone[pos : pos + 260])
            lines.append("---")
    for m in re.finditer(r"/(?:\\.|[^/\\\n])+/[gimsuy]*", zone):
        s = m.group(0)
        if ":" in s or "emoji" in s.lower():
            lines.append(f"re {s[:200]}")
    return "\n".join(lines)


def main() -> None:
    emoji_map = extract_emoji_map()
    print("map size", len(emoji_map))
    SRC_EMOJI.parent.mkdir(parents=True, exist_ok=True)
    # ensure_ascii=True so \u escapes stay portable on Windows consoles/git
    SRC_EMOJI.write_text(
        json.dumps(emoji_map, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print("wrote", SRC_EMOJI, SRC_EMOJI.stat().st_size)
    samples = {
        k: emoji_map.get(k)
        for k in ("-1", "+1", "100", "smile", "zzz", "thumbsup", "heart", "rocket")
    }
    (OUT_DIR / "emoji-map-samples.json").write_text(
        json.dumps(samples, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    zone_txt = extract_emoji_regex_zone()
    (OUT_DIR / "emoji-regex-zone.txt").write_text(zone_txt, encoding="utf-8")
    print("zone lines", zone_txt.count("\n"))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Extract densable 2.1.219 baked EHl model catalog to JSON."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BINARY = Path(
    r"C:\Users\Administrator\AppData\Local\Temp\official-219\package\claude.exe"
)
OUT = Path(
    r"D:\work\py\claude\claude-code\docs\upstream-extraction\v2.1.219\snippets\ehl-2.1.219.json"
)


def extract_object(data: bytes, start: int) -> bytes:
    i = start
    depth = 0
    in_str = False
    escape = False
    while i < len(data):
        c = data[i]
        if in_str:
            if escape:
                escape = False
            elif c == 0x5C:  # \
                escape = True
            elif c == 0x22:  # "
                in_str = False
        else:
            if c == 0x22:
                in_str = True
            elif c == 0x7B:  # {
                depth += 1
            elif c == 0x7D:  # }
                depth -= 1
                if depth == 0:
                    return data[start : i + 1]
        i += 1
    raise RuntimeError("unbalanced braces")


def quote_keys(text: str) -> str:
    out: list[str] = []
    i = 0
    in_str = False
    escape = False
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch in "{,":
            out.append(ch)
            i += 1
            while i < n and text[i] in " \t\n\r":
                out.append(text[i])
                i += 1
            if i < n and text[i] == '"':
                continue
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            if j > i and j < n and text[j] == ":":
                out.append('"' + text[i:j] + '"')
                i = j
                continue
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def main() -> None:
    data = BINARY.read_bytes()
    idx = data.find(b"EHl={")
    if idx < 0:
        raise SystemExit("EHl={ not found")
    raw = extract_object(data, idx + 4)
    s = "".join(chr(b) if 32 <= b < 127 else "?" for b in raw)
    js = s.replace("!0", "true").replace("!1", "false")
    js2 = quote_keys(js)
    js2 = re.sub(r",\s*}", "}", js2)
    js2 = re.sub(r",\s*]", "]", js2)
    try:
        obj = json.loads(js2)
    except json.JSONDecodeError as e:
        Path("ehl-try.json").write_text(js2, encoding="utf-8")
        raise SystemExit(f"JSON fail: {e}") from e

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT)
    print("keys", list(obj.keys()))
    print("models", len(obj["models"]))
    print("pricing_tiers", list(obj["pricing_tiers"].keys()))
    print("aliases", len(obj.get("aliases", {})))
    print("defaults", obj.get("defaults"))
    print("best", obj.get("best"))
    print("latest_per_family", obj.get("latest_per_family"))
    print("alias_migration", obj.get("alias_migration"))
    keys: set[str] = set()
    for m in obj["models"]:
        keys |= set(m.keys())
    print("union model keys", sorted(keys))
    for m in obj["models"]:
        print(m["id"], sorted(m.keys()))


if __name__ == "__main__":
    main()

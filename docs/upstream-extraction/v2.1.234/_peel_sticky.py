from pathlib import Path

out = Path(r"D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.234")
out.mkdir(parents=True, exist_ok=True)
data = Path(
    r"C:/Users/Administrator/AppData/Local/Temp/official-234/plat/package/claude.exe"
).read_bytes()


def peel(name: str, needle: bytes, before: int = 2500, after: int = 6000) -> None:
    i = data.find(needle)
    if i < 0:
        print(f"MISS {name}")
        return
    a = max(0, i - before)
    b = min(len(data), i + after)
    chunk = data[a:b]
    text = "".join(
        chr(c) if 32 <= c < 127 else ("\n" if c in (10, 13) else ".") for c in chunk
    )
    p = out / f"hit-{name}.txt"
    p.write_text(text, encoding="utf-8")
    print(f"WROTE {p.name} @ {i} len={len(text)}")


peel("setStickyPrompt", b"setStickyPrompt", 4000, 12000)
peel("StickyPrompt-obj", b"StickyPrompt", 2000, 4000)
peel("JumpToBottom", b"Jump to bottom", 1500, 4000)
peel("selection_clear", b"selection:clear", 2000, 5000)
peel("continue_usage_limit", b"Continue automatically at usage limit", 1500, 4000)
peel("project_dir_name", b"CLAUDE_CODE_PROJECT_DIR_NAME", 1500, 4000)
peel("allowed_by_auto", b"Allowed by auto mode classifier", 1500, 4000)

for n in [
    b"padCollapsed",
    b"scrolledAwayFromBottom",
    b"clearStickyStreak",
    b"isSameStickyPrompt",
    b"shouldClearStickyOnMiss",
    b"STICKY_CLEAR_HYSTERESIS",
    b"React #185",
    b"Maximum update depth",
    b"clicked",
    b"scrollTo",
]:
    print("extra", n.decode("utf-8", "replace"), data.find(n))

#!/usr/bin/env python3
"""Build gold-ANTHROPIC_DEFAULT_MODEL.txt from SEA 2.1.236 latin1 windows."""

from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/gold-ANTHROPIC_DEFAULT_MODEL.txt"
)
data = SEA.read_bytes()


def clean(chunk: bytes) -> str:
    out = []
    for ch in chunk.decode("latin1"):
        o = ord(ch)
        if ch in "\n\r\t" or 32 <= o < 127:
            out.append(ch)
        else:
            out.append(".")
    return "".join(out)


def win(off: int, before: int, after: int) -> tuple[int, str]:
    start = max(0, off - before)
    end = min(len(data), off + after)
    return start, clean(data[start:end])


sections: list[str] = []
sections.append(
    """SEA: /tmp/official-236/plat/package/claude
version: 2.1.236
sha256: 6bc4ba992d2786cbf0237c4453ca53c1fdf0c3b3d83ffa0025c0d8190ed27848
key: ANTHROPIC_DEFAULT_MODEL
gold: full function windows for GAP #1
"""
)

# Continuous block: dhd/phd/UW/aRn/idt/Vzo/zxt/qxt
off = data.find(b"function dhd()")
start, text = win(off, 0, 2200)
sections.append(
    f"""================================================================================
BLOCK A | dhd / phd / UW / aRn / idt / Vzo / zxt / qxt
offset 0x{off:x} (window_start 0x{start:x})
================================================================================
{text}
"""
)

# Guard helpers
for label, needle, after in [
    ("Z0e + zYs", b"function Z0e(", 700),
    ("Hu", b"function Hu(", 700),
    ("A7e", b"function A7e(", 700),
]:
    off = data.find(needle)
    start, text = win(off, 0, after)
    sections.append(
        f"""================================================================================
BLOCK B | {label}
offset 0x{off:x}
================================================================================
{text}
"""
    )

# modelSelection accessors
off = data.find(b"function ibn()")
start, text = win(off, 0, 450)
sections.append(
    f"""================================================================================
BLOCK C | ibn / VVt / vxs / Txs (org + env session latches)
offset 0x{off:x}
================================================================================
{text}
"""
)

# FF / ANTHROPIC_MODEL session override path
off = data.find(b"function FF()")
start, text = win(off, 80, 450)
sections.append(
    f"""================================================================================
BLOCK D | FF() — ANTHROPIC_MODEL (persist / session override) path
offset 0x{off:x}
================================================================================
{text}
"""
)

# Startup telemetry
off = data.find(b"Txs(V.ANTHROPIC_DEFAULT_MODEL")
start, text = win(off, 120, 450)
sections.append(
    f"""================================================================================
BLOCK E | startup model_env_default telemetry
offset 0x{off:x}
================================================================================
{text}
"""
)

# Fallback chain
off = data.find(b"t.model||process.env.ANTHROPIC_MODEL||V.ANTHROPIC_DEFAULT_MODEL")
start, text = win(off, 80, 250)
sections.append(
    f"""================================================================================
BLOCK F | startup fallback chain
offset 0x{off:x}
================================================================================
{text}
"""
)

# tengu_startup_manual_model_config
off = data.find(b'tengu_startup_manual_model_config"')
start, text = win(off, 40, 280)
sections.append(
    f"""================================================================================
BLOCK G | tengu_startup_manual_model_config
offset 0x{off:x}
================================================================================
{text}
"""
)

# QEn + vv_ SAFE allowlist
off = data.find(b'QEn=["ANTHROPIC_MODEL"')
start, text = win(off, 80, 1800)
sections.append(
    f"""================================================================================
BLOCK H | QEn model env list + vv_ SAFE allowlist (spreads ...QEn)
offset 0x{off:x}
================================================================================
{text}
"""
)

# kv_ secondary set
off = data.find(b'kv_=new Set(["ANTHROPIC_BEDROCK_REGION_PREFIX"')
start, text = win(off, 0, 1400)
sections.append(
    f"""================================================================================
BLOCK I | kv_ allowlist (also includes ANTHROPIC_DEFAULT_MODEL + ANTHROPIC_MODEL)
offset 0x{off:x}
================================================================================
{text}
"""
)

# Semantic contrast: Kif writes userSettings.model unless ANTHROPIC_MODEL set
off = data.find(b"function Kif(")
start, text = win(off, 0, 450)
sections.append(
    f"""================================================================================
BLOCK J | Kif — ANTHROPIC_MODEL blocks writing userSettings.model
offset 0x{off:x}
================================================================================
{text}
"""
)

# Attribution UI source label contrast
off = data.find(b"function fRn()")
start, text = win(off, 0, 350)
sections.append(
    f"""================================================================================
BLOCK K | fRn — ANTHROPIC_MODEL suppresses settings-source suffix
offset 0x{off:x}
================================================================================
{text}
"""
)

# BYOC clears both
off = data.find(b"ANTHROPIC_MODEL:void 0,ANTHROPIC_DEFAULT_MODEL:void 0")
start, text = win(off, 80, 220)
sections.append(
    f"""================================================================================
BLOCK L | BYOC env scrub clears both MODEL and DEFAULT_MODEL
offset 0x{off:x}
================================================================================
{text}
"""
)

sections.append(
    """================================================================================
SEMANTICS NOTES (derived)
================================================================================
1. ANTHROPIC_DEFAULT_MODEL:
   - Latched at startup via Txs(V.ANTHROPIC_DEFAULT_MODEL??null) into
     Sr.modelSelection.initialEnvDefaultModel (vxs/Txs).
   - Consumed by zxt() as session-start default attribution "env".
   - Does NOT appear in FF() override chain; UI labels it specifically
     via aRn("env") => " · Set by ANTHROPIC_DEFAULT_MODEL".
   - Telemetry model_env_default: inert | outranked_by_org_default | fire(be).

2. ANTHROPIC_MODEL:
   - Live process.env / V.ANTHROPIC_MODEL used as stronger override in FF()
     (after SE()/die settings), startup fallback before DEFAULT_MODEL,
     and tengu env_var field.
   - Blocks Kif from persisting model into userSettings; suppresses fRn
     settings-source suffix; treated as persistent/session override, not
     the softer "env default" attribution path.

3. idt() attribution order:
   org (ibn/odt/phd) -> env (zxt) -> enforced (Kzo) -> entitlement (Vzo) -> tier (fhd baseline)

4. zxt() null guards (in order):
   missing value; trim lower in {default,inherit}; Z0e(al(r)) opusplan|haiku;
   zYs(r) (stub false in this build); dhd() (stub false); allowlist active or
   enforceAvailableModels; !Hu(t); A7e(t,{ignoreModelOverrides:true})!==null.
"""
)

OUT.write_text("\n".join(sections), encoding="utf-8")
print(f"wrote {OUT} bytes={OUT.stat().st_size}")

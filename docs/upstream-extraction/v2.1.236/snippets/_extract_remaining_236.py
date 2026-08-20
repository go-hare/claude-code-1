#!/usr/bin/env python3
"""Latin1 dig densable SEA 2.1.236 remaining changelog keys. Invent-ban: quote SEA only."""

from __future__ import annotations

from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT_DIR = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets"
)

data = SEA.read_bytes()


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def count(needle: bytes | str) -> int:
    if isinstance(needle, str):
        needle = needle.encode("latin1")
    return data.count(needle)


def find_all(needle: bytes | str, limit: int = 200) -> list[int]:
    if isinstance(needle, str):
        needle = needle.encode("latin1")
    out: list[int] = []
    start = 0
    while len(out) < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        out.append(i)
        start = i + 1
    return out


def ctx(offset: int, radius: int = 280) -> str:
    lo = max(0, offset - radius)
    hi = min(len(data), offset + radius)
    return printable(data[lo:hi])


def contexts(
    needle: bytes | str, radius: int = 280, limit: int = 20
) -> list[tuple[int, str]]:
    return [(i, ctx(i, radius)) for i in find_all(needle, limit)]


def write_hit(key: str, lines: list[str]) -> Path:
    path = OUT_DIR / f"hit-{key}.txt"
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return path


def header(key: str, checklist: str, patterns: list[str]) -> list[str]:
    return [
        f"SEA: {SEA}",
        "version: 2.1.236 (Claude Code)",
        f"key: {key}",
        f"checklist: {checklist}",
        f"search_patterns: {patterns!r}",
        "",
    ]


def section_counts(patterns: list[str]) -> list[str]:
    lines = ["=== pattern counts ==="]
    for p in patterns:
        lines.append(f"{p!r}: {count(p)}")
    lines.append("")
    return lines


def section_hits(
    label: str, needle: str, radius: int = 300, limit: int = 12
) -> list[str]:
    hits = contexts(needle, radius=radius, limit=limit)
    total = count(needle)
    lines = [f"=== '{label}' hits total={total} shown={len(hits)} ==="]
    if not hits:
        lines.append("(none)")
        lines.append("")
        return lines
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
    return lines


def near_any(
    primary: str,
    required_any: list[str],
    radius: int = 420,
    limit: int = 30,
) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    req = [x.lower() for x in required_any]
    for i in find_all(primary, limit=400):
        text = ctx(i, radius)
        low = text.lower()
        if any(r in low for r in req):
            out.append((i, text))
            if len(out) >= limit:
                break
    return out


results: list[dict] = []


def note_result(
    id_: int,
    key: str,
    found: bool,
    top_symbols: list[str],
    one_line: str,
):
    results.append(
        {
            "id": id_,
            "key": key,
            "found": found,
            "topSymbols": top_symbols,
            "oneLineNote": one_line,
        }
    )


# ---------------------------------------------------------------------------
# #9 fullscreen-resize-message (refresh/confirm existing)
# ---------------------------------------------------------------------------
key = "fullscreen-resize-message"
patterns = [
    "resize",
    "fullscreen",
    "newly sent",
    "message missing",
    "VirtualMessageList",
    "handleResize",
    "replayPending",
    "tickPump",
    "nativeHistory",
]
lines = header(
    key,
    "Fullscreen: newly sent message missing until next update after resize",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "VirtualMessageList",
    "replayPending",
    "handleResize",
    "tickPump",
    "nativeHistory",
    "newly sent",
    "message missing",
]:
    lines += section_hits(p, p, radius=320, limit=8)
# best known window
for label, needle in [
    ("handleResize_replay", "handleResize(e,t){if(e===this.cols&&t===this.rows)return\"noop\""),
    ("VirtualMessageList", "VirtualMessageList"),
]:
    hits = contexts(needle, 360, 5)
    lines.append(f"=== BEST '{label}' ===")
    if not hits:
        lines.append("(none)")
    for i, text in hits:
        lines.append(f"--- offset {i} ---")
        lines.append(text)
        lines.append("")
write_hit(key, lines)
note_result(
    9,
    key,
    True,
    ["handleResize", "replayPending", "tickPump", "nativeHistory", "VirtualMessageList"],
    "No literal 'newly sent message'; fullscreen handleResize->replayPending/tickPump/nativeHistory + VirtualMessageList present",
)

# ---------------------------------------------------------------------------
# #13 cloud-env-empty refresh compact best
# ---------------------------------------------------------------------------
key = "cloud-env-empty"
patterns = [
    "cloud environment",
    "environments empty",
    "malformed",
    "No environments",
    "cloud environments",
    "usable environments list",
    "fetchEnvironments",
]
lines = header(
    key,
    "Unclear error when cloud environments list empty/malformed",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "usable environments list",
    "fetchEnvironments: HTTP 200",
    "No cloud environment available",
    "cloud environments service returned",
]:
    lines += section_hits(p, p, radius=360, limit=8)
write_hit(key, lines)
note_result(
    13,
    key,
    True,
    ["MIS", "iSe", "fetchEnvironments", "teleport_environments_list"],
    "Found fetchEnvironments empty/non-JSON/no usable environments list error strings (exact 'cloud environments list' absent)",
)

# ---------------------------------------------------------------------------
# #14 fable5-credits-rc — dig for 60s auto-select under RC
# ---------------------------------------------------------------------------
key = "fable5-credits-rc"
patterns = [
    "usage-credits",
    "fable",
    "60s",
    "Remote Control",
    "credits prompt",
    "auto-select",
    "fable_overage_consent_prompt",
    "fableConsentSessionFallback",
    "60000",
]
lines = header(
    key,
    "Fable 5 first-time usage-credits prompt auto-selecting fallback after 60s under Remote Control",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "fable_overage_consent_prompt",
    "fableConsentSessionFallback",
    "replaceFableConsentSessionFallback",
    "continue Fable 5 on usage credits",
    "choose: continue Fable 5 on usage credits or switch models",
    "auto-select",
    "autoSelect",
    "60000",
    "60_000",
    "60s",
    "60 seconds",
]:
    lines += section_hits(p, p, radius=320, limit=10)

# filter 60000 near fable/consent/credits/remote
near = near_any(
    "60000",
    ["fable", "consent", "usage-credit", "overage", "remote", "fallback"],
    radius=500,
    limit=40,
)
lines.append(f"=== '60000' near fable/consent/credits/remote shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")

near2 = near_any(
    "fable_overage_consent_prompt",
    ["remote", "timeout", "60", "fallback", "auto"],
    radius=500,
    limit=20,
)
lines.append(
    f"=== fable_overage_consent_prompt near remote/timeout/auto shown={len(near2)} ==="
)
for i, text in near2:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")

# also search consent timeout symbols
for p in [
    "consentTimeout",
    "ConsentTimeout",
    "overageConsent",
    "OverageConsent",
    "sessionFallback",
    "FableConsent",
    "creditsRequired",
    "fableCreditsRequired",
]:
    lines += section_hits(p, p, radius=300, limit=8)

write_hit(key, lines)
found14 = count("fable_overage_consent_prompt") > 0 or count(
    "fableConsentSessionFallback"
) > 0
note_result(
    14,
    key,
    bool(found14),
    [
        "fable_overage_consent_prompt",
        "fableConsentSessionFallback",
        "replaceFableConsentSessionFallback",
        "fableCreditsRequired",
    ],
    "Found Fable overage/credits consent prompt + sessionFallback symbols; literal 60s auto-select under RC not confirmed as exact string",
)

# ---------------------------------------------------------------------------
# #15 guest-pass-malformed
# ---------------------------------------------------------------------------
key = "guest-pass-malformed"
patterns = [
    "guest-pass",
    "guestPass",
    "spinner tip",
    "reward",
    "malformed",
    "guest_pass",
    "GuestPass",
]
lines = header(
    key,
    "Spinner tips never appear when guest-pass reward in ~/.claude.json malformed",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "guest-pass",
    "guest_pass",
    "GuestPass",
    "guestPass",
    "spinner tip",
    "spinnerTip",
    "SpinnerTip",
    "tips",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "guest-pass",
    ["malform", "reward", "tip", "spinner", "claude.json", "parse"],
    radius=500,
    limit=30,
)
lines.append(f"=== guest-pass near malform/reward/tip shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "reward",
    ["guest", "tip", "spinner", "malform"],
    radius=420,
    limit=25,
)
lines.append(f"=== reward near guest/tip/spinner/malform shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    15,
    key,
    count("guest-pass") > 0,
    ["guest-pass"],
    "guest-pass present; inspect contexts for reward/malformed/spinner tip linkage",
)

# ---------------------------------------------------------------------------
# #16 skills-hot-reload-cwd
# ---------------------------------------------------------------------------
key = "skills-hot-reload-cwd"
patterns = [
    "hot-reload",
    "hotReload",
    "skills",
    "cwd",
    "ENOENT",
    "deleted",
    "hot_reload",
]
lines = header(
    key,
    "Skills hot-reload error after session cwd deleted (SDK/VS Code; 2.1.229+)",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "hot-reload",
    "hotReload",
    "hot_reload",
    "skills hot",
    "skill hot",
    "reloadSkills",
    "skillsReload",
    "watchSkills",
]:
    lines += section_hits(p, p, radius=360, limit=12)
near = near_any(
    "hotReload",
    ["skill", "cwd", "enoent", "deleted", "reload"],
    radius=500,
    limit=20,
)
lines.append(f"=== hotReload near skill/cwd/enoent shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "hot-reload",
    ["skill", "cwd", "enoent", "deleted", "reload"],
    radius=500,
    limit=20,
)
lines.append(f"=== hot-reload near skill/cwd/enoent shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    16,
    key,
    count("hot-reload") > 0 or count("hotReload") > 0,
    ["hot-reload", "hotReload"],
    "hot-reload/hotReload present; inspect for skills+cwd deleted/ENOENT",
)

# ---------------------------------------------------------------------------
# #17 self-hosted-runner
# ---------------------------------------------------------------------------
key = "self-hosted-runner"
patterns = [
    "retire",
    "startup-timeout",
    "post-session",
    "self-hosted",
    "release",
    "startupTimeout",
    "postSession",
]
lines = header(
    key,
    "Self-hosted runner: idle/retire/startup-timeout release occasionally resumes elsewhere before post-session hook done",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "startup-timeout",
    "startupTimeout",
    "post-session",
    "postSession",
    "self-hosted runner",
    "self_hosted_runner",
    "retire",
    "runner retire",
]:
    lines += section_hits(p, p, radius=360, limit=12)
near = near_any(
    "startup-timeout",
    ["runner", "retire", "release", "post", "session", "idle"],
    radius=520,
    limit=25,
)
lines.append(f"=== startup-timeout near runner/retire/release shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "post-session",
    ["runner", "retire", "release", "hook", "self-hosted"],
    radius=520,
    limit=25,
)
lines.append(f"=== post-session near runner/hook shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    17,
    key,
    count("startup-timeout") > 0 and count("self-hosted") > 0,
    ["startup-timeout", "self-hosted", "post-session"],
    "startup-timeout + self-hosted present; inspect retire/release/post-session hook ordering",
)

# ---------------------------------------------------------------------------
# #18 clawd-eyes
# ---------------------------------------------------------------------------
key = "clawd-eyes"
patterns = ["clawd", "mascot", "eyes", "feet", "iTerm", "iTerm2"]
lines = header(
    key,
    "Clawd mascot eyes/feet uneven in iTerm2 at some font sizes",
    patterns,
)
lines += section_counts(patterns)
for p in ["clawd", "mascot", "Clawd", "eyes", "feet", "iTerm2", "iterm"]:
    lines += section_hits(p, p, radius=300, limit=10)
near = near_any(
    "clawd",
    ["eye", "feet", "foot", "mascot", "iterm", "font"],
    radius=480,
    limit=30,
)
lines.append(f"=== clawd near eye/feet/mascot/iterm shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    18,
    key,
    count("clawd") > 0,
    ["clawd"],
    "clawd present; look for eyes/feet/iTerm font-size rendering strings",
)

# ---------------------------------------------------------------------------
# #19 recap-cap
# ---------------------------------------------------------------------------
key = "recap-cap"
patterns = ["recap", "400", "word boundary", "/recap", "Recap"]
lines = header(
    key,
    "Recap runaway: cap at 400 chars, word boundary (auto + /recap)",
    patterns,
)
lines += section_counts(
    ["recap", "/recap", "word boundary", "wordBoundary", "Recap in under", "400"]
)
for p in [
    "/recap",
    "Recap in under",
    "word boundary",
    "wordBoundary",
    "recapCap",
    "RECAP",
    "away_summary",
    "away-summary",
    "awaySummary",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "recap",
    ["400", "word", "boundary", "cap", "chars", "character"],
    radius=420,
    limit=40,
)
lines.append(f"=== recap near 400/word/cap shown={len(near)} ===")
for i, text in near[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
# also "under 40 words" from earlier fable dump — and 400 char
for p in ["under 40 words", "400 chars", "400 characters", "maxRecap", "recapMax"]:
    lines += section_hits(p, p, radius=300, limit=8)
write_hit(key, lines)
note_result(
    19,
    key,
    count("recap") > 0,
    ["recap"],
    "recap present; /recap literal may be absent; dig 400-char/word-boundary cap strings",
)

# ---------------------------------------------------------------------------
# #20 startup-session-counter
# ---------------------------------------------------------------------------
key = "startup-session-counter"
patterns = [
    "session counter",
    "sessionCounter",
    "startup",
    "background",
    "SessionCounter",
]
lines = header(
    key,
    "Startup: session counter written in background",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "sessionCounter",
    "SessionCounter",
    "session_counter",
    "session counter",
    "incrementSession",
    "writeSessionCounter",
]:
    lines += section_hits(p, p, radius=360, limit=12)
near = near_any(
    "sessionCounter",
    ["startup", "background", "write", "increment", "async"],
    radius=500,
    limit=20,
)
lines.append(f"=== sessionCounter near startup/background shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    20,
    key,
    count("sessionCounter") > 0,
    ["sessionCounter"],
    "sessionCounter present; inspect background write at startup",
)

# ---------------------------------------------------------------------------
# #21 auto-mode-monitor
# ---------------------------------------------------------------------------
key = "auto-mode-monitor"
patterns = [
    "Monitor",
    "allow rules",
    "auto mode",
    "set aside",
    "classifier",
]
lines = header(
    key,
    "Auto mode: Monitor allow rules set aside so Monitor reviewed like Bash",
    patterns,
)
lines += section_counts(
    [
        "Monitor",
        "allow rules",
        "auto mode",
        "set aside",
        "classifier",
        "alwaysAllowRules",
        "MonitorTool",
    ]
)
for p in [
    "set aside",
    "alwaysAllowRules",
    "MonitorTool",
    "monitor allow",
    "auto mode",
    "Auto mode",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "Monitor",
    ["allow", "auto", "classifier", "bash", "set aside", "alwaysAllow"],
    radius=420,
    limit=40,
)
# filter denser: require allow+auto-ish
filtered = []
for i, text in near:
    low = text.lower()
    if ("allow" in low or "alwaysallow" in low) and (
        "auto" in low or "classifier" in low or "bash" in low
    ):
        filtered.append((i, text))
lines.append(
    f"=== Monitor near allow+auto/classifier/bash filtered={len(filtered)} ==="
)
for i, text in filtered[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    21,
    key,
    True,
    ["Monitor", "alwaysAllowRules", "classifier"],
    "Monitor + alwaysAllowRules present; look for auto-mode set-aside of Monitor allow rules",
)

# ---------------------------------------------------------------------------
# #22 auto-mode-bedrock-defaults
# ---------------------------------------------------------------------------
key = "auto-mode-bedrock-defaults"
patterns = [
    "Bedrock",
    "Vertex",
    "Foundry",
    "severity",
    "classifier defaults",
    "telemetry-off",
]
lines = header(
    key,
    "Auto mode on Bedrock/Vertex/Foundry + telemetry-off: classifier same defaults as Claude API incl severity-scored",
    patterns,
)
lines += section_counts(patterns + ["telemetryOff", "severity-scored", "classifierDefaults"])
for p in [
    "classifier defaults",
    "classifierDefaults",
    "telemetry-off",
    "telemetryOff",
    "severity-scored",
    "severityScored",
    "Bedrock",
    "Foundry",
]:
    lines += section_hits(p, p, radius=320, limit=10)
near = near_any(
    "classifier",
    ["bedrock", "vertex", "foundry", "severity", "telemetry"],
    radius=480,
    limit=40,
)
lines.append(
    f"=== classifier near bedrock/vertex/foundry/severity/telemetry shown={len(near)} ==="
)
for i, text in near[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    22,
    key,
    True,
    ["Bedrock", "Vertex", "Foundry", "classifier", "severity"],
    "Provider + classifier/severity strings present; dig telemetry-off default parity path",
)

# ---------------------------------------------------------------------------
# #23 status-showUntrackedFiles
# ---------------------------------------------------------------------------
key = "status-showUntrackedFiles"
patterns = [
    "showUntrackedFiles",
    "untracked",
    "git status -u",
    "-uall",
    "-unormal",
]
lines = header(
    key,
    "Auto mode git status not fooled by status.showUntrackedFiles=no",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "showUntrackedFiles",
    "status.showUntrackedFiles",
    "git status -u",
    "-uall",
    "-unormal",
    "untracked files",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "untracked",
    ["status", "show", "git", "-u", "auto"],
    radius=420,
    limit=30,
)
lines.append(f"=== untracked near status/git/-u shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    23,
    key,
    count("showUntrackedFiles") > 0 or count("-uall") > 0 or count("untracked") > 0,
    ["untracked", "-uall"],
    "literal showUntrackedFiles may be absent; dig -uall/untracked git status force",
)

# ---------------------------------------------------------------------------
# #24 model-picker-highlight
# ---------------------------------------------------------------------------
key = "model-picker-highlight"
patterns = ["newest model", "highlight", "ModelPicker"]
lines = header(
    key,
    "/model highlight only newest model name",
    patterns,
)
lines += section_counts(patterns + ["newestModel", "isNewest", "highlightNewest"])
for p in [
    "newest model",
    "ModelPicker",
    "newestModel",
    "isNewest",
    "highlightNewest",
    "newest",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "ModelPicker",
    ["newest", "highlight", "model"],
    radius=480,
    limit=20,
)
lines.append(f"=== ModelPicker near newest/highlight shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "newest model",
    ["highlight", "picker", "model"],
    radius=480,
    limit=20,
)
lines.append(f"=== 'newest model' contexts shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    24,
    key,
    count("newest model") > 0 and count("ModelPicker") > 0,
    ["ModelPicker", "newest model"],
    "Found 'newest model' + ModelPicker; inspect highlight-only-newest behavior strings",
)

# ---------------------------------------------------------------------------
# #25 goal-idle-checkin
# ---------------------------------------------------------------------------
key = "goal-idle-checkin"
patterns = ["/goal", "check-in", "checkin", "30m", "parked", "idle"]
lines = header(
    key,
    "/goal: idle+parked behind bg work auto check-in 30m then 1h/2h",
    patterns,
)
lines += section_counts(patterns + ["checkIn", "goalCheck", "30 * 60", "1800000"])
for p in [
    "/goal",
    "check-in",
    "checkIn",
    "goal check",
    "parked",
    "idle check",
    "1800000",
    "3600000",
    "7200000",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "/goal",
    ["check", "idle", "park", "30", "bg", "background"],
    radius=500,
    limit=30,
)
lines.append(f"=== /goal near check/idle/park shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "check-in",
    ["goal", "idle", "park", "30"],
    radius=480,
    limit=25,
)
lines.append(f"=== check-in near goal/idle/park shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    25,
    key,
    count("/goal") > 0,
    ["/goal", "check-in", "checkin", "parked"],
    "/goal + check-in/checkin present; dig 30m/1h/2h idle parked schedule",
)

# ---------------------------------------------------------------------------
# #26 usage-credits-row
# ---------------------------------------------------------------------------
key = "usage-credits-row"
patterns = [
    "usage-credits",
    "/usage",
    "credits spend",
    "Team",
    "Enterprise",
    "0%",
]
lines = header(
    key,
    "/usage usage-credits spend row for Team/Enterprise; capped 0% before spend",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "credits spend",
        "spend row",
        "usage credits",
        "extra usage",
        "0%",
    ]
)
for p in [
    "/usage-credits",
    "usage-credits",
    "credits spend",
    "spend row",
    "extra usage",
    "0%",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "/usage",
    ["credit", "spend", "team", "enterprise", "0%"],
    radius=480,
    limit=30,
)
lines.append(f"=== /usage near credit/spend/team shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    26,
    key,
    count("usage-credits") > 0,
    ["usage-credits", "/usage"],
    "usage-credits present; dig /usage Team/Enterprise spend row + 0% cap strings",
)

# ---------------------------------------------------------------------------
# #27 sigterm-print
# ---------------------------------------------------------------------------
key = "sigterm-print"
patterns = [
    "SIGTERM",
    "143",
    "interrupted-turn",
    "synthetic denial",
    "print mode",
]
lines = header(
    key,
    "SIGTERM print/SDK: no interrupted-turn / synthetic denials; still kill cmds + exit 143",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "interrupted_turn",
        "syntheticDenial",
        "exitCode 143",
        "exit 143",
    ]
)
for p in [
    "interrupted-turn",
    "interrupted_turn",
    "synthetic denial",
    "syntheticDenial",
    "exit 143",
    "code:143",
    "status:143",
    "SIGTERM",
]:
    lines += section_hits(p, p, radius=340, limit=10)
near = near_any(
    "interrupted-turn",
    ["sigterm", "143", "print", "sdk", "denial"],
    radius=500,
    limit=20,
)
lines.append(f"=== interrupted-turn near sigterm/143/print shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "143",
    ["sigterm", "interrupted", "print", "exit"],
    radius=300,
    limit=30,
)
# keep only denser
filtered = []
for i, text in near:
    low = text.lower()
    if "sigterm" in low or "interrupted" in low:
        filtered.append((i, text))
lines.append(f"=== 143 near sigterm/interrupted filtered={len(filtered)} ===")
for i, text in filtered[:20]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    27,
    key,
    count("interrupted-turn") > 0,
    ["SIGTERM", "interrupted-turn", "143"],
    "interrupted-turn + SIGTERM present; dig print/SDK skip synthetic denial + exit 143",
)

# ---------------------------------------------------------------------------
# #28 slash-typo-enter
# ---------------------------------------------------------------------------
key = "slash-typo-enter"
patterns = ["slash", "typo", "fuzzy", "unavailable", "closest"]
lines = header(
    key,
    "Enter on slash typo/unavailable reports instead of closest fuzzy; prefixes/aliases still run",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "Did you mean",
        "closest match",
        "fuzzy match",
        "unknown command",
        "slash command",
    ]
)
for p in [
    "Did you mean",
    "closest match",
    "fuzzy match",
    "unknown slash",
    "Unknown slash",
    "typo",
    "unavailable command",
    "slash command",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "fuzzy",
    ["slash", "command", "typo", "closest", "unavailable", "enter"],
    radius=480,
    limit=30,
)
lines.append(f"=== fuzzy near slash/typo/closest shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    28,
    key,
    True,
    ["fuzzy", "slash", "Did you mean"],
    "Dig slash typo enter: report unavailable vs closest fuzzy; prefixes/aliases still run",
)

# ---------------------------------------------------------------------------
# #29 rc-offline-seconds
# ---------------------------------------------------------------------------
key = "rc-offline-seconds"
patterns = [
    "offline",
    "Remote Control",
    "within seconds",
    "session offline",
]
lines = header(
    key,
    "Remote Control marks session offline within seconds on CLI/terminal exit",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "session offline",
        "markOffline",
        "setOffline",
        "went offline",
        "is offline",
    ]
)
for p in [
    "session offline",
    "within seconds",
    "went offline",
    "markOffline",
    "setOffline",
    "offline within",
]:
    lines += section_hits(p, p, radius=360, limit=12)
near = near_any(
    "offline",
    ["remote control", "remote-control", "bridge", "session", "seconds", "exit"],
    radius=420,
    limit=40,
)
filtered = []
for i, text in near:
    low = text.lower()
    if "remote" in low or "bridge" in low or "seconds" in low:
        filtered.append((i, text))
lines.append(f"=== offline near remote/bridge/seconds filtered={len(filtered)} ===")
for i, text in filtered[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    29,
    key,
    True,
    ["offline", "Remote Control"],
    "offline + Remote Control present; dig fast offline-on-exit / within seconds path",
)

# ---------------------------------------------------------------------------
# #30 sendmessage-burst
# ---------------------------------------------------------------------------
key = "sendmessage-burst"
patterns = ["burst", "inbox", "SendMessage", "refuse", "exceed"]
lines = header(
    key,
    "SendMessage refuses further msgs once burst would exceed inbox (no false sent)",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "inbox full",
        "exceed inbox",
        "burst limit",
        "message burst",
        "udsBlankMessageGate",
    ]
)
for p in [
    "burst",
    "inbox full",
    "exceed inbox",
    "inbox",
    "refuse",
    "udsBlankMessageGate",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "SendMessage",
    ["burst", "inbox", "exceed", "refuse", "cap", "full"],
    radius=500,
    limit=40,
)
lines.append(f"=== SendMessage near burst/inbox/exceed shown={len(near)} ===")
for i, text in near[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "burst",
    ["inbox", "sendmessage", "message", "exceed", "refuse"],
    radius=480,
    limit=30,
)
lines.append(f"=== burst near inbox/message shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    30,
    key,
    count("SendMessage") > 0 and count("burst") > 0,
    ["SendMessage", "burst", "inbox"],
    "SendMessage + burst/inbox present; dig refuse-when-burst-exceeds-inbox",
)

# ---------------------------------------------------------------------------
# #31 title-chip-align
# ---------------------------------------------------------------------------
key = "title-chip-align"
patterns = ["title chip", "footer", "right edge", "SessionTitle"]
lines = header(
    key,
    "Session title chip aligned with footer right edge",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "SessionTitle",
        "titleChip",
        "TitleChip",
        "session title",
        "rightEdge",
    ]
)
for p in [
    "title chip",
    "SessionTitle",
    "titleChip",
    "TitleChip",
    "session title",
    "right edge",
    "rightEdge",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "SessionTitle",
    ["footer", "right", "chip", "align", "edge"],
    radius=480,
    limit=25,
)
lines.append(f"=== SessionTitle near footer/right/chip shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    31,
    key,
    count("SessionTitle") > 0 or count("title chip") > 0,
    ["SessionTitle"],
    "literal 'title chip' may be absent; dig SessionTitle/footer right-edge alignment symbols",
)

# ---------------------------------------------------------------------------
# #32 footer-right-margin
# ---------------------------------------------------------------------------
key = "footer-right-margin"
patterns = ["right margin", "footer", "truncated notices"]
lines = header(
    key,
    "Right-aligned footer items + truncated notices share consistent right margin",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "rightMargin",
        "footerRight",
        "truncated notice",
        "truncatedNotice",
    ]
)
for p in [
    "right margin",
    "rightMargin",
    "footerRight",
    "truncated notice",
    "truncatedNotice",
    "truncated notices",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "footer",
    ["margin", "right", "truncat", "notice", "align"],
    radius=420,
    limit=40,
)
filtered = []
for i, text in near:
    low = text.lower()
    if "margin" in low or "truncat" in low or "right" in low:
        filtered.append((i, text))
lines.append(f"=== footer near margin/right/truncat filtered={len(filtered)} ===")
for i, text in filtered[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    32,
    key,
    count("footer") > 0,
    ["footer"],
    "literal 'right margin' may be absent; dig footer truncation/right-align margin symbols",
)

# ---------------------------------------------------------------------------
# #33 vscode-a11y
# ---------------------------------------------------------------------------
key = "vscode-a11y"
patterns = ["screen reader", "live region", "aria", "heading"]
lines = header(
    key,
    "[VSCode] transcript screen reader: live announcements + per-turn heading nav",
    patterns,
)
lines += section_counts(
    patterns
    + [
        "aria-live",
        "liveRegion",
        "screenReader",
        "ScreenReader",
        "vscode",
    ]
)
for p in [
    "screen reader",
    "live region",
    "aria-live",
    "liveRegion",
    "screenReader",
    "ScreenReader",
]:
    lines += section_hits(p, p, radius=340, limit=12)
near = near_any(
    "screen reader",
    ["vscode", "heading", "live", "transcript", "announce"],
    radius=480,
    limit=20,
)
lines.append(f"=== screen reader near vscode/heading/live shown={len(near)} ===")
for i, text in near:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    33,
    key,
    count("screen reader") > 0 or count("live region") > 0,
    ["screen reader", "live region"],
    "SEA may have CLI screen-reader strings; VSCode host a11y likely N/A invent-ban",
)

# ---------------------------------------------------------------------------
# Recheck #7 sendmessage-malformed
# ---------------------------------------------------------------------------
key = "sendmessage-malformed-tag"
patterns = [
    "slipped summary",
    "coerceInput",
    "closing tag",
    "SendMessage",
    "split_slipped_summary_",
    "isSlippedSummarySplitEnabled",
    "applySplit",
]
lines = header(
    key,
    "SendMessage rejected when malformed closing tag left text in summary (RECHECK)",
    patterns,
)
lines += section_counts(patterns)
for p in [
    "split_slipped_summary_",
    "isSlippedSummarySplitEnabled",
    "coerceInput",
    "yEi(",
    "unrepaired",
    "malformed closing",
    "closing tag",
]:
    lines += section_hits(p, p, radius=380, limit=12)
near = near_any(
    "SendMessage",
    ["slipped", "coerce", "summary", "closing", "unrepaired", "applySplit"],
    radius=520,
    limit=40,
)
lines.append(f"=== SendMessage near slipped/coerce/summary shown={len(near)} ===")
for i, text in near[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    7,
    key,
    True,
    [
        "SendMessageTool",
        "coerceInput",
        "yEi",
        "isSlippedSummarySplitEnabled",
        "split_slipped_summary_",
    ],
    "RECHECK: slipped-summary split/coerceInput path found; exact 'malformed closing tag' phrase absent",
)

# ---------------------------------------------------------------------------
# Recheck #8 subprocess spawn fail near powershell
# ---------------------------------------------------------------------------
key = "subprocess-unhandled"
patterns = [
    "powershell",
    "spawn",
    "unhandledRejection",
    "failed to spawn",
    "ENOENT",
    "WSL",
]
lines = header(
    key,
    "Unhandled rejection when subprocess fails to start (e.g. powershell on WSL) — RECHECK",
    patterns,
)
lines += section_counts(patterns + ["spawnSync", "child_process", "spawn("])
for p in [
    "failed to spawn",
    "Failed to spawn",
    "spawn ENOENT",
    "powershell.exe",
    "unhandledRejection",
]:
    lines += section_hits(p, p, radius=360, limit=12)
near = near_any(
    "powershell",
    ["spawn", "enoent", "unhandled", "reject", "fail", "wsl", "catch"],
    radius=500,
    limit=40,
)
lines.append(f"=== powershell near spawn/enoent/unhandled shown={len(near)} ===")
for i, text in near[:30]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
near = near_any(
    "failed to spawn",
    ["powershell", "shell", "bash", "cmd", "wsl", "catch"],
    radius=480,
    limit=30,
)
lines.append(f"=== failed to spawn near shell/powershell shown={len(near)} ===")
for i, text in near[:25]:
    lines.append(f"--- offset {i} ---")
    lines.append(text)
    lines.append("")
write_hit(key, lines)
note_result(
    8,
    key,
    True,
    ["powershell.exe", "unhandledRejection", "failed to spawn"],
    "RECHECK: powershell/WSL + failed-to-spawn/unhandledRejection present; exact changelog phrase absent",
)

# ---------------------------------------------------------------------------
# Skip notes for 10/11/12 unless better — quick confirm only
# ---------------------------------------------------------------------------
for id_, key, note in [
    (
        10,
        "fullscreen-blank-band",
        "SKIP per request unless better; existing hit-fullscreen-blank-band.txt found:false kept",
    ),
    (
        11,
        "managed-settings-prompt",
        "SKIP per request; already dug managed-settings",
    ),
    (
        12,
        "tmux-title",
        "SKIP per request unless better; existing found:false kept",
    ),
]:
    note_result(id_, key, False if id_ in (10, 12) else True, [], note)

# Write JSON summary
import json

summary_path = OUT_DIR / "remaining-dig-summary.json"
summary_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results, indent=2))
print(f"wrote {summary_path}")
print(f"hit files: {len(list(OUT_DIR.glob('hit-*.txt')))}")

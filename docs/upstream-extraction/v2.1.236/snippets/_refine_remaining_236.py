#!/usr/bin/env python3
"""Refine remaining 2.1.236 SEA hit snippets with best evidence only."""

from __future__ import annotations

import json
import re
from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets"
)
data = SEA.read_bytes()


def pr(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def count(n: str | bytes) -> int:
    b = n.encode("latin1") if isinstance(n, str) else n
    return data.count(b)


def first(n: str | bytes, start: int = 0) -> int:
    b = n.encode("latin1") if isinstance(n, str) else n
    return data.find(b, start)


def all_offs(n: str | bytes, limit: int = 50) -> list[int]:
    b = n.encode("latin1") if isinstance(n, str) else n
    out: list[int] = []
    s = 0
    while len(out) < limit:
        i = data.find(b, s)
        if i < 0:
            break
        out.append(i)
        s = i + 1
    return out


def ctx(off: int, radius: int = 420) -> str:
    lo = max(0, off - radius)
    hi = min(len(data), off + radius)
    return pr(data[lo:hi])


def pick_best(
    needle: str | bytes,
    prefer_substrings: list[str] | None = None,
    radius: int = 450,
    limit_scan: int = 80,
) -> list[tuple[int, str]]:
    prefer_substrings = prefer_substrings or []
    scored: list[tuple[int, int, str]] = []
    for i in all_offs(needle, limit_scan):
        text = ctx(i, radius)
        low = text.lower()
        score = sum(3 for p in prefer_substrings if p.lower() in low)
        # Prefer denser JS-ish windows over sparse UTF16-ish
        printable_ratio = sum(1 for c in text if c != ".") / max(1, len(text))
        score += int(printable_ratio * 10)
        if "function " in text or "=>" in text or "return" in text:
            score += 5
        scored.append((score, i, text))
    scored.sort(key=lambda x: (-x[0], x[1]))
    # de-dupe overlapping
    picked: list[tuple[int, str]] = []
    for _, i, text in scored:
        if any(abs(i - j) < 200 for j, _ in picked):
            continue
        picked.append((i, text))
        if len(picked) >= 6:
            break
    return picked


def write_hit(
    key: str,
    checklist: str,
    patterns: list[str],
    found: bool,
    symbols: list[str],
    note: str,
    sections: list[tuple[str, list[tuple[int, str]]]],
) -> dict:
    lines: list[str] = [
        f"SEA: {SEA}",
        "version: 2.1.236 (Claude Code)",
        f"key: {key}",
        f"checklist: {checklist}",
        f"found: {str(found).lower()}",
        f"topSymbols: {symbols}",
        f"oneLineNote: {note}",
        f"search_patterns: {patterns!r}",
        "",
        "=== pattern counts ===",
    ]
    for p in patterns:
        lines.append(f"{p!r}: {count(p)}")
    lines.append("")
    for title, hits in sections:
        lines.append(f"=== {title} ===")
        if not hits:
            lines.append("(none)")
            lines.append("")
            continue
        for i, text in hits:
            lines.append(f"--- offset {i} ---")
            lines.append(text)
            lines.append("")
    path = OUT / f"hit-{key}.txt"
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return {
        "id": None,
        "key": key,
        "found": found,
        "topSymbols": symbols,
        "oneLineNote": note,
        "path": str(path),
    }


results: list[dict] = []

# ---------- #9 ----------
r = write_hit(
    "fullscreen-resize-message",
    "Fullscreen: newly sent message missing until next update after resize",
    [
        "newly sent",
        "message missing",
        "VirtualMessageList",
        "handleResize",
        "replayPending",
        "tickPump",
        "nativeHistory",
    ],
    True,
    ["handleResize", "replayPending", "tickPump", "nativeHistory", "VirtualMessageList"],
    "No literal newly-sent-message string; fullscreen handleResize sets replayPending and tickPump replays nativeHistory",
    [
        (
            "BEST handleResize replayPending",
            pick_best(
                "replayPending=!0",
                ["handleResize", "tickPump", "nativeHistory"],
                500,
            ),
        ),
        (
            "BEST tickPump nativeHistory",
            pick_best("tickPump(){", ["nativeHistory", "pumpCursor"], 420),
        ),
        (
            "VirtualMessageList",
            pick_best("VirtualMessageList", ["resize", "message", "fullscreen"], 420),
        ),
    ],
)
r["id"] = 9
results.append(r)

# ---------- #13 ----------
r = write_hit(
    "cloud-env-empty",
    "Unclear error when cloud environments list empty/malformed",
    [
        "usable environments list",
        "cloud environments service",
        "fetchEnvironments",
        "No cloud environment available",
        "empty or malformed",
    ],
    True,
    ["MIS", "iSe", "fetchEnvironments", "teleport_environments_list"],
    "fetchEnvironments/MIS returns clear empty/non-JSON/no usable environments list errors; exact 'cloud environments list' absent",
    [
        (
            "BEST MIS fetchEnvironments empty/malformed",
            pick_best(
                "usable environments list",
                ["fetchEnvironments", "cloud environments service", "empty"],
                520,
            ),
        ),
        (
            "No cloud environment available",
            pick_best("No cloud environment available", ["teleport", "environment"], 420),
        ),
    ],
)
r["id"] = 13
results.append(r)

# ---------- #14 ----------
# Look for timeout near fable consent
consent_hits = pick_best(
    "fable_overage_consent_prompt",
    ["remote", "timeout", "fallback", "usage", "60", "60000"],
    520,
)
fallback_hits = pick_best(
    "fableConsentSessionFallback",
    ["replace", "remote", "consent", "fallback"],
    480,
)
# search numeric 60000 near consent/fable
near_60 = []
for i in all_offs("60000", 200):
    text = ctx(i, 500)
    low = text.lower()
    if any(
        k in low
        for k in (
            "fable",
            "consent",
            "overage",
            "usage-credit",
            "usage_credit",
            "fallback",
            "remote control",
        )
    ):
        near_60.append((i, text))
        if len(near_60) >= 8:
            break
# also 60_000 / 60*1000 patterns near fable
for needle in ["60_000", "60*1000", "60 * 1000", "1e4*6", "60e3"]:
    near_60.extend(pick_best(needle, ["fable", "consent", "overage"], 400, 20))

r = write_hit(
    "fable5-credits-rc",
    "Fable 5 first-time usage-credits prompt auto-selecting fallback after 60s under Remote Control",
    [
        "fable_overage_consent_prompt",
        "fableConsentSessionFallback",
        "usage-credits",
        "60000",
        "auto-select",
        "Remote Control",
    ],
    True,
    [
        "fable_overage_consent_prompt",
        "fableConsentSessionFallback",
        "replaceFableConsentSessionFallback",
        "fableCreditsRequired",
    ],
    "Consent prompt + sessionFallback symbols found; no literal '60s'/'auto-select' string tied to RC in SEA latin1",
    [
        ("BEST fable_overage_consent_prompt", consent_hits),
        ("BEST fableConsentSessionFallback", fallback_hits),
        (
            "choose continue Fable 5 on usage credits",
            pick_best(
                "continue Fable 5 on usage credits",
                ["switch models", "prompt"],
                420,
            ),
        ),
        ("60000 near fable/consent/credits/remote", near_60[:6]),
    ],
)
r["id"] = 14
results.append(r)

# ---------- #15 ----------
r = write_hit(
    "guest-pass-malformed",
    "Spinner tips never appear when guest-pass reward in ~/.claude.json malformed",
    [
        "guest-pass",
        "guest-passes",
        "referrer_reward",
        "spinner tip failed",
        "spinnerTipsEnabled",
        "wgm(",
        "Efr()",
    ],
    True,
    [
        "Efr",
        "wgm",
        "VsT.safeParse",
        "referrer_reward",
        "passesEligibilityCache",
        "spinner tip failed",
        "guest-passes",
    ],
    "Guest-pass tip content uses Efr()->wgm(safeParse referrer_reward); malformed reward parses to null. 'spinner tip failed' is separate catch path. No literal ~/.claude.json guest-pass malformed string",
    [
        (
            "BEST safeParse referrer_reward / Efr",
            pick_best(
                "wgm(r?.referrer_reward)",
                ["safeParse", "passesEligibilityCache", "Efr"],
                520,
            ),
        ),
        (
            "guest-passes tip uses Efr()",
            pick_best(
                'id:"guest-passes"',
                ["Efr", "usage credits", "/passes", "spinner"],
                520,
            ),
        ),
        (
            "spinner tip failed catch",
            pick_best("spinner tip failed", ["spinnerTip", "catch"], 480),
        ),
        (
            "Cannot destructure storageV5 near guest-passes",
            pick_best(
                "Cannot destructure property 'storageV5'",
                ["guest-passes"],
                420,
            ),
        ),
    ],
)
r["id"] = 15
results.append(r)

# ---------- #16 ----------
# skills + cwd deleted
skills_hits = []
for needle in [
    "reloadSkills",
    "hook_session_start_reload_skills",
    "discoverSkills",
    "loadSkill",
    "skills from",
]:
    skills_hits.extend(
        pick_best(
            needle,
            ["cwd", "enoent", "deleted", "error", "skill", "watch"],
            500,
            40,
        )
    )
# specific ENOENT near skill
enoent_skill = []
for i in all_offs("ENOENT", 300):
    text = ctx(i, 500)
    low = text.lower()
    if "skill" in low and any(k in low for k in ("cwd", "reload", "watch", "dir", "path")):
        enoent_skill.append((i, text))
        if len(enoent_skill) >= 6:
            break
cwd_deleted = []
for needle in [
    "no longer exists",
    "directory has been deleted",
    "cwd deleted",
    "working directory",
    "getCwd()",
]:
    cwd_deleted.extend(
        pick_best(needle, ["skill", "reload", "enoent", "session"], 450, 30)
    )

r = write_hit(
    "skills-hot-reload-cwd",
    "Skills hot-reload error after session cwd deleted (SDK/VS Code; 2.1.229+)",
    [
        "hot-reload",
        "hotReload",
        "reloadSkills",
        "ENOENT",
        "cwd",
        "deleted",
    ],
    count("reloadSkills") > 0,
    ["reloadSkills", "hook_session_start_reload_skills"],
    "reloadSkills present (hooks/SDK). literal skills hot-reload+cwd-deleted/ENOENT pairing not clearly found; hot-reload mostly keybindings/Bun runtime",
    [
        (
            "BEST reloadSkills",
            pick_best(
                "reloadSkills",
                ["hook", "session", "watchPaths", "emit"],
                520,
            ),
        ),
        (
            "hook_session_start_reload_skills",
            pick_best("hook_session_start_reload_skills", ["reloadSkills"], 420),
        ),
        ("ENOENT near skill", enoent_skill),
        ("cwd/deleted related", cwd_deleted[:4]),
        (
            "hot-reload (mostly non-skills)",
            pick_best("hot-reload", ["skill", "keybinding", "watch"], 400),
        ),
    ],
)
r["id"] = 16
results.append(r)

# ---------- #17 ----------
r = write_hit(
    "self-hosted-runner",
    "Self-hosted runner: idle/retire/startup-timeout release occasionally resumes elsewhere before post-session hook done",
    [
        "startup-timeout",
        "post-session",
        "self-hosted",
        "retire",
        "release",
        "self-hosted-runner",
        "self_hosted_runner",
    ],
    count("startup-timeout") > 0 and count("self-hosted") > 0,
    ["startup-timeout", "self-hosted", "post-session", "retire"],
    "startup-timeout + self-hosted + post-session strings present; inspect retire/release ordering vs post-session hook",
    [
        (
            "BEST startup-timeout",
            pick_best(
                "startup-timeout",
                ["runner", "retire", "release", "idle", "post"],
                520,
            ),
        ),
        (
            "BEST post-session",
            pick_best(
                "post-session",
                ["runner", "hook", "retire", "release", "self-hosted"],
                520,
            ),
        ),
        (
            "self-hosted-runner / pool",
            pick_best(
                "self-hosted",
                ["runner", "retire", "startup", "timeout", "pool"],
                480,
            ),
        ),
        (
            "retire near runner",
            pick_best("retire", ["runner", "idle", "release", "startup-timeout"], 480),
        ),
    ],
)
r["id"] = 17
results.append(r)

# ---------- #18 ----------
r = write_hit(
    "clawd-eyes",
    "Clawd mascot eyes/feet uneven in iTerm2 at some font sizes",
    ["clawd", "mascot", "eyes", "feet", "iTerm", "iTerm2"],
    count("clawd") > 0,
    ["clawd"],
    "clawd present; eyes/feet/iTerm font-size unevenness may be glyph/render-only without distinctive string",
    [
        (
            "BEST clawd",
            pick_best("clawd", ["eye", "feet", "mascot", "iterm", "buddy", "font"], 480),
        ),
        ("mascot", pick_best("mascot", ["clawd", "buddy"], 400)),
        (
            "eyes near clawd/buddy",
            pick_best("eyes", ["clawd", "buddy", "mascot", "feet"], 400),
        ),
        (
            "feet near clawd/buddy",
            pick_best("feet", ["clawd", "buddy", "mascot", "eyes"], 400),
        ),
    ],
)
r["id"] = 18
results.append(r)

# ---------- #19 ----------
# recap 400
recap400 = []
for i in all_offs("recap", 200):
    text = ctx(i, 500)
    if any(x in text for x in ("400", "word", "boundary", "chars", "character", "cap")):
        recap400.append((i, text))
        if len(recap400) >= 10:
            break
# also away summary / under N words
r = write_hit(
    "recap-cap",
    "Recap runaway: cap at 400 chars, word boundary (auto + /recap)",
    ["recap", "/recap", "400", "word boundary", "Recap in under"],
    count("recap") > 0,
    ["recap", "Recap in under"],
    "/recap literal absent; recap strings present including word-limited prompt text — verify 400-char word-boundary cap",
    [
        (
            "BEST Recap in under",
            pick_best("Recap in under", ["words", "plain sentences"], 450),
        ),
        ("recap near 400/word/cap", recap400[:6]),
        (
            "away/recap related",
            pick_best("away", ["recap", "summary", "40 words", "400"], 400),
        ),
    ],
)
r["id"] = 19
results.append(r)

# ---------- #20 ----------
r = write_hit(
    "startup-session-counter",
    "Startup: session counter written in background",
    ["sessionCounter", "SessionCounter", "session counter", "numStartups"],
    count("sessionCounter") > 0 or count("numStartups") > 0,
    ["sessionCounter", "numStartups"],
    "sessionCounter/numStartups present; look for background write on startup",
    [
        (
            "BEST sessionCounter",
            pick_best(
                "sessionCounter",
                ["startup", "background", "write", "increment", "numStartups"],
                520,
            ),
        ),
        (
            "numStartups",
            pick_best(
                "numStartups",
                ["startup", "background", "session", "increment"],
                480,
            ),
        ),
    ],
)
r["id"] = 20
results.append(r)

# ---------- #21 ----------
r = write_hit(
    "auto-mode-monitor",
    "Auto mode: Monitor allow rules set aside so Monitor reviewed like Bash",
    [
        "Monitor",
        "alwaysAllowRules",
        "auto mode",
        "set aside",
        "classifier",
        "MonitorTool",
    ],
    True,
    ["Monitor", "alwaysAllowRules", "classifier", "MonitorTool"],
    "Monitor + alwaysAllowRules present; dig auto-mode path that sets aside Monitor allow rules like Bash review",
    [
        (
            "alwaysAllowRules near Monitor/auto",
            pick_best(
                "alwaysAllowRules",
                ["Monitor", "auto", "bash", "classifier", "set aside"],
                520,
            ),
        ),
        (
            "MonitorTool",
            pick_best("MonitorTool", ["allow", "auto", "permission"], 450),
        ),
        ("set aside", pick_best("set aside", ["monitor", "allow", "auto"], 400)),
        (
            "auto mode + Monitor",
            pick_best("auto mode", ["Monitor", "allow", "classifier", "bash"], 450),
        ),
    ],
)
r["id"] = 21
results.append(r)

# ---------- #22 ----------
r = write_hit(
    "auto-mode-bedrock-defaults",
    "Auto mode on Bedrock/Vertex/Foundry + telemetry-off: classifier same defaults incl severity-scored",
    [
        "Bedrock",
        "Vertex",
        "Foundry",
        "severity",
        "classifier",
        "telemetry-off",
        "telemetryOff",
    ],
    True,
    ["Bedrock", "Vertex", "Foundry", "classifier", "severity"],
    "Provider names + classifier/severity present; telemetry-off default parity string may be indirect",
    [
        (
            "classifier near Bedrock/Vertex/Foundry/severity",
            pick_best(
                "classifier",
                ["bedrock", "vertex", "foundry", "severity", "telemetry", "auto"],
                520,
            ),
        ),
        (
            "severity-scored / severity",
            pick_best("severity", ["classifier", "auto", "score", "bedrock"], 450),
        ),
        (
            "telemetry-off / telemetryOff",
            pick_best("telemetry", ["off", "classifier", "auto", "bedrock"], 420),
        ),
    ],
)
r["id"] = 22
results.append(r)

# ---------- #23 ----------
uall = pick_best("-uall", ["git", "status", "untracked"], 450)
untracked = pick_best(
    "untracked",
    ["showUntrackedFiles", "status", "git", "-u", "auto"],
    480,
)
show = pick_best("showUntrackedFiles", ["status", "git"], 420)
r = write_hit(
    "status-showUntrackedFiles",
    "Auto mode git status not fooled by status.showUntrackedFiles=no",
    ["showUntrackedFiles", "untracked", "git status -u", "-uall", "-unormal"],
    count("-uall") > 0 or count("untracked") > 0,
    ["-uall", "untracked"] if count("showUntrackedFiles") == 0 else ["showUntrackedFiles", "-uall"],
    "literal showUntrackedFiles ABSENT; -uall/untracked present — likely force -uall for auto-mode git status",
    [
        ("showUntrackedFiles", show),
        ("BEST -uall", uall),
        ("untracked near git/status", untracked),
        (
            "git status -u",
            pick_best("git status", ["-u", "untracked", "auto"], 420),
        ),
    ],
)
r["id"] = 23
results.append(r)

# ---------- #24 ----------
r = write_hit(
    "model-picker-highlight",
    "/model highlight only newest model name",
    ["newest model", "highlight", "ModelPicker"],
    count("newest model") > 0 and count("ModelPicker") > 0,
    ["ModelPicker", "newest model"],
    "Found 'newest model' + ModelPicker; confirm highlight applies only to newest name",
    [
        (
            "BEST newest model",
            pick_best("newest model", ["highlight", "picker", "model"], 480),
        ),
        (
            "ModelPicker",
            pick_best("ModelPicker", ["newest", "highlight", "model"], 480),
        ),
    ],
)
r["id"] = 24
results.append(r)

# ---------- #25 ----------
r = write_hit(
    "goal-idle-checkin",
    "/goal: idle+parked behind bg work auto check-in 30m then 1h/2h",
    ["/goal", "check-in", "checkin", "30m", "parked", "idle", "1800000", "3600000"],
    count("/goal") > 0,
    ["/goal", "check-in", "checkin", "parked"],
    "/goal + check-in/checkin/parked present; dig 30m/1h/2h schedule constants",
    [
        (
            "BEST /goal",
            pick_best("/goal", ["check", "idle", "park", "30", "background"], 520),
        ),
        (
            "check-in near goal/idle/park",
            pick_best("check-in", ["goal", "idle", "park", "30"], 480),
        ),
        (
            "parked near goal/idle",
            pick_best("parked", ["goal", "idle", "check", "background"], 450),
        ),
        (
            "1800000/3600000/7200000 near goal/check",
            [
                *pick_best("1800000", ["goal", "check", "idle", "park"], 400),
                *pick_best("3600000", ["goal", "check", "idle", "park"], 400),
                *pick_best("7200000", ["goal", "check", "idle", "park"], 400),
            ][:6],
        ),
    ],
)
r["id"] = 25
results.append(r)

# ---------- #26 ----------
r = write_hit(
    "usage-credits-row",
    "/usage usage-credits spend row for Team/Enterprise; capped 0% before spend",
    ["usage-credits", "/usage", "credits spend", "Team", "Enterprise", "0%"],
    count("usage-credits") > 0,
    ["usage-credits", "/usage"],
    "usage-credits + /usage present; dig Team/Enterprise spend row and 0% pre-spend cap",
    [
        (
            "/usage near credits/spend/team",
            pick_best("/usage", ["credit", "spend", "team", "enterprise", "0%"], 500),
        ),
        (
            "usage-credits spend-ish",
            pick_best(
                "usage-credits",
                ["spend", "team", "enterprise", "0%", "/usage"],
                480,
            ),
        ),
        (
            "0% near credits/usage",
            pick_best("0%", ["credit", "usage", "spend", "cap"], 400),
        ),
    ],
)
r["id"] = 26
results.append(r)

# ---------- #27 ----------
r = write_hit(
    "sigterm-print",
    "SIGTERM print/SDK: no interrupted-turn / synthetic denials; still kill cmds + exit 143",
    ["SIGTERM", "143", "interrupted-turn", "synthetic denial", "print mode"],
    count("interrupted-turn") > 0,
    ["SIGTERM", "interrupted-turn", "143"],
    "interrupted-turn present with SIGTERM/143 neighborhood; dig print/SDK path that skips interrupted-turn/synthetic denials",
    [
        (
            "BEST interrupted-turn",
            pick_best(
                "interrupted-turn",
                ["sigterm", "143", "print", "sdk", "denial", "synthetic"],
                520,
            ),
        ),
        (
            "SIGTERM near 143/print",
            pick_best("SIGTERM", ["143", "print", "interrupted", "sdk", "exit"], 450),
        ),
        (
            "synthetic denial",
            pick_best("synthetic", ["denial", "interrupt", "sigterm", "print"], 420),
        ),
    ],
)
r["id"] = 27
results.append(r)

# ---------- #28 ----------
r = write_hit(
    "slash-typo-enter",
    "Enter on slash typo/unavailable reports instead of closest fuzzy; prefixes/aliases still run",
    ["slash", "typo", "fuzzy", "unavailable", "closest", "Did you mean"],
    True,
    ["fuzzy", "Did you mean", "slash"],
    "Did you mean / fuzzy / slash present; dig enter-on-typo reports unavailable instead of auto-running closest",
    [
        (
            "Did you mean",
            pick_best("Did you mean", ["slash", "command", "fuzzy", "typo"], 480),
        ),
        (
            "fuzzy near slash/command",
            pick_best("fuzzy", ["slash", "command", "typo", "closest", "unavailable"], 480),
        ),
        (
            "unavailable near slash/command",
            pick_best("unavailable", ["slash", "command", "typo", "fuzzy"], 420),
        ),
    ],
)
r["id"] = 28
results.append(r)

# ---------- #29 ----------
r = write_hit(
    "rc-offline-seconds",
    "Remote Control marks session offline within seconds on CLI/terminal exit",
    ["offline", "Remote Control", "within seconds", "session offline"],
    True,
    ["offline", "Remote Control"],
    "offline + Remote Control present; dig fast mark-offline on process/terminal exit",
    [
        (
            "session offline / went offline",
            pick_best("offline", ["remote", "bridge", "session", "seconds", "exit"], 500),
        ),
        (
            "within seconds",
            pick_best("within seconds", ["offline", "remote", "session"], 400),
        ),
        (
            "REMOTE_CONTROL / bridge offline",
            pick_best(
                "Remote Control",
                ["offline", "disconnect", "exit", "seconds"],
                450,
            ),
        ),
    ],
)
r["id"] = 29
results.append(r)

# ---------- #30 ----------
r = write_hit(
    "sendmessage-burst",
    "SendMessage refuses further msgs once burst would exceed inbox (no false sent)",
    ["burst", "inbox", "SendMessage", "refuse", "exceed"],
    count("SendMessage") > 0 and count("burst") > 0,
    ["SendMessage", "burst", "inbox"],
    "SendMessage + burst/inbox present; dig refuse path when burst would exceed inbox",
    [
        (
            "SendMessage near burst/inbox/exceed",
            pick_best(
                "SendMessage",
                ["burst", "inbox", "exceed", "refuse", "cap", "full"],
                520,
            ),
        ),
        (
            "burst near inbox/message",
            pick_best("burst", ["inbox", "send", "message", "exceed", "refuse"], 480),
        ),
        (
            "inbox near SendMessage/burst",
            pick_best("inbox", ["burst", "SendMessage", "exceed", "full", "cap"], 450),
        ),
    ],
)
r["id"] = 30
results.append(r)

# ---------- #31 ----------
r = write_hit(
    "title-chip-align",
    "Session title chip aligned with footer right edge",
    ["title chip", "footer", "right edge", "SessionTitle", "titleChip"],
    count("SessionTitle") > 0,
    ["SessionTitle"],
    "literal 'title chip' ABSENT; SessionTitle present — dig footer right-edge alignment",
    [
        (
            "SessionTitle near footer/right",
            pick_best("SessionTitle", ["footer", "right", "chip", "align", "edge"], 500),
        ),
        ("title chip", pick_best("title chip", [], 300)),
        (
            "right edge near title/footer",
            pick_best("right edge", ["title", "footer", "chip"], 400),
        ),
    ],
)
r["id"] = 31
results.append(r)

# ---------- #32 ----------
r = write_hit(
    "footer-right-margin",
    "Right-aligned footer items + truncated notices share consistent right margin",
    ["right margin", "footer", "truncated notices", "rightMargin", "truncatedNotice"],
    count("footer") > 0,
    ["footer"],
    "literal 'right margin' ABSENT; dig footer truncation/right-align margin symbols",
    [
        (
            "footer near margin/right/truncat",
            pick_best("footer", ["margin", "right", "truncat", "notice", "align"], 500),
        ),
        ("right margin", pick_best("right margin", [], 300)),
        (
            "truncated near footer/notice",
            pick_best("truncat", ["footer", "notice", "margin", "right"], 450),
        ),
    ],
)
r["id"] = 32
results.append(r)

# ---------- #33 ----------
r = write_hit(
    "vscode-a11y",
    "[VSCode] transcript screen reader: live announcements + per-turn heading nav",
    ["screen reader", "live region", "aria", "heading", "aria-live", "vscode"],
    count("screen reader") > 0 or count("live region") > 0,
    ["screen reader", "live region"],
    "CLI screen-reader/live-region strings exist in SEA; VSCode host transcript a11y remains invent-ban N/A unless vscode-specific evidence appears",
    [
        (
            "screen reader",
            pick_best(
                "screen reader",
                ["vscode", "heading", "live", "transcript", "announce"],
                480,
            ),
        ),
        (
            "live region",
            pick_best("live region", ["aria", "screen", "reader", "announce"], 450),
        ),
        (
            "aria-live",
            pick_best("aria-live", ["screen", "reader", "vscode"], 400),
        ),
    ],
)
r["id"] = 33
results.append(r)

# ---------- recheck #7 ----------
r = write_hit(
    "sendmessage-malformed-tag",
    "SendMessage rejected when malformed closing tag left text in summary (RECHECK)",
    [
        "split_slipped_summary_",
        "isSlippedSummarySplitEnabled",
        "coerceInput",
        "closing tag",
        "SendMessage",
        "unrepaired",
    ],
    True,
    [
        "SendMessageTool",
        "coerceInput",
        "yEi",
        "isSlippedSummarySplitEnabled",
        "split_slipped_summary_",
    ],
    "RECHECK confirmed: coerceInput->yEi slipped-summary split; exact 'malformed closing tag' phrase absent",
    [
        (
            "BEST coerceInput yEi slipped summary",
            pick_best(
                "coerceInput:(e)=>yEi",
                ["SendMessage", "applySplit", "summary"],
                520,
            ),
        ),
        (
            "split_slipped_summary_",
            pick_best(
                "split_slipped_summary_",
                ["unrepaired", "summary", "message", "openerForm"],
                520,
            ),
        ),
        (
            "isSlippedSummarySplitEnabled",
            pick_best("isSlippedSummarySplitEnabled", ["SendMessage"], 420),
        ),
    ],
)
r["id"] = 7
results.append(r)

# ---------- recheck #8 ----------
r = write_hit(
    "subprocess-unhandled",
    "Unhandled rejection when subprocess fails to start (e.g. powershell on WSL) — RECHECK",
    [
        "powershell.exe",
        "failed to spawn",
        "unhandledRejection",
        "WSL",
        "spawn",
    ],
    True,
    ["powershell.exe", "unhandledRejection", "failed to spawn"],
    "RECHECK: powershell.exe/WSL spawn sites + failed-to-spawn/unhandledRejection present; exact changelog phrase absent — spawn-fail catch likely near shell spawn helpers",
    [
        (
            "powershell.exe WSL clipboard spawn",
            pick_best("powershell.exe", ["wsl", "spawn", "clipboard", "catch"], 500),
        ),
        (
            "failed to spawn",
            pick_best("failed to spawn", ["shell", "powershell", "spawn", "catch"], 450),
        ),
        (
            "unhandledRejection",
            pick_best("unhandledRejection", ["spawn", "powershell", "promise"], 420),
        ),
    ],
)
r["id"] = 8
results.append(r)

# skips
for id_, key, found, note in [
    (
        10,
        "fullscreen-blank-band",
        False,
        "SKIP unless better; existing hit kept found:false",
    ),
    (11, "managed-settings-prompt", True, "SKIP; already dug managed-settings"),
    (12, "tmux-title", False, "SKIP unless better; existing found:false kept"),
]:
    results.append(
        {
            "id": id_,
            "key": key,
            "found": found,
            "topSymbols": [],
            "oneLineNote": note,
        }
    )

# Post-adjust found flags based on evidence quality for weak keys
# Read back a few critical counts
adjust_notes = {
    16: (
        count("reloadSkills") > 0,
        ["reloadSkills", "hook_session_start_reload_skills"],
        "reloadSkills/hook path found; no clear cwd-deleted ENOENT pairing for skills hot-reload in latin1",
    ),
    18: (
        count("clawd") > 0,
        ["clawd"],
        "clawd found; no distinctive eyes/feet/iTerm uneven-font strings colocated",
    ),
    19: (
        count("recap") > 0,
        ["recap"],
        f"/recap count={count('/recap')}; Recap-in-under present; 400-char word-boundary cap string not clearly confirmed",
    ),
    23: (
        count("-uall") > 0 or count("untracked") > 0,
        ["-uall", "untracked"],
        f"showUntrackedFiles count={count('showUntrackedFiles')} (absent); -uall={count('-uall')}",
    ),
    31: (
        count("SessionTitle") > 0,
        ["SessionTitle"],
        f"title chip count={count('title chip')} (absent); SessionTitle={count('SessionTitle')}",
    ),
    32: (
        count("footer") > 0,
        ["footer"],
        f"right margin count={count('right margin')} (absent); footer truncation/right-align symbols only",
    ),
}
for item in results:
    if item["id"] in adjust_notes:
        found, syms, note = adjust_notes[item["id"]]
        item["found"] = found
        item["topSymbols"] = syms
        item["oneLineNote"] = note

# compact output array
compact = [
    {
        "id": x["id"],
        "key": x["key"],
        "found": x["found"],
        "topSymbols": x.get("topSymbols", []),
        "oneLineNote": x.get("oneLineNote", ""),
    }
    for x in sorted(results, key=lambda z: z["id"] or 0)
]

(OUT / "remaining-dig-summary.json").write_text(
    json.dumps(compact, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(compact, indent=2))
print("hit files:", len(list(OUT.glob("hit-*.txt"))))

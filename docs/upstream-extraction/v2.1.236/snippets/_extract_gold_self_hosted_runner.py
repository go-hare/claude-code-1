#!/usr/bin/env python3
"""Extract concrete gold excerpts for self-hosted-runner release vs post-session await order."""
from pathlib import Path

SEA = Path("/tmp/official-236/plat/package/claude")
OUT = Path(
    "/Users/apple/work-py/hare-code/claude-code-1/docs/upstream-extraction/v2.1.236/snippets/gold-self-hosted-runner.txt"
)
data = SEA.read_bytes()


def printable(chunk: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)


def slice_at(needle: bytes, before: int = 200, after: int = 3500) -> tuple[int, str] | None:
    i = data.find(needle)
    if i < 0:
        return None
    lo = max(0, i - before)
    hi = min(len(data), i + after)
    return i, printable(data[lo:hi])


def all_slices(needle: bytes, before: int, after: int, limit: int = 8):
    out = []
    start = 0
    while len(out) < limit:
        i = data.find(needle, start)
        if i < 0:
            break
        lo = max(0, i - before)
        hi = min(len(data), i + after)
        out.append((i, printable(data[lo:hi])))
        start = i + 1
    return out


lines: list[str] = []
lines.append("SEA: /tmp/official-236/plat/package/claude")
lines.append("version: 2.1.236")
lines.append("key: self-hosted-runner")
lines.append(
    "gold: release-idle / startup-timeout / retire can resume elsewhere BEFORE post-session hook finishes; await order / gate that prevents early release"
)
lines.append(
    "symbols/flags: releaseForRetire, jxy (post-session hook runner), Bxy/Uxy/etu inFlight gate, SELF_HOSTED_RUNNER_SESSION_IDLE_MS, SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS, SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS, SELF_HOSTED_RUNNER_RETIRE_AT / --retire-at, --release-idle-session-min, --startup-timeout-min, --post-session-hook-timeout-sec, --push-outcome-on-release, idle-release, deassign, awaiting-action"
)
lines.append("")

blocks = [
    (
        "POST_SESSION_HOOK_jxy",
        b"async function jxy(e){",
        0,
        6500,
        "jxy spawns post-session hook; tracks inFlight via Bxy/Uxy; SIGTERM/SIGKILL timeout path",
    ),
    (
        "INFLIGHT_GATE_Bxy_Uxy_etu",
        b"class Bxy{inFlight=0;increment(){this.inFlight++}decrement(){this.inFlight--}}",
        0,
        800,
        "inFlight counter shared by host; etu() exposes inFlight for shutdown wait",
    ),
    (
        "RETIRE_releaseForRetire",
        b"retire time reached",
        200,
        2500,
        "retire timer sets F=true and calls we.releaseForRetire() on each active session",
    ),
    (
        "RETIRE_DOC_parked_resumable",
        b"parked, resumable",
        400,
        900,
        "docs: active sessions released (parked, resumable) before host hard kill",
    ),
    (
        "IDLE_RELEASE_WATCHDOG_CONFIG",
        b"[runner] watchdog config: idle-release=",
        300,
        1200,
        "watchdog config line: idle-release / startup-timeout / kill-session-after / exit-if-unused",
    ),
    (
        "SHUTDOWN_BUDGET_includes_post_session",
        b"This runner needs up to ",
        200,
        1400,
        "shutdown budget includes stop Claude + post-session hook; release already in flight can add Ttu",
    ),
    (
        "IGNORE_RELEASED_awaiting_deassign",
        b"Ignoring released session",
        150,
        700,
        "poll loop ignores released sessions while awaiting server deassign / in-flight release settle",
    ),
    (
        "RELEASE_DECLINED_awaiting_action",
        b"release declined (",
        200,
        1200,
        "release can be declined while awaiting-action / queued event / pending user event; retiring retries",
    ),
    (
        "IDLE_TIMER_mid_turn_skip",
        b"idle timer fired mid-turn",
        150,
        700,
        "idle timer mid-turn skips release (stdout-tee likely broken)",
    ),
    (
        "PUSH_OUTCOME_ON_RELEASE_HELP",
        b"--push-outcome-on-release",
        80,
        1200,
        "CLI help: idle-release / drain push outcome branches so resume elsewhere keeps linear history",
    ),
    (
        "COMPLETED_includes_idle_release_startup_timeout",
        b"idle release, startup timeout, server deassign",
        200,
        900,
        "metrics: idle release / startup timeout / server deassign count as clean completed handoff",
    ),
    (
        "SIGKILL_RENAME_note_hook_after",
        b"The post-session hook runs after this.",
        250,
        900,
        "SESSION_STOP_GRACE waits for Claude exit; post-session hook runs AFTER that",
    ),
]

for name, needle, before, after, note in blocks:
    hit = slice_at(needle, before, after)
    lines.append("=" * 80)
    lines.append(f"BLOCK | {name}")
    if hit is None:
        lines.append("(MISSING)")
        lines.append(f"note: {note}")
        lines.append("")
        continue
    i, text = hit
    lines.append(f"offset {i} (0x{i:x})")
    lines.append(f"note: {note}")
    lines.append("=" * 80)
    lines.append(text)
    lines.append("")

# Extra: find await order around post-session + release by searching for patterns near jxy callers
lines.append("=" * 80)
lines.append("BLOCK | CALLERS_near_await_jxy_or_postSession")
lines.append("=" * 80)
for needle in [
    b"await jxy(",
    b"jxy({",
    b"postSessionHook",
    b"POST_SESSION_HOOK",
    b"runPostSession",
    b"post_session_hook",
    b"hookPath",
]:
    hits = all_slices(needle, 250, 900, 6)
    lines.append(f"-- needle {needle!r} count={data.count(needle)} shown={len(hits)} --")
    for i, text in hits:
        # Prefer runner-ish contexts
        low = text.lower()
        if any(k in low for k in ("runner", "session", "release", "retire", "idle", "hook", "jxy")):
            lines.append(f"--- offset {i} ---")
            lines.append(text)
            lines.append("")

# Search for explicit early-release / resume-elsewhere wording
lines.append("=" * 80)
lines.append("BLOCK | RESUME_ELSEWHERE_AND_EARLY_RELEASE_WORDING")
lines.append("=" * 80)
for needle in [
    b"resume elsewhere",
    b"resumable",
    b"can be resumed",
    b"requeued when this runner exits",
    b"releasing so",
    b"before the post-session",
    b"after the post-session",
    b"await the post-session",
    b"awaiting post-session",
    b"wait for the post-session",
    b"hook still running",
    b"hook in flight",
    b"inFlight",
    b"etu()",
]:
    c = data.count(needle)
    lines.append(f"count {needle!r} = {c}")
    if c == 0:
        continue
    for i, text in all_slices(needle, 300, 800, 5):
        low = text.lower()
        if any(
            k in low
            for k in (
                "runner",
                "post-session",
                "idle",
                "retire",
                "release",
                "hook",
                "session",
                "inflight",
            )
        ):
            lines.append(f"--- {needle!r} @ {i} ---")
            lines.append(text)
            lines.append("")

# Control-flow synthesis section (human-written from mined evidence)
lines.append("=" * 80)
lines.append("BLOCK | CONTROL_FLOW_CONTRACT_SYNTHESIS")
lines.append("=" * 80)
lines.append(
    """
CONTRACT (densable 2.1.236 SEA gold):

1) FLAGS / ENV
   - --release-idle-session-min / SELF_HOSTED_RUNNER_SESSION_IDLE_MS (0 disables)
   - --startup-timeout-min / SELF_HOSTED_RUNNER_STARTUP_TIMEOUT_MS (0 disables)
   - --retire-at / SELF_HOSTED_RUNNER_RETIRE_AT (absolute Unix timestamp)
   - --post-session-hook-timeout-sec / SELF_HOSTED_RUNNER_POST_SESSION_HOOK_TIMEOUT_MS
   - --session-stop-grace related: SELF_HOSTED_RUNNER_SESSION_STOP_GRACE_MS
     (renamed from SELF_HOSTED_RUNNER_SIGKILL_TIMEOUT_MS); docs: "The post-session hook runs after this."
   - --push-outcome-on-release: on runner-initiated non-completed ends (SIGTERM drain, idle-release, failed),
     push outcome branches before delete so a resumed session elsewhere keeps linear history.

2) RETIRE PATH (early release so work can resume elsewhere)
   - Timer fe() flips F=true, telemetry be("self_hosted_retire"), logs
     "[runner:retire] retire time reached — releasing N active session(s), refusing new work; exiting once the slots are empty"
   - For each active session slot: we.releaseForRetire()
   - Poll loop: if F, refuse new starts with
     "[runner:retire] not starting session X — retire time has passed; it will be requeued when this runner exits"
   - Exit when F && Q()===0: "[runner:exit] retire time passed and no active sessions — exiting before the host kills this runner."
   - Ops doc explicitly: intended retire exit — "active sessions were released (parked, resumable) before the host's hard kill".

3) IDLE / STARTUP TIMEOUT as clean handoff (resume elsewhere)
   - sessions_completed_total HELP text counts as completed:
     "runner released the slot as a clean handoff (idle release, startup timeout, server deassign)"
   - Child abort reason string uses "idle-release" vs "deassign"
   - Mid-turn idle timer can SKIP release: "[runner:session] ... idle timer fired mid-turn — skipping release (stdout-tee likely broken)"
   - Release RPC may return declined while "awaiting-action" / queued event / pending user event;
     while retiring, keep session and retry (released_false_retiring_parked / released_false_retiring).

4) POST-SESSION HOOK AWAIT ORDER / GATE (prevents runner exit before hook finishes; NOT a gate that blocks release)
   - Session stop grace waits for Claude process exit FIRST; post-session hook runs AFTER that
     (explicit rename/fatal note).
   - Hook executor jxy(e):
       * logs "[runner:hook] post-session hook starting (session exit: ..., budget ...ms, via ...)"
       * spawn detached process group; Uxy()/Bxy inFlight++ while running
       * timeout path: "[runner:hook:post-session] timed out after ...ms, sending SIGTERM ..." then escalate
       * inFlight-- on settle
   - etu() => Uxy().inFlight exposes outstanding hooks.
   - Shutdown budget btu(sessionStopGrace, postSessionHookTimeout, ..., pushOutcome?):
     "[runner] This runner needs up to Us to stop the Claude process and run the post-session hook on shutdown,
      and force-exits after Us (a session release already in flight when shutdown begins can add up to Ttu s ...
      before the runner deregisters)".
   - Implication for race: session RELEASE / retire / idle-release / startup-timeout handoff can complete
     (slot freed / parked / requeued / claimable elsewhere) while local post-session hook may still be inFlight;
     the inFlight/etu + shutdown budget gate delays runner *deregister/exit*, not the server-side release.
   - Poll loop separately gates re-pickup of a just-released id:
     "Ignoring released session X — awaiting server deassign (or its in-flight release to settle)".

5) STRENGTH
   - Strong evidence for: flags, retire early release+requeue/resumable, idle/startup as completed handoff,
     post-session after session-stop-grace, inFlight hook counter, shutdown budget including hook.
   - The precise statement "release happens BEFORE post-session hook finishes" is supported by composition:
     releaseForRetire / idle-release abort child → session-stop grace → THEN jxy hook; release RPC / slot
     accounting can finish independently of hook inFlight, while exit waits on hooks via budget/inFlight.
"""
)

OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {OUT} bytes={OUT.stat().st_size}")

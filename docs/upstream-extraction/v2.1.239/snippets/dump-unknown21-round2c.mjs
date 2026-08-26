import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 8) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}
function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}
const needles = [
  "The following skills were invoked EARLIER",
  "Do NOT re-execute these skills",
  "## User Request",
  "NOT a new request",
  "async function gSm",
  "function gSm",
  "bridge_session_patch",
  "titleDedup",
  "lastTitlePatch",
  "titlePatchAt",
  "rateLimitTitle",
  "session-title",
  "title updates",
  "deduplicat",
  "MODAL_TRANSCRIPT_PEEK",
  "transcript peek",
  "FULLSCREEN_BOTTOM",
  "slash-command panels",
  "pinned above the panel",
  "bottom={0}",
  "function _bl",
  "vimMode:\"INSERT\"",
  "vimMode:\"NORMAL\"",
  "keeps your text",
  "instead of clearing",
  "clearing the prompt",
  "resume in the current directory",
  "deleted directory",
  "cd into",
  "worktree-gone",
  "existsSync(",
  "cwdGone",
  "organization policy check",
  "policy_violation",
  "organization_policy",
  "do not retry",
  "shouldRetry:!1,error",
  "US-only inference",
  "us only inference",
  "dataResidency",
  "inference_geo",
  "costEstimate",
  "1.1 *",
  "* 1.1",
  "1.1,",
  "literal `",
  "/insights",
  "empty tag",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    const back = n.includes("gSm") || n.includes("EARLIER") || n.includes("Do NOT") ? 40 : 80;
    const fwd = n.includes("gSm") || n.includes("EARLIER") || n.includes("Do NOT") ? 1800 : 500;
    lines.push(`--- ${i} ---`);
    lines.push(around(i, back, fwd));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown21-round2c.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

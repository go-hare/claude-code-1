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
  "function Lhp",
  "function eEv",
  "function axe",
  "M4r",
  "freshInstallCached",
  "firstStartVersion",
  "Yes, try it",
  "Not now",
  "could never",
  "unable to answer",
  "previously excluded",
  "providerAgnostic",
  "isSSH()",
  "CLAUDE_CODE_USE_BEDROCK",
  "foundry",
  "US_ONLY",
  "us_only",
  "only-inference",
  "data_residency",
  "skipped_data_residency",
  "costMultiplier",
  "priceMultiplier",
  "budgetUsd",
  "max-budget-usd",
  "function parseMultipleKeypresses",
  "incomplete:",
  "pendingMouse",
  "sgrPartial",
  "orphanSgr",
  "function kTd",
  "function ZXc",
  "35;",
  "echoing",
  "literal `",
  "</",
  "stripXml",
  "stripEmpty",
  "empty tags",
  "function dme()",
  "project root or home",
  "getOriginalCwd",
  "posix_spawn ENOENT",
  "rate-limit",
  "title updates",
  "session-title",
  "dedup",
  "organization_policy",
  "policy_violation",
  "shouldRetry:!1",
  "PreToolUse",
  "original turn",
  "traceId",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.slice(0, 8).join(",")}] count=${hs.length}${hs.length === 8 ? "+" : ""}`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 160, 400));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

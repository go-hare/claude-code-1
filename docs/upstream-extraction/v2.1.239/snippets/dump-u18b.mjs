import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 6) {
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
  "commitUserThemes",
  "cachedUserThemes",
  "function ZGn",
  "loadCustomThemes",
  "getThemesDir",
  "effortUltra",
  "CLAUDE_CODE_PROPAGATE_TRACEPARENT",
  "propagateTraceparent",
  "original turn",
  "startActiveSpan",
  "deduplicateDiagnosticFiles",
  "function DHm",
  "function G1w",
  "a message to yourself",
  "buildInsightsResponsePrompt",
  "The user just ran /insights",
  "stripHtml",
  "<empty>",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  const big =
    n.includes("ZGn") ||
    n.includes("DHm") ||
    n.includes("G1w") ||
    n.includes("commitUser") ||
    n.includes("insights") ||
    n.includes("TRACEPARENT") ||
    n.includes("deduplicate");
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, big ? 100 : 60, big ? 1600 : 500));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

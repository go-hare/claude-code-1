import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 10) {
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
  "CLAUDE_ENV_FILE",
  "processQueueIfReady",
  "user-cancel",
  "currentWorkAbortController",
  "viewing-agent",
  "isVimEditing",
  "switchToNormalMode",
  "eir",
  "function e1t(",
  "function t1t(",
  "shouldRetry",
  "policy_violation",
  "org_policy",
  "organization's policy",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  if (hs.length === 0) continue;
  const big = n === "CLAUDE_ENV_FILE" || n === "function e1t(" || n === "function t1t(";
  const win = big ? [300, 2200] : [160, 600];
  for (const i of hs.slice(0, n === "CLAUDE_ENV_FILE" ? 2 : 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, win[0], win[1]));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10i.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

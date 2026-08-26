import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 16) {
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
  'iN="synced"',
  "iN='synced'",
  'iN="claude.ai"',
  "var iN=",
  ",iN=",
  "iN=",
  "synced-plugin-shadowed",
  "claude.ai-synced",
  "claude.ai copy",
  "To use the claude.ai copy",
  "function G$",
  "function zD",
  "function f3a",
  "function k9a",
  "getSyncedPluginDirs",
  "replaceSyncedPluginDirs",
  "syncedPluginDirs()",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 16).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") || n === "iN=" ? 80 : 400;
  const after = n.startsWith("function ") ? 2500 : 1400;
  for (const i of hs.slice(0, n === "iN=" ? 8 : 2)) {
    // skip tiny/noise
    const slice = around(i, 60, 80);
    if (n === "iN=" && !/synced|claude|plugin|marketplace/i.test(slice) && hs.length > 8) {
      continue;
    }
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

// Targeted: plugin module around R9a / iN usage
for (const i of [308185390, 308192463, 308107480, 307756966]) {
  lines.push(`#### OFFSET ${i}`);
  lines.push(around(i, 800, 2200));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-iN.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

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
  "function _ts",
  "_ts()",
  "_ts({",
  "title_write_coalesced",
  "function x_r",
  "async function x_r",
  "x_r=",
  "title write retry",
  "noteRemoteTitle",
  "onRemoteTitleAdopted",
  "userInitiated",
  "shouldSend",
  ".update(",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  const big = n.includes("_ts") || n.includes("x_r") || n.includes("noteRemote") || n.includes("coalesced");
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, big ? 120 : 60, big ? 900 : 350));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-title-wire.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

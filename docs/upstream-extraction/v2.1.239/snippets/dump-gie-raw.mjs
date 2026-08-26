import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 12) {
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

const lines = [];

function section(title, i, b, a) {
  lines.push(`#### ${title} @ ${i}`);
  lines.push(around(i, b, a));
}

for (const n of [
  "function YHp",
  "function YHp(",
  "<${IXe}",
  "`<${IXe}>",
  "IXe}>",
  "rather than a summary",
  "_tm(",
  "function _tm",
  "GIe(",
  "webFetchReadmissionAllowed",
  "function dpw",
  "function snt",
  "function kgr",
  "function QQe",
  "function Cgr",
  "tF.isEnabled",
  "raw page as markdown inside",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const wide = n === "function YHp" || n === "function YHp(" || n === "<${IXe}" || n === "GIe(";
  for (const i of hs.slice(0, wide ? 4 : 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, wide ? 200 : 120, wide ? 3500 : 1800));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-gie-raw.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

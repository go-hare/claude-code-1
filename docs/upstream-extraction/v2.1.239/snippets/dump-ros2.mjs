import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, from = 0, until = buf.length, max = 30) {
  const n = Buffer.from(needle);
  const out = [];
  let i = from;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0 || j >= until) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

function around(i, before, after) {
  return ascii(
    buf
      .subarray(Math.max(0, i - before), Math.min(buf.length, i + after))
      .toString("latin1"),
  );
}

const lines = [];

for (const n of [
  "ros.Provider",
  "useContext(ros)",
  "createContext(!1)",
  "createContext(false)",
  "function jcs(",
  "function HN(",
  "function AU(",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 4)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 150, 250));
  }
}

// Scan ros= in a wide JS region; keep only identifier-ish assignments
lines.push("\n==== ros= scan 300000000-322000000 ====\n");
{
  const from = 300000000;
  const until = 322000000;
  const region = buf.subarray(from, until);
  let i = 0;
  let kept = 0;
  while (kept < 40) {
    const j = region.indexOf("ros=", i);
    if (j < 0) break;
    const abs = from + j;
    const prev = String.fromCharCode(region[j - 1] ?? 32);
    const next = region.slice(j, j + 60).toString("latin1");
    if (/^[;,{(\s]/.test(prev) && /^ros=[A-Za-z_$]/.test(next)) {
      lines.push(`--- ${abs} prev=${JSON.stringify(prev)} ---`);
      lines.push(around(abs, 80, 120));
      kept++;
    }
    i = j + 1;
  }
  lines.push(`kept=${kept}`);
}

// var ros / ,ros, / ros;
lines.push("\n==== var-ish ros ====\n");
for (const n of ["var ros,", "var ros;", ",ros,", ",ros=", " ros=", "\nros="]) {
  const hs = hits(n, 300000000, 322000000, 10);
  lines.push(`"${JSON.stringify(n)}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) lines.push(around(i, 60, 80));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-ros2.txt",
  lines.join("\n"),
);
console.log("ok");

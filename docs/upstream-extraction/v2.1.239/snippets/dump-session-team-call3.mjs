import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const lines = [
  "#### 326653275 if(xd())",
  around(326653275, 800, 2500),
  "",
  "#### 316502936 teammateColors assign",
  around(316502936, 200, 800),
];

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-session-team-call3.txt",
  lines.join("\n"),
);
console.log("ok");

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
const offs = [
  309725800, // JetBrains ABS skip + getNewDiagnostics
  313579650, // SendMessage self
  313667800, // No agent named
  313694600, // no agent named 2
];
const lines = [];
for (const i of offs) {
  lines.push(`==== ${i} ====`);
  lines.push(around(i, 200, 3500));
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18f.txt",
  lines.join("\n"),
);
console.log("ok");

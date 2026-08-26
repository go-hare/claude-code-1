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

const lines = [];
// Official FleetView dispatchInput sites
for (const i of [326083389, 326127426, 326155910, 326157252, 307280526, 307284514]) {
  lines.push(`==== dispatchInput ${i} ====`);
  lines.push(around(i, 400, 1800));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk8c.txt",
  lines.join("\n"),
);
console.log("ok");

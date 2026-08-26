import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hit(n) {
  return buf.indexOf(Buffer.from(n));
}

const needles = [
  "Hya=",
  "hKb=",
  "q2r=",
  "/code/artifact/",
  "function mFn(",
];

const lines = [];
for (const n of needles) {
  const i = hit(n);
  lines.push(`#### ${n} ${i}`);
  if (i >= 0) {
    lines.push(
      ascii(
        buf
          .subarray(Math.max(0, i - 120), Math.min(buf.length, i + 800))
          .toString("latin1"),
      ),
    );
  }
}

// Skill Lto at 312554500
const i = 312554400;
lines.push("#### skill-lto");
lines.push(ascii(buf.subarray(i, i + 2500).toString("latin1")));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-hya.txt",
  lines.join("\n"),
);
console.log("ok");

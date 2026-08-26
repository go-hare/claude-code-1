import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const slices = [
  ["schema-assign", 313675400, 4500],
  ["bem-table", 313636200, 2500],
  ["validate-head", 313684800, 1200],
  ["krw-mid", 313675900, 2000],
];

const lines = [];
for (const [name, start, len] of slices) {
  lines.push(`#### ${name} @${start}+${len}`);
  lines.push(ascii(buf.subarray(start, start + len).toString("latin1")));
}

function hits(needle) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < 8) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

for (const n of [
  "T0m=ve(",
  "XRw=ve(",
  "A0m=ve(",
  "YRw=ve(",
  "T0m=E0m",
  "XRw=E0m",
  "get inputSchema(){return FTl",
  "summary is required",
  "first line of a plain-text",
  "Broadcast to all teammates",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(
      ascii(
        buf.subarray(Math.max(0, i - 80), Math.min(buf.length, i + 1600)).toString("latin1"),
      ),
    );
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-sendmsg-schema2.txt",
  lines.join("\n"),
);
console.log("ok");

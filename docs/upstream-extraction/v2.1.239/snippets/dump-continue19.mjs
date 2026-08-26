import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, from = 0, until = buf.length, max = 12) {
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
const needles = [
  "Tqt=",
  "let Tqt",
  "const Tqt",
  "Tqt=mbo.useContext",
  "Tqt=VTt.useContext",
  "useContext(ros)",
  "var ros=",
  "ros=mbo.createContext",
  "var hbo=",
  "hbo=mbo.createContext",
  "createContext(null)",
  "Path hidden (unsupported characters)",
  "us-only-inference",
  "US-only inference",
  "1.1x",
  "35;150;7M",
  "mouse report",
  "stripBom",
  "\\uFEFF",
  "effortBadge",
  "badgeColor",
  "You are sending to yourself",
  "DHm()",
  "queued prompt",
  "literal tag",
  "three launches",
  "gained focus",
  "MODAL_TRANSCRIPT_PEEK",
];

for (const n of needles) {
  const hs = hits(n, 0, buf.length, 8);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 3)) {
    lines.push(around(i, 120, 220));
    lines.push("---");
  }
}

// Tqt= in AssistantToolUse neighborhood (~320180000-320210000)
lines.push("\n==== Tqt= in 320170000-320210000 ====\n");
for (const i of hits("Tqt=", 320170000, 320210000, 20)) {
  lines.push(`--- ${i} ---`);
  lines.push(around(i, 80, 80));
}

// hbo assignment neighborhood
lines.push("\n==== hbo= ====\n");
for (const i of hits("hbo=", 307000000, 322000000, 15)) {
  const s = around(i, 40, 80);
  if (s.includes("hbo=") && (s.includes("createContext") || s.includes("Provider") || s.includes("=A("))) {
    lines.push(`--- ${i} ---`);
    lines.push(s);
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-continue19.txt",
  lines.join("\n"),
);
console.log("wrote", lines.length);

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
const needles = [
  "consumeWindowActivationLatch",
  "pressIsWindowActivation",
  "windowActivationLatch",
  "yvf=",
  "yvf=",
  ",yvf=",
  "var yvf=",
  "yvf=",
  '==="stray"',
  '==="unhandled"',
  "onClickAt(",
  "isWindowActivation",
  "pendingHyperlinkOpensInPanel",
  "macCmdClickArrivesWithoutSgrModifierBit",
  "function Jhf(",
  "terminalFocusGainedAt",
  "OKa(",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const wide =
    n.includes("WindowActivation") ||
    n.includes("stray") ||
    n.includes("unhandled") ||
    n.includes("onClickAt") ||
    n.includes("yvf") ||
    n.includes("Jhf") ||
    n.includes("OKa") ||
    n.includes("Hyperlink") ||
    n.includes("macCmd");
  for (const i of hs.slice(0, n.includes("yvf") ? 6 : 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, wide ? 200 : 80, wide ? 2200 : 500));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u33.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

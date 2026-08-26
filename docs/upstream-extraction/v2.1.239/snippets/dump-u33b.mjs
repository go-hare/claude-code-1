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
  "dropAsStray",
  "droppedAsStray",
  "allowDefault",
  "defaultAllowed",
  'return"stray"',
  'return"unhandled"',
  'return"handled"',
  '==="stray"',
  "isWindowActivation",
  "hyperlinkUrl",
  "function lX",
  "dispatchClick",
  "windowActivationClickArmed",
  "lastActivationInputTime",
  "cd ${",
  "isSameRepoWorktree",
  "showAllProjects",
  "projectPath no longer",
  "resume in the current",
  "directory no longer exists",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  if (hs.length === 0) continue;
  const wide =
    n.includes("stray") ||
    n.includes("unhandled") ||
    n.includes("Window") ||
    n.includes("dispatch") ||
    n.includes("hyperlink") ||
    n.includes("lX") ||
    n.includes("project") ||
    n.includes("resume") ||
    n.includes("directory") ||
    n.includes("cd") ||
    n.includes("Armed") ||
    n.includes("Activation");
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 150, wide ? 2400 : 600));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u33b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

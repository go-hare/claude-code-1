import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 6) {
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
  // #10 jetbrains edit/write stall
  "JetBrains IDE",
  "jetbrains plugin is connected",
  "isJetBrainsIde",
  "CLAUDE_CODE_PLUGIN",
  "ideSelection",
  "ide_connected",
  "FileEditTool",
  "notifyOnFileChange",
  "diagnosticFiles",
  "deduplicateDiagnostic",
  // #11 esc queued
  "queuedCommands",
  "cancelRequest",
  "abortController",
  "escapeQueued",
  "prompt was queued",
  "hasQueued",
  // #19 resume deleted
  "cd into",
  "crossProject",
  "allProjects",
  "projectPath",
  "session.project",
  "cwdExists",
  "ENOENT",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 6).join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 700));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18a.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

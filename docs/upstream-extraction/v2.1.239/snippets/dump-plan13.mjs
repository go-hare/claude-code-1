import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 20) {
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
  "function Jqy",
  "function y_u",
  "function XWy",
  "function QnT",
  "function eoT",
  "function g_u",
  "function YWy",
  "function h_u",
  "function __u",
  "function EaT",
  "function Lx(",
  "function oHe",
  "qqe.isEnabled",
  "KS(n.toolPermissionContext,qqe)",
  "planModeOnResume:",
  "planModeOnResume=",
  "y_u(",
  "XWy(",
  "__u(",
  "workerPermissionModeRecordEnabled",
  "isWorkerPermissionModeRecordEnabled",
  "onInternalMetadataChanged",
  "notifyInternalMetadataChanged",
  "tengu_tranquil_fern",
  "function H8(",
  "recordedMode",
  "trustedMode",
  "source:\"internal\"",
  "source:\"none\"",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 16).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 40 : 500;
  const after = n.startsWith("function ") ? 3500 : 1800;
  for (const i of hs.slice(0, 4)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-plan13.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

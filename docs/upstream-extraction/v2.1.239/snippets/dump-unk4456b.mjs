import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 16) {
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
  "function syncedPluginMintedName",
  "syncedPluginMintedName",
  "replaceSyncedPluginDirs",
  "syncedPluginDirs",
  "mintedName",
  "api_request_dlp_denied",
  "function __t",
  "dlp_denied",
  "policy webhook",
  "function vIT",
  "engine_error",
  "decision_shape",
  "skipRetry",
  "yUy=",
  "gUy=",
  "G1s=",
  "noProxy:_?",
  "MINIMAL_EGRESS_DOMAINS",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 16).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 40 : 400;
  const after = n.startsWith("function ") ? 2800 : 1800;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

const offsets = [
  328285489, // policy check JS
  328284000, // a bit earlier
  303509832,
  315353342,
  308117871,
  300687676,
  326587000, // agent proxy init
  326596774, // organization policy #3
];

for (const i of offsets) {
  lines.push(`#### OFFSET ${i}`);
  lines.push(around(i, 1200, 3500));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk4456b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

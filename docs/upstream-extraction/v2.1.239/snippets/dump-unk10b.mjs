import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dump(off, before, after) {
  return `--- ${off} ---\n${ascii(
    buf.subarray(
      Math.max(0, off - before),
      Math.min(buf.length, off + after),
    ).toString("latin1"),
  )}`;
}

const offs = [
  // #29 vim
  322788012, 312192647, 312192667, 312193030,
  // #28 otel
  303035604, 303035861, 303036061, 303036512, 303036571, 315444241,
  100861544, 100861576,
  // #11 cancel/queue
  320307255, 320307668, 312572172, 312574984, 312589497,
  306595940, 306602631,
  // #37 dme / original cwd
  304295819, 304297505, 300700591, 313226890, 313432026,
  // #44 org_policy
  303661667, 304195444, 305437660, 328285489, 328286165,
  // #15 mcp 5xx
  303225743, 177557664, 316278607,
  // #47 keepalive
  310380750, 317574778, 317575692, 139785712,
  // #55 image
  301386916, 301387355, 312998183,
  // #56 proxy
  326594530, 200179023, 311916385, 301774905,
  // #13 worker/plan
  301604555, 303396833, 109278862,
];

const lines = offs.map(o => dump(o, 200, 700));
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10b.txt",
  lines.join("\n\n"),
);
console.log("ok", lines.length);

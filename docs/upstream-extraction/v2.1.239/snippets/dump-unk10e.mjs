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
  // hook_exec
  137467680, 165295408, 309955263, 317109586, 317109735, 317109846,
  317109995, 317147007,
  // $Qn
  310628306, 310628914, 310629032, 310633934,
  // BQn near activity
  310637820, 310637830,
  // session_start_hook
  208358489, 328598899,
  // setup_hook
  318141690, 171198848,
  // session_activity
  310382239,
];

const lines = offs.map(o => dump(o, 250, 800));
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10e.txt",
  lines.join("\n\n"),
);
console.log("ok", lines.length);

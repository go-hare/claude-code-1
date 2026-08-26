import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
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

const lines = [];
for (const i of [317132007, 321426484, 304325980]) {
  lines.push(`==== offset ${i} ====`);
  lines.push(around(i, 800, 2500));
}

for (const n of [
  "cwd:",
  "existsSync",
  "homedir()",
  "getProjectRoot",
  "tQe.with",
  "function znm(",
  "$E=",
  "isVimEditing:",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10j.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

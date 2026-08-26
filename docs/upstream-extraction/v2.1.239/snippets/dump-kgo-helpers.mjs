import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function dump(needle, out, len) {
  const i = buf.indexOf(Buffer.from(needle));
  if (i < 0) {
    writeFileSync(out, `MISSING ${needle}\n`);
    console.log("missing", needle);
    return;
  }
  const chunk = ascii(
    buf.subarray(i, Math.min(buf.length, i + len)).toString("latin1"),
  );
  writeFileSync(out, chunk);
  console.log("ok", needle, i, chunk.length);
}

const base = "docs/upstream-extraction/v2.1.239/snippets/";
dump("async function TY_(", base + "gold-TY.txt", 1800);
dump("async function kY_(", base + "gold-kY.txt", 1800);
dump("function B4e(", base + "gold-B4e.txt", 800);
dump("function Jer(", base + "gold-Jer.txt", 800);
dump("async function i5u(", base + "gold-i5u.txt", 600);
dump("function s5u(", base + "gold-s5u.txt", 600);
dump("async function CY_(", base + "gold-CY.txt", 500);
dump("function VZs(", base + "gold-VZs.txt", 400);
dump("async function a5u(", base + "gold-a5u.txt", 500);

// Throwaway: does the 2.1.238 SEA carry plain minified JS, or only a bytecode
// constant pool? Count occurrences of source-only token sequences.
import { readFileSync } from "node:fs";

const buf = readFileSync(process.env.TEMP + "\\official-238\\package\\claude.exe");

function count(s) {
  const nb = Buffer.from(s);
  let n = 0;
  for (let p = buf.indexOf(nb); p >= 0; p = buf.indexOf(nb, p + 1)) n++;
  return n;
}

for (const s of process.argv.slice(2)) {
  console.log(String(count(s)).padStart(8), JSON.stringify(s));
}

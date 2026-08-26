// Throwaway: print every byte offset of each needle in the 2.1.238 SEA.
import { readFileSync } from "node:fs";
const buf = readFileSync(process.env.TEMP + "\\official-238\\package\\claude.exe");
for (const s of process.argv.slice(2)) {
  const nb = Buffer.from(s);
  const at = [];
  for (let p = buf.indexOf(nb); p >= 0; p = buf.indexOf(nb, p + 1)) at.push(p);
  console.log(JSON.stringify(s), at.length, at.slice(0, 40).join(" "));
}

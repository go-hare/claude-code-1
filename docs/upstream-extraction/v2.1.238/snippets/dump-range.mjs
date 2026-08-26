// Throwaway: dump an absolute byte range of the 2.1.238 SEA as scrubbed ascii.
// Usage: node dump-range.mjs <name> <start> <end>
import { readFileSync, writeFileSync } from "node:fs";
const buf = readFileSync(process.env.TEMP + "\\official-238\\package\\claude.exe");
const [name, s, e] = process.argv.slice(2);
const out = buf
  .subarray(Number(s), Number(e))
  .toString("latin1")
  .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
writeFileSync(`docs/upstream-extraction/v2.1.238/snippets/gold-${name}.txt`, out);
console.log("OK", name, Number(e) - Number(s), "bytes");

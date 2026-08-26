import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
const hits = [];
const needle = Buffer.from("yt=at-je,xt=ib.useMemo");
let from = 0;
while (true) {
  const i = buf.indexOf(needle, from);
  if (i < 0) break;
  hits.push(i);
  from = i + 1;
}
const chunks = hits.map((i) => {
  const start = Math.max(0, i - 2500);
  const end = Math.min(buf.length, i + 800);
  return `#### ${i}\n` + buf.subarray(start, end).toString("latin1");
});
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-elicit-clamp.txt",
  `hits ${hits.join(",")}\n\n` + chunks.join("\n\n"),
);
console.log("hits", hits);

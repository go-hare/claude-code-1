import { readFileSync } from "node:fs";
const s = readFileSync(
  process.env.TEMP + "\\official-239\\package\\claude.exe",
).toString("latin1");
for (const n of ['dL="', "dL=`", ",dL=", ";dL="]) {
  let i = 0;
  const hits = [];
  while (true) {
    const j = s.indexOf(n, i);
    if (j < 0) break;
    hits.push(j + "::" + s.slice(j, j + 70).replace(/[^\x20-\x7e]/g, "."));
    i = j + 1;
    if (hits.length > 10) break;
  }
  console.log(JSON.stringify(n), hits.length, hits.join(" | "));
}

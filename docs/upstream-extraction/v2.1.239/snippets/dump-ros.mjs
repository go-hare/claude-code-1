import { readFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

const needles = ["ros=mbo.createContext", "ros=VTt.createContext", "var ros", "ros=createContext", "function ros("];
for (const n of needles) {
  const i = buf.indexOf(Buffer.from(n));
  console.log(n, i);
  if (i >= 0) console.log(ascii(buf.subarray(i, i + 200).toString("latin1")));
}

// nearby module init after FilePathLink / AssistantToolUse
const i = buf.indexOf(Buffer.from("Tqt=VTt.useContext(ros)"));
console.log("useContext", i);
console.log(ascii(buf.subarray(i - 100, i + 80).toString("latin1")));

// search ros= in 319000000-321000000
const region = buf.subarray(319500000, 321000000);
let from = 0;
let c = 0;
while (c < 8) {
  const j = region.indexOf("ros=", from);
  if (j < 0) break;
  const s = region.slice(j, j + 80).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
  if (!s.startsWith("ros=")) { from = j + 1; continue; }
  console.log("ros=", 319500000 + j, s);
  from = j + 1;
  c++;
}

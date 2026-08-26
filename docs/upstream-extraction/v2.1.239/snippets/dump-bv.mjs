import { readFileSync } from "node:fs";

const buf = readFileSync(`${process.env.TEMP}\\official-239\\package\\claude.exe`);

function around(n, a = 80) {
  const i = buf.indexOf(Buffer.from(n));
  console.log(n, i);
  if (i >= 0) console.log(buf.subarray(i, i + a).toString("latin1"));
}

around("ARTIFACT_TOOL_NAME:()=>bv");
around("var bv=");
around("bv=\"artifact\"");
around("bv=\"Artifact\"");
around("bv='artifact'");

// search nearby FWe init
const i = buf.indexOf(Buffer.from("getArtifactPublishStubDir:()=>S$"));
console.log("FWe", i);
if (i >= 0) {
  const s = buf.subarray(i - 400, i + 200).toString("latin1");
  console.log(s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "."));
}

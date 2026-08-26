import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

const needle = Buffer.from(
  "extractAttachments:c?void 0:n4t,replaceCommandRules:!0,replaceDenyRules:!c,deferInvocationRecording:y",
);
const i = buf.indexOf(needle);
if (i < 0) {
  console.log("not found");
  process.exit(1);
}

const sl = buf.subarray(i - 2500, i + 200);
let s = "";
for (const c of sl) s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";

writeFileSync(new URL("./gold-slash-y.txt", import.meta.url), s, "utf8");
console.log("wrote", s.length, "at", i);

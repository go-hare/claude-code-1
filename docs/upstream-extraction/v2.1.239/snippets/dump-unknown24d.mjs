import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 8) {
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
function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}
const lines = [];

// Full Vs + neighbors
lines.push("==== Vs full ====");
lines.push(around(304985847, 20, 2200));

lines.push("\n==== tEv / D4r / udc / Qng / jfn ====");
for (const n of [
  "function tEv",
  "function D4r",
  "function udc",
  "function Qng",
  "function jfn",
  "function Zng",
  "function Nhp",
  "tengu_pewter_brook",
  "tengu_ochre_hollow",
  "upsellImpression",
  "firstStartVersion:",
]) {
  const hs = hits(n);
  lines.push(`\n#### ${n} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) lines.push(around(i, 60, 700));
}

// dark-ansi theme object around 306386140 / 306388909
lines.push("\n==== dark-ansi theme 306386140 ====");
lines.push(around(306386140, 80, 2500));
lines.push("\n==== effortUltra 306388909 ====");
lines.push(around(306388909, 400, 800));

// insights empty tags — HTML-like that markdown ate
lines.push("\n==== insights tags ====");
for (const n of [
  "<empty>",
  "</empty>",
  "<none>",
  "<null>",
  "replaceAll(\"<",
  ".replace(/<",
  "insights echoing",
  "stripEmptyTags",
  "emptyTag",
  "<user>",
  "<unused>",
]) {
  const hs = hits(n, 4);
  lines.push(`${n} count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 250));
}

// #1 cost 1.1
lines.push("\n==== cost 1.1 ====");
for (const n of [
  "*1.1",
  "1.1*",
  "US_ONLY_INFERENCE",
  "usOnlyInferencePremium",
  "inferenceLocation",
  "dataResidency",
  "1.1,",
  "=1.1",
  "1.10",
]) {
  const hs = hits(n, 4);
  lines.push(`${n} count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 200));
}

// #26 mouse incomplete across writes
lines.push("\n==== mouse incomplete ====");
for (const n of [
  "function parseMouseEvent",
  "incompleteCsi",
  "pendingSgrMouse",
  "sgrMouseBuf",
  "[<\\d",
  "35;150",
  "split across",
]) {
  const hs = hits(n, 3);
  lines.push(`${n} count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 400));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24d.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

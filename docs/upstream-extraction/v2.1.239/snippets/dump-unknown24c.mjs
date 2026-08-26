import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);
function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}
function hits(needle, max = 12) {
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
function dumpFn(name, before = 40, after = 900) {
  const hs = hits(`function ${name}(`);
  const lines = [`#### function ${name}( [${hs.join(",")}]`];
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
  return lines;
}
const lines = [];
lines.push(...dumpFn("Lhp", 20, 400));
lines.push(...dumpFn("eEv", 20, 250));
lines.push(...dumpFn("Vs", 20, 800));
lines.push(...dumpFn("Kxa", 20, 200));
lines.push(...dumpFn("X3e", 20, 400));
lines.push(...dumpFn("Vfs", 20, 400));
lines.push(...dumpFn("jli", 20, 400));

for (const n of [
  "M4r=",
  "var M4r",
  "M4r=",
  "fullscreenUpsellSeenCount??0)<M4r",
  "fullscreenUpsellSeenCount??0)+",
  "fullscreenUpsellSeenCount+1",
  "fullscreenUpsellSeenCount:",
  "firstStartVersion!==void 0",
  "freshInstallCached",
  "bedrock",
  "Vertex",
  "Foundry",
  "previously excluded",
  "cloud provider",
  "third-party provider",
]) {
  const hs = hits(n, 6);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 350));
  }
}

// dark-ansi theme object
for (const n of [
  '"dark-ansi"',
  "dark-ansi",
  "bashMessageBackgroundColor",
  "userMessageBackground",
  "clawd_background",
]) {
  const hs = hits(n, 8);
  lines.push(`#### theme "${n}" [${hs.slice(0, 6).join(",")}]`);
  for (const i of hs.slice(0, 1)) {
    lines.push(around(i, 40, 1200));
  }
}

// insights empty tags
for (const n of [
  "insights",
  "at_a_glance",
  "<>",
  "<tag>",
  "empty XML",
  "stripTags",
  "literal tags",
  "echoing literal",
]) {
  const hs = hits(n, 4);
  lines.push(`#### ins "${n}" count=${hs.length}`);
  if (hs.length) lines.push(around(hs[0], 80, 300));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unknown24c.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

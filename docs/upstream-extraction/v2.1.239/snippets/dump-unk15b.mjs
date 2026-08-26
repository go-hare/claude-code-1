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

const needles = [
  "function d9p",
  "function JQn",
  "function tFS",
  "function e2S",
  "setupSdkMcpClients",
  "function ZMf",
  "sourcePath??",
  "function cnl",
  "parseIncludeHosts",
  "includeHosts",
  "JSON.parse(process.env.CCR_AGENT_PROXY_INCLUDE_HOSTS",
  "CCR_AGENT_PROXY_INCLUDE_HOSTS",
  "www.anthropic.com,docs.anthropic.com",
  "docs.anthropic.com,www",
  "api.anthropic.com",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 40 : 400;
  const after = n.startsWith("function ") ? 2800 : 1800;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

// Targeted offsets from prior dump
for (const i of [327066782, 327071572, 327071714, 320450349, 326901626, 326911553]) {
  lines.push(`#### OFFSET ${i}`);
  lines.push(around(i, 800, 2200));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk15b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

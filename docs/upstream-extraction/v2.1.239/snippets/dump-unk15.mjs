import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 16) {
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
  // #15
  "hasPendingSdk",
  "setupSdkMcp",
  "setServers(",
  "async setServers",
  'type==="pending"',
  "c.type===\"failed\"",
  ".type===\"failed\")",
  "stays failed forever",
  "handshake timeout on",
  "WS reconnect race",
  "haveServersChanged",
  "connectedServerNames",
  "function ZMf",
  "function eOf",
  "swrRefreshDialsInFlight",
  "mcp_reconnect_not_connected",
  "status>=500",

  // #44
  "isRemote&&(error.status===401",
  "status===401||error.status===403",
  "status===401||e.status===403",
  "status===403",
  "x-should-retry",
  "organization policy check",
  "policy check being",
  "re-sent before",
  "isRemote&&",
  "CLAUDE_CODE_REMOTE)&&",
  "function Cew",
  "function Rew",
  "policy_hit",

  // #55
  "sourcePath??",
  "sourcePath:",
  "storedImagePaths.get",
  "[Image source: ${",
  "OGr=",
  "createImageMetadataText",
  "pastedImage.sourcePath",

  // #56
  "CCR_AGENT_PROXY_INCLUDE_HOSTS",
  "include hosts; unlisted",
  "agent_proxy_selective",
  "RELAY_MODE=selective",
  "function c0T",
  "parseInclude",
  "includeHost",
  "www.anthropic.com",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 40 : 350;
  const after = n.startsWith("function ") ? 2200 : 1600;
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk15.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

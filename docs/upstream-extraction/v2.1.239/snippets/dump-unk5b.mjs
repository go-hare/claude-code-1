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
  // #13 full machine
  "[planModeResume]",
  "planModeOnResume",
  "restartedWorker",
  "enableWorkerPermissionModeRecord",
  "worker_permission_mode",
  "tengu_worker_permission_mode_restore",
  "function XWy",
  "function __u",
  "prior worker's record",
  "h_u()",
  "restoredWorkerState",

  // #15
  "hasFailedSdkClients",
  "type===\"failed\"",
  "c.type===\"failed\"",
  "handshake timeout",
  "stays failed",
  "need to be retried",
  "sdkClients.some",
  "mcp_set_servers",
  "setMcpServers:",
  "HTTP 5",
  "status===500",
  "status===502",
  "status===503",

  // #44
  "do not retry organization",
  "organization policy denials",
  "policy denials",
  "function shouldRetry",
  "x-should-retry",
  "isRemote&&(error.status===401",
  "error.status===403",
  "policy_hit",
  "wn_=",
  "blocked by your organization's policy",
  "before the rejection was shown",
  "rejection was shown",

  // #55
  "Image source:",
  "sourcePath",
  "saved file",
  "inlined_image_paths",
  "mobile now include",
  "[Image #",
  "storedImagePaths",
  "uploaded from",

  // #56
  "function c0T",
  "isAnthropicHost",
  "CCR_AGENT_PROXY_INCLUDE_HOSTS",
  "ANTHROPIC_API_HOST",
  "docs.anthropic.com",
  "www.anthropic.com",
  "non-API",
  "allowed domains apply",
  "INCLUDE_HOSTS",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 12).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 80 : 400;
  const after = n.startsWith("function ") ? 2500 : 1400;
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk5b.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

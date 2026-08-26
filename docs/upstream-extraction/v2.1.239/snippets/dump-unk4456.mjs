import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 20) {
  const n = typeof needle === "string" ? Buffer.from(needle) : needle;
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

function utf16le(s) {
  return Buffer.from(s, "utf16le");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

const needles = [
  // #44 policy reject / no-resend
  "organization policy check",
  "organization policy",
  "org policy",
  "policy check",
  "rejected by an organization",
  "re-sent before",
  "resent before",
  "before the rejection",
  "policy_violation",
  "policy-violation",
  "organization_policy",
  "org_policy",
  "POLICY_BLOCKED",
  "policy_hit",
  "policy_blocked",
  "blocked_by_policy",
  "blocked by your organization",
  "blocked by organization",
  "violates your organization",
  "violates organization",
  "content_policy",
  "output_blocked",
  "request_blocked",
  "isPolicyError",
  "isOrgPolicy",
  "orgPolicyReject",
  "organization_disabled",
  "permission_error",
  "x-should-retry",
  "x-should-retry",
  "shouldRetry===false",
  "shouldRetry=!1",
  "function Cew",
  "function Rew",
  "function tah",
  "function bew",
  "stop_reason",
  "refusal",
  "safety_violation",
  "safety_filter",
  "prompt_blocked",
  "input_blocked",
  "blocked_reason",
  "policy_reject",
  "policyReject",
  "do_not_retry",
  "doNotRetry",
  "no_retry",
  "skipRetry",
  "alreadyShown",
  "rejection shown",
  "shown_error",
  "pendingRejection",
  "errorAlready",
  "shownBeforeRetry",
  "retryAfterPolicy",
  "policy_check_failed",
  "policyLimits",
  "waitForPolicy",
  "policyLimitsReady",
  "allow_remote",

  // #56 proxy / hosts
  "function KFy",
  "function c0T",
  "function qJA",
  "function bNo",
  "function iZA",
  "isAnthropicHost",
  "non-API",
  "nonApi",
  "www.anthropic.com",
  "docs.anthropic.com",
  "console.anthropic.com",
  "support.claude.com",
  "claude.com",
  "INCLUDE_HOSTS",
  "include-host",
  "agent_proxy_selective",
  "selective relay",
  "tunnel-all",
  "FAIL-CLOSED",
  "function parseInclude",
  "CCR_AGENT_PROXY_RELAY_MODE",
  "AGENT_PROXY_URL",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "no_proxy",

  // #4 synced plugin
  "@synced",
  "name@synced",
  "plugin enable/disable",
  "@claude.ai",
  "scope===\"claudeai\"",
  'scope:"claudeai"',
  "from claude.ai",
  "synced from",
  "cloud-synced",
  "cloudSynced",
  "pluginSuffix",
  "@cloud",
  "same-named plugin",
  "never override",
  "override a same-named",
  "syncedPlugin",
  "plugin@synced",
  "enable @",
  "disable @",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 16).join(",")}]`);
  if (hs.length === 0) continue;
  const before = n.startsWith("function ") ? 40 : 280;
  const after = n.startsWith("function ") ? 3200 : 1400;
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, before, after));
  }
}

// UTF-16LE variants that JS minify wouldn't use but UI/host might
for (const n of ["@synced", "synced", "name@synced"]) {
  const hs = hits(utf16le(n), 8);
  lines.push(`#### UTF16 "${n}" count=${hs.length} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, 200));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk4456.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);

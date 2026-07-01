# Upstream extraction

- Binary: C:\Users\Administrator\AppData\Local\Temp\pkg-latest\package\claude.exe
- Size: 235564192 bytes
- Keywords: safe mode, safe-mode, --safe, enableSafeMode, safeMode:, safeModeEnabled
- Context bytes: 2048
- Hits total: 1

## Block 1 — keyword="safe mode" offset=232085305 (0xdd55739)

```
y\r
# \u2192 Uptime: 3h12m\r
# \u2192 Connections: 47\r
\r
/tmp/tool status --json\r
# \u2192 {"status":"healthy","uptime_seconds":11520,"connections":47}\r
\r
/tmp/tool status --json | jq -e .status\r
# \u2192 "healthy"\r
# (jq -e exits nonzero if the path is null/false \u2014 cheap validity check)\r
\r
echo $?\r
# \u2192 0\r
\`\`\`\r
\r
**Verdict:** PASS \u2014 flag works, JSON is valid, fields line up.\r
\r
## What FAIL looks like\r
\r
- \`unknown flag: --json\` \u2192 not wired up, or you're running a stale build\r
- Output isn't valid JSON (\`jq\` errors) \u2192 serialization bug\r
- \`tool status\` (no flag) changed \u2192 regression; the diff touched more\r
  than it should\r
- JSON has different field names than expected \u2192 claim/code mismatch,\r
  might be fine, note it\r
\r
## Reading from stdin, destructive commands\r
\r
If the CLI reads stdin \u2192 pipe in test data.\r
If it writes files / hits a network / deletes things \u2192 point it at a\r
tmp dir / a mock / a dry-run flag. If there's no safe mode and the\r
diff touches the destructive path, say so and verify what you can\r
around it.\r
`;var aY_=()=>{};var eY_=`# Verifying a server/API change\r
\r
The handle is \`curl\` (or equivalent). The evidence is the response.\r
\r
## Pattern\r
\r
1. Start the server (background, with a readiness poll \u2014 see below)\r
2. \`curl\` the route the diff touches, with inputs that hit the changed branch\r
3. Capture the full response (status + headers + body)\r
4. Compare to expected\r
\r
## Lifecycle\r
\r
If there's a run-skill it handles this. If not:\r
\r
\`\`\`bash\r
<start-command> &> /tmp/server.log &\r
SERVER_PID=$!\r
for i in {1..30}; do curl -sf localhost:PORT/health >/dev/null && break; sleep 1; done\r
# ... your curls ...\r
kill $SERVER_PID\r
\`\`\`\r
\r
No readiness endpoint? Poll the route you're about to test until it\r
stops returning connection-refused, then add a beat.\r
\r
## Worked example\r
\r
**Diff:** adds a \`Retry-After\` header to 429 responses in \`rateLimit.ts\`.\r
**Claim (PR bo
```


/**
 * densable 2.1.251 #48 — agent-proxy diagnosis prompt (An) + env note (xe).
 *
 * Gold SEA:
 *   An(port, caBundlePath) → full README markdown (bare reset + recentRelayFailures)
 *   xe(ca, readmePath?) → short env note pointing at status / README
 *   Ept/yBt → session note bag read by env info (BGt → computeEnvInfo)
 */

import { dirname, join } from 'path'

/** densable yBt / agentProxyNote — short line injected into <env>. */
let agentProxyNote: string | undefined

/**
 * densable Ept — set session agent-proxy note (path to README or short text).
 */
export function setAgentProxyNote(note: string | undefined): void {
  agentProxyNote = note
}

/**
 * densable yBt — read session agent-proxy note for env context.
 */
export function getAgentProxyNote(): string | undefined {
  return agentProxyNote
}

/** Test helper. */
export function resetAgentProxyNoteForTests(): void {
  agentProxyNote = undefined
}

/**
 * densable An(t, e) — full agent-proxy README body.
 * `t` = local proxy port; `e` = CA bundle path.
 * Includes the bare-reset / recentRelayFailures diagnosis (#48 contract).
 */
export function buildAgentProxyReadme(
  port: number,
  caBundlePath: string,
): string {
  const r = `http://127.0.0.1:${port}`
  const e = caBundlePath
  const o = dirname(caBundlePath)
  const t = port
  // Gold An template (U+2014 em dash where SEA had —).
  return `# Claude Code agent proxy

Outbound HTTPS from this session goes through a local proxy at ${r}
(set via HTTPS_PROXY) which tunnels to a policy-enforcing egress proxy. TLS is
re-terminated there, so every tool must trust the CA bundle at
${e}. The standard CA environment variables, the system trust
store (where possible), a JVM truststore, the Bazel system bazelrc, the
browser NSS store, and gsutil's boto config are already set up.

## Quick diagnosis

1. Run: curl -sS ${r}/__agentproxy/status
   It reports proxy state, which trust and git accommodations are active
   (javaTrustStorePath, toolTrustFailureCodes, gitSshRewrite,
   gitConfigConflicts), and the most recent proxy-side failures.
2. Find the failure class below and apply the matching fix; gitConfigConflicts
   codes map to the git section, toolTrustFailureCodes to the JVM section.
3. Never disable TLS verification, never unset HTTPS_PROXY, and do not retry
   organization policy denials (403/407) — report them instead.

## Failure classes and fixes

### "certificate verify failed" / "self-signed certificate in chain" / PKIX errors

The failing tool is not reading the pre-set CA configuration. In order:

- If the tool has a CA flag or env var, point it at ${e}
  (examples: --cacert, SSL_CERT_FILE, NODE_EXTRA_CA_CERTS, REQUESTS_CA_BUNDLE,
  AWS_CA_BUNDLE, DENO_CERT, CARGO_HTTP_CAINFO, PIP_CERT, GIT_SSL_CAINFO,
  BUNDLE_SSL_CA_CERT, HEX_CACERTS_PATH, NIX_SSL_CERT_FILE).
- Tool config files override environment variables. If one of these sets its
  own CA or disables verification, point it at the bundle instead:
  pip.conf "cert", npm "cafile" (npm config get cafile), ~/.curlrc "cacert",
  .wgetrc "ca_certificate", conda "ssl_verify", git "http.sslCAInfo",
  gradle.properties / MAVEN_OPTS "-Djavax.net.ssl.trustStore".
- JVM tools (Maven, Gradle, plain Java): when a JDK is present, a truststore
  is built at ${o}/java-truststore.p12 (password "changeit") and
  injected via JAVA_TOOL_OPTIONS — confirm javaTrustStorePath is set in the
  status output before pointing a build at it (toolTrustFailureCodes explains
  why it is missing). If the image or the build sets its own trustStore, that
  one wins — import the proxy CA into it with
  keytool -importcert -noprompt -alias ccr-agent-proxy -file ${o}/agent-proxy-ca.crt -keystore <their store>
  or point the build at the ready-made one. Bazel reads the managed block in
  /etc/bazel.bazelrc rather than JAVA_TOOL_OPTIONS.

### "405 Method Not Allowed" from the proxy

The tool sent a plain-HTTP (non-CONNECT) request: usually axios older than
1.16.1 (upgrade it) or a tool configured with HTTP_PROXY (unset HTTP_PROXY for
that tool — only HTTPS_PROXY is supported).

### 403 / 407 from the proxy

The destination host is not allowed by your organization's egress policy for
this session. Do not retry or route around it — report the blocked host.
Note: curl hides response bodies on failed CONNECTs; the status endpoint
records the reason.

### "connection reset" / "unexpected disconnect" / "RPC failed" mid-transfer

Once a tunnel is up the proxy cannot send an error response, so a connection
it aborts (tunnel to the egress proxy lost, or an upload the tunnel stopped
accepting) reaches the tool as a bare reset. recentRelayFailures in the status
output names the host and reason; check it before concluding the remote
service refused the operation.

### Tool ignores the proxy entirely (timeouts with no proxy error)

Some clients do not read HTTPS_PROXY: Node's built-in fetch (run that command
with NODE_USE_ENV_PROXY=1 on Node >= 22.21), aiohttp (pass trust_env=True),
Ruby bundler (reads only HTTP_PROXY, which this proxy does not serve),
hand-rolled Go dialers. Prefer the tool's own proxy option where one exists.

### git

SSH-form GitHub remotes (git@github.com:...) are rewritten to HTTPS
automatically unless this session has its own SSH setup or supplies its own
GIT_CONFIG_* (see gitSshRewrite in the status output). A gitconfig that sets
http.proxy / http.<url>.proxy (even empty), its own http.sslCAInfo, or an
https-to-ssh insteadOf makes git bypass the proxy or fail verification — the
status output's gitConfigConflicts codes name which of these were detected;
adjust those keys for this session if git times out.

### docker build / docker run

Processes inside containers cannot reach 127.0.0.1:${t} and do not trust
the CA. Workarounds: run builds with --network host, copy ${e}
into the build context and install it in an early layer, and pass proxy/CA
settings explicitly to the build.

### Not supported through the proxy (report, do not work around)

gRPC / HTTP/2-only APIs, WebSocket upgrades, client-mTLS, certificate-pinned
clients (e.g. Snowflake, ngrok), non-443 HTTPS ports, raw-TCP databases.

If a tool still cannot work through the proxy, report it to your
administrator or Anthropic support so the policy or tooling can be fixed.
`
}

/**
 * densable xe(t, e?) — short note for env / setNote.
 * Non-toolScoped path (CCR full proxy): points at status + optional README path.
 */
export function buildAgentProxyEnvNote(
  caBundlePath: string,
  readmePath?: string,
  opts?: {
    toolScoped?: boolean
    ghShimDir?: string
    installedProxyPreconfiguredClis?: string[]
  },
): string {
  const see = readmePath ? `see ${readmePath} and ` : ''
  if (opts?.toolScoped) {
    const gh = opts.ghShimDir ? ' and gh' : ''
    const shim = opts.ghShimDir ? ' and a gh PATH shim' : ''
    return `GitHub access for git${gh} goes through a pre-configured session proxy (CA bundle: ${caBundlePath}) via per-session git config${shim}; other network traffic uses this machine's own egress. If git or gh fail against github.com (TLS or HTTP errors, or a transfer cut off with connection reset / unexpected disconnect), ${see}check the git config file named by $GIT_CONFIG_GLOBAL; never disable TLS verification or remove the proxy/sslCAInfo entries there.`
  }
  const installed = opts?.installedProxyPreconfiguredClis ?? []
  const extra =
    installed.length > 0
      ? ` Installed CLIs preconfigured for the proxy: ${installed.join(', ')} — prefer a skill/MCP tool, then these, over raw curl.`
      : ''
  return (
    `Outbound HTTPS goes through a pre-configured agent proxy (CA bundle: ${caBundlePath}). If a tool fails TLS verification, gets 403/405/407 from the proxy, or a transfer is cut off (connection reset, unexpected disconnect, RPC failed), ${see}run curl -sS "$HTTPS_PROXY/__agentproxy/status" for per-tool fixes and proxy state; never disable TLS verification or unset HTTPS_PROXY.` +
    extra
  )
}

/** Default README path under the CA bundle's parent dir (gold U = O(y,"..","README.md")). */
export function agentProxyReadmePath(caBundlePath: string): string {
  return join(dirname(caBundlePath), 'README.md')
}

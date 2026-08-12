/**
 * Sandbox types for the Claude Code Agent SDK
 *
 * This file is the single source of truth for sandbox configuration types.
 * Both the SDK and the settings validation import from here.
 */

import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

/**
 * Network configuration schema for sandbox.
 */
export const SandboxNetworkConfigSchema = lazySchema(() =>
  z
    .object({
      allowedDomains: z.array(z.string()).optional(),
      // densable 2.1.219: always-blocked domains (all sources; survives allowManagedDomainsOnly).
      deniedDomains: z
        .array(z.string())
        .optional()
        .describe(
          'Domains that are always blocked, even if matched by allowedDomains. Supports the same wildcard syntax as allowedDomains. Merged from all settings sources regardless of allowManagedDomainsOnly.',
        ),
      // densable 2.1.219 #2 — user/managed/CLI only; project settings ignored.
      strictAllowlist: z
        .boolean()
        .optional()
        .describe(
          'When true, the sandbox runtime deterministically denies hosts not in allowedDomains instead of prompting. ' +
            'Enforced for sandboxed commands only — in-process tools such as WebFetch are not gated by this setting. ' +
            'Only honored from user, managed/policy, or CLI (--settings) settings — ' +
            'project settings (.claude/settings.json and .claude/settings.local.json) are ignored.',
        ),
      allowManagedDomainsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. ' +
            'User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources.',
        ),
      allowUnixSockets: z
        .array(z.string())
        .optional()
        .describe(
          'macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path).',
        ),
      allowAllUnixSockets: z
        .boolean()
        .optional()
        .describe(
          'If true, allow all Unix sockets (disables blocking on both platforms).',
        ),
      allowLocalBinding: z.boolean().optional(),
      httpProxyPort: z.number().optional(),
      socksProxyPort: z.number().optional(),
      tlsTerminate: z
        .object({
          caCertPath: z.string().min(1).optional(),
          caKeyPath: z.string().min(1).optional(),
        })
        .optional()
        .describe(
          '[EXPERIMENTAL] Enable in-process TLS termination so the per-request filter can see HTTPS request bodies. Provide a CA cert+key, or omit both to have sandbox-runtime generate an ephemeral one for the session. ' +
            'Only honored from user, managed/policy, or CLI (`--settings`) settings — project settings ' +
            '(.claude/settings.json and .claude/settings.local.json) are ignored.',
        ),
    })
    .optional(),
)

/**
 * Filesystem configuration schema for sandbox.
 */
export const SandboxFilesystemConfigSchema = lazySchema(() =>
  z
    .object({
      disabled: z
        .boolean()
        .optional()
        .describe(
          'macOS and Linux/WSL only: skip filesystem isolation entirely while keeping ' +
            'network and seccomp isolation. Ignored on native Windows, where the sandboxed ' +
            'process runs as a separate user with no inherent rights, so skipping the ' +
            'filesystem rules would withhold every access grant rather than loosen them — ' +
            'filesystem isolation stays on there. ' +
            'Sandboxed commands get unrestricted read/write access to the host filesystem; ' +
            'network egress is still confined to network.allowedDomains. Intended for ' +
            'deployments whose goal is egress control rather than filesystem containment. ' +
            'Does not change Bash prompting: sandbox.autoAllowBashIfSandboxed is independent ' +
            'and still defaults to true, so set it to false to keep prompting for sandboxed ' +
            'commands. Drops the read protection from filesystem.denyRead and ' +
            'credentials.files for sandboxed commands, since both are enforced by the ' +
            'filesystem layer this turns off; credentials.envVars deny/mask is unaffected. ' +
            'Only honored from user, managed/policy, or CLI (`--settings`) settings — ' +
            'project settings (.claude/settings.json and .claude/settings.local.json) are ' +
            'ignored. If managed settings configure sandbox.filesystem at all, or list any ' +
            'sandbox.credentials.files entry, only managed settings can set this: an admin ' +
            'who deployed filesystem restrictions must not have them switched off by a ' +
            'user-writable file. (sandbox.credentials.envVars does not pin it — env scrubbing ' +
            'is independent of the filesystem layer and survives this setting.) When unset, ' +
            'filesystem isolation stays on.',
        ),
      allowWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to allow writing within the sandbox. ' +
            'Merged with paths from Edit(...) allow permission rules.',
        ),
      denyWrite: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny writing within the sandbox. ' +
            'Merged with paths from Edit(...) deny permission rules.',
        ),
      denyRead: z
        .array(z.string())
        .optional()
        .describe(
          'Additional paths to deny reading within the sandbox. ' +
            'Merged with paths from Read(...) deny permission rules.',
        ),
      allowRead: z
        .array(z.string())
        .optional()
        .describe(
          'Paths to re-allow reading within denyRead regions. ' +
            'Takes precedence over denyRead for matching paths.',
        ),
      allowManagedReadPathsOnly: z
        .boolean()
        .optional()
        .describe(
          'When true (set in managed settings), only allowRead paths from policySettings are used.',
        ),
    })
    .optional(),
)

/**
 * densable 2.1.221 QTi + 2.1.224 #6 — sandbox.credentials.files[] entry.
 * `mode: "mask"` (Linux/WSL): sentinel copy inside sandbox; host proxy swaps
 * sentinel→real on egress. On macOS/Windows mask degrades to deny (package).
 * Optional `extract` regex masks only capture-group-1 spans.
 * densable 2.1.224: `decode:"jwt"` + `maskClaims` for claim-level JWT masking.
 */
export const SandboxCredentialFileSchema = lazySchema(() =>
  z
    .object({
      path: z
        .string()
        .min(1)
        .describe(
          'Path to a credential file or directory. Same resolution as sandbox.filesystem.* paths: absolute, ~ expanded, or relative to the settings file root (project root for project settings, ~/.claude for user settings).',
        ),
      mode: z
        .enum(['deny', 'mask'])
        .describe(
          'Access mode for this path. `deny` blocks reads inside the sandbox; `mask` shows sandboxed commands a sentinel-substituted copy (whole-file, or only the spans captured by `extract`/`decode`) and the host proxy swaps sentinel→real on egress to `injectHosts`. On macOS and Windows `mask` currently degrades to `deny`.',
        ),
      extract: z
        .string()
        .optional()
        .describe(
          'Optional regex for structured masking when mode is `mask`. Applied globally to the file; capture group 1 of each match is a credential value, and only those captured spans are replaced with sentinels — the rest of the file is preserved so a tool that parses it (.netrc, JSON, YAML) still succeeds. Without `extract`, the entire file content is replaced with one sentinel (whole-file masking, suited to single-secret files), unless `decode` supplies a default pattern. If the regex matches nothing, behavior is governed by `onExtractNoMatch` (default `warn`). Accepted but ignored for `deny`.',
        ),
      onExtractNoMatch: z
        .enum(['warn', 'deny', 'error'])
        .optional()
        .describe(
          'What to do when `extract` matches nothing in the file — or, with `decode`, when no candidate verifies / no named claim matches. `warn` (default) emits a stderr warning and leaves the file readable as-is inside the sandbox (fail-open, for credentials that may be legitimately absent); `deny` degrades the entry to mode `deny` so the file is unreadable (fail-closed) — under `sandbox.filesystem.disabled` it is treated as `error`, since read-denies are dropped in that mode; `error` aborts at sandbox setup so nothing runs until the config is fixed. Only meaningful when mode is `mask` and `extract` or `decode` is set; accepted but ignored otherwise.',
        ),
      // densable 2.1.224 #6 — package CredentialFileConfigSchema.decode
      decode: z
        .enum(['jwt'])
        .optional()
        .describe(
          'Optional encoded-credential format for `mask` mode. `jwt`: candidates are located with a built-in JWT regex (or the explicit `extract` pattern, if set), verified to actually be JWTs before masking, and replaced with a structurally valid fake JWT so client-side token parsing inside the sandbox keeps working. If no candidate verifies, behavior is governed by `onExtractNoMatch` (default `warn`). Accepted but ignored for `deny`.',
        ),
      // densable 2.1.224 #6 — claim-level masking inside decoded JWT payload
      maskClaims: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Names of top-level payload claims to mask inside each decoded value, instead of replacing the whole token. Each named claim present with a string value gets its own sentinel and the token is rebuilt around the modified payload; all other claims are preserved so a tool that decodes the token and reads a non-secret claim keeps working. Requires `decode`. If no named claim matches in any verified token, behavior is governed by `onExtractNoMatch`. Accepted but ignored for `deny`.',
        ),
      maskDuplicates: z
        .boolean()
        .optional()
        .describe(
          'If true, verbatim occurrences of each captured credential value outside the regex-matched spans are also replaced with the corresponding sentinel — for a secret repeated where the regex does not reach (e.g. pasted into a comment). Matches raw substrings, so short or common values may corrupt unrelated content; intended for long, high-entropy secrets. Defaults to false. Only meaningful when mode is `mask` and `extract` or `decode` is set; accepted but ignored otherwise.',
        ),
      injectHosts: z
        .array(z.string())
        .optional()
        .describe(
          'Optional narrowing of where the proxy substitutes this credential. Only meaningful when mode is `mask`; accepted but ignored for `deny`. If unset, defaults to `network.allowedDomains` — the credential is injected at every reachable host. Each entry must be reachable via `network.allowedDomains` (sandbox-runtime validates this).',
        ),
    })
    .superRefine((entry, ctx) => {
      // densable: mask + directory path trailing `/` is invalid (whole-file bind only).
      if (entry.mode === 'mask' && entry.path.endsWith('/')) {
        ctx.addIssue({
          code: 'custom',
          path: ['path'],
          message:
            'sandbox.credentials.files mode "mask" requires a file path, not a directory (trailing "/")',
        })
      }
      // densable / sandbox-runtime: maskClaims requires decode
      if (entry.maskClaims !== undefined && entry.decode === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['maskClaims'],
          message:
            'maskClaims requires decode — it names claims inside the decoded payload. Set decode (e.g. "jwt"), or remove maskClaims to mask the extracted value whole.',
        })
      }
      if (entry.maskClaims !== undefined && entry.maskClaims.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['maskClaims'],
          message:
            'maskClaims is explicitly empty — no claim would ever be masked. Omit maskClaims to mask the whole token, or list the claims to protect.',
        })
      }
    }),
)

/**
 * densable ZTi + 2.1.224 #6 — sandbox.credentials.envVars[] entry.
 * `mask` + injectHosts is settings-valid; package Anu builds setEnvVars and
 * the host proxy swaps sentinel→real on injectHosts (sandbox-runtime≥0.0.70).
 * Host adapter merges credentials via mergeSandboxCredentialsForRuntime.
 * densable 2.1.224: extract/onExtractNoMatch/decode/maskClaims mirror files.
 */
export const SandboxCredentialEnvVarSchema = lazySchema(() =>
  z
    .object({
      name: z
        .string()
        .regex(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          'Environment variable name must start with a letter or underscore and contain only letters, digits, and underscores',
        )
        .describe('Environment variable name.'),
      mode: z
        .enum(['deny', 'mask'])
        .describe(
          'Access mode for this environment variable. `deny` unsets the variable for sandboxed commands; `mask` shows sandboxed commands a sentinel value and the host proxy swaps sentinel→real on egress to `injectHosts`.',
        ),
      extract: z
        .string()
        .optional()
        .describe(
          'Optional regex for structured masking when mode is `mask`. Applied globally; capture group 1 of each match is masked, the rest of the value is preserved. If the pattern matches nothing, behavior is governed by `onExtractNoMatch` (default `warn`). Accepted but ignored for `deny`.',
        ),
      onExtractNoMatch: z
        .enum(['warn', 'deny', 'error'])
        .optional()
        .describe(
          'What to do when `extract` matches nothing — or, with `decode`, when the value does not verify / no named claim matches. `warn` (default) emits a stderr warning and leaves the variable unmasked (fail-open); `deny` unsets the variable inside the sandbox (fail-closed); `error` aborts at wrap time. Only meaningful when mode is `mask` and `extract` or `decode` is set; accepted but ignored otherwise.',
        ),
      decode: z
        .enum(['jwt'])
        .optional()
        .describe(
          "Optional encoded-credential format for `mask` mode. `jwt`: the variable's whole value is verified to actually be a JWT and replaced with a structurally valid fake JWT so client-side token parsing keeps working; the proxy swaps the whole fake token on egress. With `maskClaims`, only named payload claims are masked and the token is rebuilt. If the value does not verify, behavior is governed by `onExtractNoMatch` (default `warn`). Accepted but ignored for `deny`.",
        ),
      maskClaims: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Names of top-level payload claims to mask inside the decoded value, instead of replacing the whole token. Each named claim present with a string value gets its own sentinel and the token is rebuilt around the modified payload; all other claims are preserved. Requires `decode`. If no named claim matches, behavior is governed by `onExtractNoMatch`. Accepted but ignored for `deny`.',
        ),
      injectHosts: z
        .array(z.string())
        .optional()
        .describe(
          'Optional narrowing of where the proxy substitutes this credential. Only meaningful when mode is `mask`; accepted but ignored for `deny`. If unset, defaults to `network.allowedDomains` — the credential is injected at every reachable host. Each entry must be reachable via `network.allowedDomains` (sandbox-runtime validates this).',
        ),
    })
    .superRefine((entry, ctx) => {
      if (entry.maskClaims !== undefined && entry.decode === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['maskClaims'],
          message:
            'maskClaims requires decode — it names claims inside the decoded payload. Set decode (e.g. "jwt"), or remove maskClaims to mask the whole value.',
        })
      }
      if (entry.maskClaims !== undefined && entry.maskClaims.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['maskClaims'],
          message:
            'maskClaims is explicitly empty — no claim would ever be masked. Omit maskClaims to mask the whole token, or list the claims to protect.',
        })
      }
    }),
)

/**
 * densable 2.1.224 #6 — credentials.awsPairs[] entry (sandbox-runtime AwsPairConfig).
 * Groups masked env vars into AWS credential pairs for SigV4 re-signing when
 * names are non-standard. Conventional AWS_ACCESS_KEY_ID / SECRET / SESSION
 * trio is paired automatically when masked whole-value.
 * User/managed/CLI only (project settings ignored at merge).
 */
export const SandboxCredentialAwsPairSchema = lazySchema(() =>
  z
    .object({
      accessKeyIdVar: z
        .string()
        .regex(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          'Environment variable name must start with a letter or underscore and contain only letters, digits, and underscores',
        )
        .describe(
          'Env var name holding the access key id (must be a mode:"mask" whole-value envVars entry).',
        ),
      secretAccessKeyVar: z
        .string()
        .regex(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          'Environment variable name must start with a letter or underscore and contain only letters, digits, and underscores',
        )
        .describe(
          'Env var name holding the secret access key (must be a mode:"mask" whole-value envVars entry).',
        ),
      sessionTokenVar: z
        .string()
        .regex(
          /^[A-Za-z_][A-Za-z0-9_]*$/,
          'Environment variable name must start with a letter or underscore and contain only letters, digits, and underscores',
        )
        .optional()
        .describe(
          'Optional env var name holding the session token (must be a mode:"mask" whole-value envVars entry when set).',
        ),
    })
    .strict(),
)

/**
 * densable 2.1.224 #6 — credentials.sigv4 policies (sandbox-runtime Sigv4Config).
 * Per-shape policy for SigV4 forms the proxy cannot re-sign.
 * User/managed/CLI only (project settings ignored at merge).
 */
export const SandboxSigv4ConfigSchema = lazySchema(() =>
  z
    .object({
      streaming: z
        .enum(['deny', 'passthrough'])
        .optional()
        .describe(
          'Policy for aws-chunked streaming uploads (x-amz-content-sha256: STREAMING-*). Default "deny".',
        ),
      presigned: z
        .enum(['deny', 'passthrough'])
        .optional()
        .describe(
          'Policy for presigned URLs (X-Amz-Algorithm/X-Amz-Signature in the query). Default "deny".',
        ),
      sigv4a: z
        .enum(['deny', 'passthrough'])
        .optional()
        .describe(
          'Policy for SigV4A (AWS4-ECDSA-P256-SHA256) asymmetric signatures. Default "deny".',
        ),
    })
    .strict(),
)

/**
 * densable oeh + 2.1.224 #6 — sandbox.credentials block.
 */
export const SandboxCredentialsConfigSchema = lazySchema(() =>
  z
    .object({
      files: z
        .array(SandboxCredentialFileSchema())
        .optional()
        .describe(
          'Credential files or directories to protect. `deny` blocks reads inside the sandbox; `mask` substitutes a sentinel inside the sandbox (whole-file, or per-`extract`/`decode` capture) and injects the real value at the proxy. On macOS and Windows `mask` degrades to `deny`.',
        ),
      envVars: z
        .array(SandboxCredentialEnvVarSchema())
        .optional()
        .describe(
          'Environment variables to protect. `deny` unsets the variable for sandboxed commands; `mask` substitutes a sentinel inside the sandbox and injects the real value at the proxy. Supports `extract`/`decode`/`maskClaims` structured masking (sandbox-runtime≥0.0.70).',
        ),
      allowPlaintextInject: z
        .boolean()
        .optional()
        .describe(
          'Allow sentinel→real substitution on the plain-HTTP proxy path. ' +
            'Defaults to false: without TLS termination the upstream identity is unverified and the credential travels in cleartext. Set only for trusted-network test fixtures. Only honored from user, managed/policy, or CLI (`--settings`) ' +
            'settings — project settings (.claude/settings.json and ' +
            '.claude/settings.local.json) are ignored.',
        ),
      // densable 2.1.224 #6
      awsPairs: z
        .array(SandboxCredentialAwsPairSchema())
        .optional()
        .describe(
          'Explicit groupings of masked env vars into AWS credential pairs for SigV4 re-signing, for non-standard variable names. The conventional AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN trio is paired automatically when masked. Only honored from user, managed/policy, or CLI (`--settings`) settings — project settings (.claude/settings.json and .claude/settings.local.json) are ignored. A member is only usable when its env var is forwarded as a whole-value mask (no extract/decode).',
        ),
      sigv4: SandboxSigv4ConfigSchema()
        .optional()
        .describe(
          'Policies for AWS SigV4 request shapes the proxy cannot re-sign (streaming, presigned, sigv4a) when they reference a masked credential pair: "deny" (default) or "passthrough". Only honored from user, managed/policy, or CLI (`--settings`) settings — project settings are ignored. Requires network.tlsTerminate for re-signing.',
        ),
    })
    .optional(),
)

/**
 * Sandbox settings schema.
 */
export const SandboxSettingsSchema = lazySchema(() =>
  z
    .object({
      enabled: z.boolean().optional(),
      failIfUnavailable: z
        .boolean()
        .optional()
        .describe(
          'Exit with an error at startup if sandbox.enabled is true but the sandbox cannot start ' +
            '(missing dependencies, unsupported platform, or platform not in enabledPlatforms). ' +
            'When false (default), a warning is shown and commands run unsandboxed. ' +
            'Intended for managed-settings deployments that require sandboxing as a hard gate.',
        ),
      // Note: enabledPlatforms is an undocumented setting read via .passthrough()
      // It restricts sandboxing to specific platforms (e.g., ["macos"]).
      //
      // Added to unblock NVIDIA enterprise rollout: they want to enable
      // autoAllowBashIfSandboxed but only on macOS initially, since Linux/WSL
      // sandbox support is newer and less battle-tested. This allows them to
      // set enabledPlatforms: ["macos"] to disable sandbox (and auto-allow)
      // on other platforms until they're ready to expand.
      autoAllowBashIfSandboxed: z.boolean().optional(),
      allowUnsandboxedCommands: z
        .boolean()
        .optional()
        .describe(
          'Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. ' +
            'When false, the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed. ' +
            'Default: true.',
        ),
      network: SandboxNetworkConfigSchema(),
      filesystem: SandboxFilesystemConfigSchema(),
      // densable oeh — first-class credentials (was passthrough-only)
      credentials: SandboxCredentialsConfigSchema(),
      ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
      enableWeakerNestedSandbox: z.boolean().optional(),
      enableWeakerNetworkIsolation: z
        .boolean()
        .optional()
        .describe(
          'macOS only: Allow access to com.apple.trustd.agent in the sandbox. ' +
            'Needed for Go-based CLI tools (gh, gcloud, terraform, etc.) to verify TLS certificates ' +
            'when using httpProxyPort with a MITM proxy and custom CA. ' +
            '**Reduces security** — opens a potential data exfiltration vector through the trustd service. Default: false',
        ),
      excludedCommands: z.array(z.string()).optional(),
      ripgrep: z
        .object({
          command: z.string(),
          args: z.array(z.string()).optional(),
        })
        .optional()
        .describe('Custom ripgrep configuration for bundled ripgrep support'),
    })
    .passthrough(),
)

// Inferred types from schemas
export type SandboxSettings = z.infer<ReturnType<typeof SandboxSettingsSchema>>
export type SandboxNetworkConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxNetworkConfigSchema>>
>
export type SandboxFilesystemConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxFilesystemConfigSchema>>
>
export type SandboxCredentialsConfig = NonNullable<
  z.infer<ReturnType<typeof SandboxCredentialsConfigSchema>>
>
export type SandboxCredentialFile = z.infer<
  ReturnType<typeof SandboxCredentialFileSchema>
>
export type SandboxCredentialEnvVar = z.infer<
  ReturnType<typeof SandboxCredentialEnvVarSchema>
>
export type SandboxCredentialAwsPair = z.infer<
  ReturnType<typeof SandboxCredentialAwsPairSchema>
>
export type SandboxSigv4Config = z.infer<
  ReturnType<typeof SandboxSigv4ConfigSchema>
>
export type SandboxIgnoreViolations = NonNullable<
  SandboxSettings['ignoreViolations']
>

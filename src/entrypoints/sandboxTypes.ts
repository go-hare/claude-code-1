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
 * densable QTi — sandbox.credentials.files[] entry.
 * Settings schema only accepts mode "deny" (runtime mask path is package-side).
 */
export const SandboxCredentialFileSchema = lazySchema(() =>
  z.object({
    path: z
      .string()
      .min(1)
      .describe(
        'Path to a credential file or directory. Same resolution as sandbox.filesystem.* paths: absolute, ~ expanded, or relative to the settings file root (project root for project settings, ~/.claude for user settings).',
      ),
    mode: z
      .literal('deny')
      .describe('Access mode for this path. Only `deny` is supported.'),
  }),
)

/**
 * densable ZTi — sandbox.credentials.envVars[] entry.
 * `mask` + injectHosts is settings-valid; package Anu builds setEnvVars and
 * the host proxy swaps sentinel→real on injectHosts (sandbox-runtime≥0.0.70).
 * Host adapter merges credentials via mergeSandboxCredentialsForRuntime.
 */
export const SandboxCredentialEnvVarSchema = lazySchema(() =>
  z.object({
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
    injectHosts: z
      .array(z.string())
      .optional()
      .describe(
        'Optional narrowing of where the proxy substitutes this credential. Only meaningful when mode is `mask`; accepted but ignored for `deny`. If unset, defaults to `network.allowedDomains` — the credential is injected at every reachable host. Each entry must be reachable via `network.allowedDomains` (sandbox-runtime validates this).',
      ),
  }),
)

/**
 * densable oeh — sandbox.credentials block.
 */
export const SandboxCredentialsConfigSchema = lazySchema(() =>
  z
    .object({
      files: z
        .array(SandboxCredentialFileSchema())
        .optional()
        .describe(
          'Credential files or directories to protect. `deny` blocks reads inside the sandbox.',
        ),
      envVars: z
        .array(SandboxCredentialEnvVarSchema())
        .optional()
        .describe(
          'Environment variables to protect. `deny` unsets the variable for sandboxed commands; `mask` substitutes a sentinel inside the sandbox and injects the real value at the proxy.',
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
export type SandboxIgnoreViolations = NonNullable<
  SandboxSettings['ignoreViolations']
>

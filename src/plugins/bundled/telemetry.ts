/**
 * densable 2.1.289 yfe `cc-plugin-telemetry` (`or` / `V` / `I`).
 */
import { join } from 'path'
import { getGatewayAuth } from '../../utils/gatewayEnv.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { leftoverFu } from '../../utils/plugins/functionHooksModules.js'
import { getPrivacyLevel } from '../../utils/privacyLevel.js'
import { registerBuiltinPlugin } from '../builtinPlugins.js'

export const TELEMETRY_MOD_FOLDER = 'telemetry'
export const TELEMETRY_PLUGIN_NAME = 'cc-plugin-telemetry'
export const TELEMETRY_PLUGIN_DESCRIPTION =
  "Telemetry: a plugin logs an analytics event through $.telemetry.log or marks a feature's use through $.telemetry.mark, sent as first-party rows in batches"

/** densable telemetry leftoverFu scan.env.reads. */
const TELEMETRY_SCAN_ENV_READS = [
  'ALACRITTY_LOG',
  'APP_URL',
  'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_FUNCTION_NAME',
  'AZURE_FUNCTIONS_ENVIRONMENT',
  'BUILDKITE',
  'C9_PID',
  'C9_USER',
  'CF_PAGES',
  'CI',
  'CIRCLECI',
  'CLAUBBIT',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_CODE_ACTION',
  'CLAUDE_CODE_CONTAINER_ID',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_HOST_PLATFORM',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE',
  'CLAUDE_CODE_REMOTE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
  'CLAUDE_CODE_TAGS',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_SESSION_INGRESS_TOKEN_FILE',
  'CODER',
  'CODER_WORKSPACE_NAME',
  'CODESPACES',
  'COMSPEC',
  'CURSOR_TRACE_ID',
  'ConEmuANSI',
  'ConEmuPID',
  'ConEmuTask',
  'DAYTONA_WS_ID',
  'DENO_DEPLOYMENT_ID',
  'DEVPOD',
  'DEVPOD_WORKSPACE_UID',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
  'DYNO',
  'FLY_APP_NAME',
  'FLY_MACHINE_ID',
  'GITHUB_ACTIONS',
  'GITHUB_ACTION_PATH',
  'GITHUB_ACTOR_ID',
  'GITHUB_EVENT_NAME',
  'GITHUB_REPOSITORY_ID',
  'GITHUB_REPOSITORY_OWNER_ID',
  'GITLAB_CI',
  'GITPOD_WORKSPACE_ID',
  'GNOME_TERMINAL_SERVICE',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_WORKSTATIONS',
  'HOME',
  'KITTY_WINDOW_ID',
  'KONSOLE_VERSION',
  'KUBERNETES_SERVICE_HOST',
  'K_SERVICE',
  'MSYSTEM',
  'NETLIFY',
  'NODE_ENV',
  'OS',
  'P4PORT',
  'PROCESSOR_ARCHITECTURE',
  'PROJECT_DOMAIN',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_NAME',
  'RENDER',
  'REPL_ID',
  'REPL_SLUG',
  'RUNNER_ENVIRONMENT',
  'RUNNER_OS',
  'SESSIONNAME',
  'SHELL',
  'SPACE_CREATOR_USER_ID',
  'SSH_CLIENT',
  'SSH_CONNECTION',
  'SSH_TTY',
  'STY',
  'SWE_BENCH_INSTANCE_ID',
  'SWE_BENCH_RUN_ID',
  'SWE_BENCH_TASK_ID',
  'TERM',
  'TERMINAL_EMULATOR',
  'TERMINATOR_UUID',
  'TERM_PROGRAM',
  'TILIX_ID',
  'TMUX',
  'USERPROFILE',
  'USER_TYPE',
  'VERCEL',
  'VSCODE_GIT_ASKPASS_MAIN',
  'VTE_VERSION',
  'VisualStudioVersion',
  'WEBSITE_SITE_NAME',
  'WEBSITE_SKU',
  'WSL_DISTRO_NAME',
  'WT_SESSION',
  'XTERM_VERSION',
  '__CFBundleIdentifier',
] as const

/**
 * densable Ih — telemetry listing isAvailable is !Ih.
 * Never export minify Ih.
 */
function leftoverIh(): boolean {
  const notFirstPartyUnlessHostManaged = process.env
    .CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST
    ? false
    : getAPIProvider() !== 'firstParty'
  return (
    notFirstPartyUnlessHostManaged ||
    getGatewayAuth() !== null ||
    getPrivacyLevel() !== 'default' ||
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL !== undefined
  )
}

export function isTelemetryPluginAvailable(): boolean {
  return !leftoverIh()
}

export function registerTelemetryBuiltinPlugin(): void {
  registerBuiltinPlugin({
    name: TELEMETRY_PLUGIN_NAME,
    description: TELEMETRY_PLUGIN_DESCRIPTION,
    isAvailable: isTelemetryPluginAvailable,
    hooksModule: leftoverFu(
      join(import.meta.dir, '../../../vendor/claude-code-mods/mods/telemetry'),
      {
        register: (...args: unknown[]) => {
          const mod =
            require('../../../vendor/claude-code-mods/mods/telemetry/hooks/register.ts') as {
              register?: (...inner: unknown[]) => unknown
            }
          return mod.register?.(...args)
        },
      },
      () => ({
        scan: {
          hooks: [
            'telemetry.*',
            'telemetry.log',
            'telemetry.mark',
            'session.start',
            'session.end',
            'engine.create',
          ],
          calls: [
            'clock.after',
            'clock.sleep',
            'env.get',
            'fs.exists',
            'fs.list',
            'fs.read',
            'http.fetch',
            'process.run',
            'session.authorize',
            'session.cwd',
            'session.id',
            'session.model',
            'session.repo',
            'session.surfaces',
            'session.version',
            'settings.read',
            'ui.log',
          ],
          telemetry: ['anthropic', 'collector'],
          env: {
            reads: [...TELEMETRY_SCAN_ENV_READS],
            writes: [],
          },
        },
        files: {},
      }),
    ),
  })
}

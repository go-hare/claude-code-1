# densable/official 2.1.214 binary string extract

Binary: `C:\\Users\\Administrator\\AppData\\Local\\Temp\\official-214\\package\\claude.exe` (256220832 bytes)
Method: Python ASCII string scan (min len 8).

## #33 plugins + `--settings` / flagSettings

### Symbol/API names present
- `applyFlagSettings` @ 0x83c2fa8
- `cachePluginSettings` @ 0x56e68e0
- `checkEnabledPlugins` @ 0x56e8ee8
- `enabledPlugins` @ 0x5a61ce8
- `flagSettings` @ 0x574bce8
- `flagSettingsExpectedContent` @ 0x574d908
- `flagSettingsInline` @ 0x574d938
- `flagSettingsPath` @ 0x574d8e8
- `getFlagSettingsExpectedContent` @ 0x56c1470
- `getFlagSettingsInline` @ 0x56c1448
- `getFlagSettingsPath` @ 0x56c1420
- `getPluginAffectingSettingsSnapshot` @ 0x56e1a20
- `getSettingsAfterPluginLoad` @ 0x56d0fb8
- `loadPluginHooks` @ 0x56e1a00
- `loadPluginManifest` @ 0x56e6630
- `loadPluginWorkflows` @ 0x56e3cc0
- `onApplyFlagSettings` @ 0x7b69500
- `reloadPlugins` @ 0x83c3180
- `setFlagSettingsExpectedContent` @ 0x56bf1e8
- `setFlagSettingsInline` @ 0x56bf1c0
- `setFlagSettingsPath` @ 0x56bf198

### Exact / high-signal strings
- `@0x56bf198` setFlagSettingsPath
- `@0x56bf1c0` setFlagSettingsInline
- `@0x56bf1e8` setFlagSettingsExpectedContent
- `@0x56c1420` getFlagSettingsPath
- `@0x56c1448` getFlagSettingsInline
- `@0x56c1470` getFlagSettingsExpectedContent
- `@0x56d0fb8` getSettingsAfterPluginLoad
- `@0x56e1a20` getPluginAffectingSettingsSnapshot
- `@0x56e68e0` cachePluginSettings
- `@0x56e8ee8` checkEnabledPlugins
- `@0x574d8e8` flagSettingsPath
- `@0x574d908` flagSettingsExpectedContent
- `@0x574d938` flagSettingsInline
- `@0x6786b50` Plugin hooks: skipping reload, plugin-affecting settings unchanged
- `@0x6786bb0` Plugin hooks: reloading due to plugin-affecting settings change
- `@0x6786c00` loadPluginHooks: plugin-affecting settings changed
- `@0x6788d00` Skipping plugin hooks - safe mode disables plugins (managed settings-file hooks still run)
- `@0x6789018` This appears to be a configuration issue. Check your plugin settings in .claude/settings.json
- `@0x6789088` Please fix the plugin configuration or remove problematic plugins from your settings.
- `@0x7286068` the --settings flag
- `@0x72ca0f8` Syncing installed_plugins.json with enabledPlugins from all settings.json files
- `@0x72ca528` Skipping --settings-enabled 
- `@0x72ca618` Cannot materialize versioned cache for --settings-enabled 
- `@0x7342950` Loaded settings from settings.json for plugin 
- `@0x7342990` plugin_load_settings
- `@0x73429c0` Failed to parse settings.json for plugin 
- `@0x7342a70` plugin_load_settings_parse_failed
- `@0x77f6f40`  enabled plugins with scopes: 
- `@0x7b69500` onApplyFlagSettings
- `@0x83c2fa8` applyFlagSettings
- `@0x83c3180` reloadPlugins
- `@0x83e61d0` reloadPlugins: no mcpDelegate wired
- `@0x9725f30` Error: Invalid JSON provided to --settings
- `@0x9726158` Error processing --settings: 
- `@0x98efd80` Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read). 3P providers (Bedrock/Vertex/Foundry) use their own credentials. Skills still resolve via /skill-name. Explicitly provide context via: --system-prompt[-file], --append-system-prompt[-file], --add-dir (CLAUDE.md dirs), --mcp-config, --settings, --agents, --plugin-dir.
- `@0xd8a2190` @internal Output-direction counterpart to SDKControlApplyFlagSettingsRequest. Emitted when slash commands that toggle flag settings request a batched write that the surface applies to its AppState. From internal QueryEvent 'apply_flag_settings'.
- `@0xe414bb6` `;for(let y of c){let _;switch(y.source){case"projectSettings":_="Project";break;case"userSettings":_="User";break;case"localSettings":_="Local";break;case"flagSettings":_="Flag";break;case"policySettings":_="Policy";break;case"plugin":_="Plugin";break;case"built-in":_="Built-in";break;default:_=String(y.source)}m+=`| ${y.agentType} | ${_} | ${$a(y.tokens)} |

### Extra related
- `@0x574bce8` flagSettings
- `@0x63fd7a8` ] Skipping frontmatter MCP servers: strictPluginOnlyCustomization locks MCP to plugin-only (agent source: 
- `@0x72550b8` [skills] Dynamic skill discovery skipped: projectSettings disabled or plugin-only policy
- `@0x79cc4c8` } but only ${CLAUDE_PLUGIN_ROOT} is available for skill hooks (${CLAUDE_PLUGIN_DATA} is plugin-only). Command: 
- `@0x8b72b10` This rule comes from a read-only source (
- `@0xa392e60` When true (and set in managed settings), only allowedDomains and WebFetch(domain:...) allow rules from managed settings are respected. User, project, local, and flag settings domains are ignored. Denied domains are still respected from all sources.
- `@0xd8d06f8` Merges the provided settings into the flag settings layer, updating the active configuration.

### Interpretation notes (#33)
- Official retains first-class `flagSettings` settings source alongside policy/user/project/local.
- CLI flag `--settings` maps into `flagSettings` / `applyFlagSettings` / `setFlagSettings{Path,Inline,ExpectedContent}`.
- Plugin pipeline is settings-aware: `checkEnabledPlugins`, `enabledPlugins`, `getSettingsAfterPluginLoad`, `loadPluginHooks` reloads on plugin-affecting settings change.
- Explicit `--settings-enabled` materialization paths exist: Skipping / Cannot materialize versioned cache.
- Safe-mode: Skipping plugin hooks - safe mode disables plugins (managed settings-file hooks still run).
- UI attribution: rules from `flagSettings` described as coming from `the --settings flag`.
- Error paths: `Error: Invalid JSON provided to --settings`, `Error processing --settings:`.
- Plugin-local settings files: Loaded/Failed to parse settings.json for plugin + `plugin_load_settings`.

## #40 hooks exit code 2 / blocking / schema

### Exit code 2 semantics
- `@0x5a37208` If true, hook runs in background and wakes the model on exit code 2 (blocking error). Implies async.
- `@0xd518787` Exit code 2 - show stderr to model and block tool call
- `@0xd518900` Exit code 2 - show stderr to model immediately
- `@0xd518bff` Exit code 2 - stop the agentic loop (stderr shown to user only)
- `@0xd519256` Exit code 2 - block processing, erase original prompt, and show stderr to user only
- `@0xd5193c4` Exit code 2 - block expansion and show stderr to user only
- `@0xd5194e9` Exit code 2 - show stderr to user only
- `@0xd51971e` Exit code 2 - show stderr to model and continue conversation
- `@0xd519e65` Exit code 2 - show stderr to subagent and continue having it run
- `@0xd519f87` Exit code 2 - block compaction
- `@0xd51a751` Exit code 2 - show stderr to teammate and prevent idle (teammate continues working)
- `@0xd51a89b` Exit code 2 - show stderr to model and prevent task creation
- `@0xd51a9db` Exit code 2 - show stderr to model and prevent task completion
- `@0xd51ab7e` Exit code 2 - deny the elicitation
- `@0xd51ad2b` Exit code 2 - block the response (action becomes decline)
- `@0xd51ae7e` Exit code 2 - block the change from being applied to the session

### Blocking / parse / PreToolUse-PostToolUse related
- `@0x52e93b0` Compaction blocked by PreCompact hook
- `@0x5309b70` PreToolUse hook did not respond before its timeout (host client may be unreachable). The tool call was not executed; other configured hooks may not have completed.
- `@0x5309c28` PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.
- `@0x53ee086`   "hookSpecificOutput": {
- `@0x53ee209` - `decision` - "block" for PostToolUse/Stop/UserPromptSubmit hooks (deprecated for PreToolUse, use hookSpecificOutput.permissionDecision instead)
- `@0x53ee2c1` - `hookSpecificOutput` - Event-specific output (must include `hookEventName`):
- `@0x53ee34b`   - `permissionDecision` - "allow", "deny", or "ask" (PreToolUse only)
- `@0x53ee392`   - `permissionDecisionReason` - Reason for the permission decision (PreToolUse only)
- `@0x56cc048` CLAUDE_CODE_STOP_HOOK_BLOCK_CAP
- `@0x56eaa28` getUserPromptSubmitHookBlockingMessage
- `@0x56eab70` getPreToolHookBlockingMessage
- `@0x56eabc8` getNonBlockableHookErrorMessage
- `@0x56ed180` readPermissionDecisionForPath
- `@0x610de80` ConfigChange hook blocked change to 
- `@0x610f410` ConfigChange hook blocked deletion of 
- `@0x62443e0` hookSpecificOutput
- `@0x6244408` hookSpecificOutput.
- `@0x6244460`  Did you mean hookSpecificOutput.additionalContext (with a hookEventName)?
- `@0x62453c8` hookSpecificOutput.additionalContext (
- `@0x6245418` hookSpecificOutput (
- `@0x68e3828` Compaction blocked by PreCompact hook: 
- `@0x68e38a8` compaction blocked by PreCompact hook
- `@0x6b2a010` HTTP hook blocked: 
- `@0x6b638e0`  compaction blocked by PreCompact hook; continuing uncompacted
- `@0x6bf7e60` hookPermissionDecisionReason
- `@0x6dfc4d8`  returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)
- `@0x6dfc568`  returned permissionDecision=defer but 
- `@0x6dfd0b8`  permissionDecisionMs=
- `@0x71ecf30` A hook blocked the turn from ending 
- `@0x71ecfe0` For Stop/SubagentStop hooks, check stop_hook_active in the input and return success while it's true. Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.
- `@0x71ed0c0` stop_hook_blocking
- `@0x798e6e0` tengu_agent_stop_hook_blocking
- `@0x79bb178` WorktreeCreate hook failed: hook succeeded but returned no worktree path (command: echo the path to stdout; http/callback: return hookSpecificOutput.worktreePath)
- `@0x79c3658` hookSpecificOutput is missing required field "hookEventName"
- `@0x79c5a68` Failed to parse hook output as JSON: 
- `@0x79c5e48` permissionDecision
- `@0x79c5e70` permissionDecisionReason
- `@0x79c7b90` Unknown hook permissionDecision type: 
- `@0x79eefa0` ) returned permissionDecision: deny
- `@0x79ef5c0` ) returned permissionDecision: 
- `@0x90e12b0` ConfigChange hook blocked skill reload (
- `@0xcc066b0` readPermissionDecisionForPath probe consulted unsupported tool property: 
- `@0xcc06710` readPermissionDecisionForPath probe consulted unsupported tool property
- `@0xd518ba3` Return additionalContext via hookSpecificOutput to inject context once for the whole batch.
- `@0xd518d0e` Return {"hookSpecificOutput":{"hookEventName":"PermissionDenied","retry":true}} to tell the model it may retry.
- `@0xd51a44e` Output JSON with hookSpecificOutput containing decision to allow or deny.
- `@0xd51aaee` Output JSON with hookSpecificOutput containing action (accept/decline/cancel) and optional content.
- `@0xd51ac9a` Output JSON with hookSpecificOutput containing optional action and content to override the response.
- `@0xd51c068` Output JSON with hookSpecificOutput containing displayContent to replace the delta on screen.
- `@0xd89e890` Discriminator from PermissionDecisionReason (e.g. 'classifier', 'asyncAgent', 'mode', 'rule').
- `@0xe9492c7` Hook output can include hookSpecificOutput.watchPaths (array of absolute paths) to register with the FileChanged watcher.
- `@0xe9494e8` Hook output can include hookSpecificOutput.watchPaths (array of absolute paths) to dynamically update the watch list.
- `@0xeba5060` - \`decision\` - "block" for PostToolUse/Stop/UserPromptSubmit hooks (deprecated for PreToolUse, use hookSpecificOutput.permissionDecision instead)
- `@0xeba511c` - \`hookSpecificOutput\` - Event-specific output (must include \`hookEventName\`):
- `@0xeba51ac`   - \`permissionDecision\` - "allow", "deny", or "ask" (PreToolUse only)
- `@0xeba51f5`   - \`permissionDecisionReason\` - Reason for the permission decision (PreToolUse only)

### Interpretation notes (#40)
- Exit code **2 is the first-class blocking signal** for hooks; docs enumerate per-event effects.
- Async hook option: runs in background and wakes model on exit code 2 (blocking error).
- JSON control path coexists: decision block + PreToolUse permissionDecision allow/deny/ask.
- Parse failure string: `Failed to parse hook output as JSON:`.
- Helpers: getPreToolHookBlockingMessage / getUserPromptSubmitHookBlockingMessage / getNonBlockableHookErrorMessage; env CLAUDE_CODE_STOP_HOOK_BLOCK_CAP.

## #39 check your network / advisor / thinking

- `@0x52e5b30` # Advisor Tool
- `@0x531cfc0` Your organization requires remote managed settings to load, but they could not be loaded. Run `claude auth login` to re-authenticate, check your network connection, or contact your administrator.
- `@0x532bfc0` Changing thinking mode mid-conversation will increase latency and may reduce quality.
- `@0x56c9270` CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL
- `@0x56c9420` CLAUDE_CODE_DISABLE_THINKING
- `@0x56c9ba0` CLAUDE_CODE_DISABLE_ADVISOR_TOOL
- `@0x56c9bd0` CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING
- `@0x56f1288` applyAdvisor
- `@0x5a5b238` Advisor model for the server-side advisor tool.
- `@0x5a620b8` alwaysThinkingEnabled
- `@0x5a62148` advisorModel
- `@0x5a62590` showThinkingSummaries
- `@0x5bc6888` . Check your network connection and try again.
- `@0x6442ea8` Advisor tool result content could not be processed
- `@0x644ba98` change or unset the advisorModel setting (or the --advisor flag)
- `@0x644bae8` run /advisor to change or disable the advisor
- `@0x66593f0`  does not support advisor
- `@0x6659488` ' has no advisor rank in the model catalog. Switch to a public model alias (opus, sonnet, fable) or set CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL=1.
- `@0x7d28dc0` . Check your network or run `claude /login`, then try again.
- `@0x7fe1bf2`  check your network
- `@0x8a64c68` Check your network connection.
- `@0x8f13c48` Changing thinking mode mid-conversation will increase latency and may reduce quality. For best results, set this at the start of a session.
- `@0x91c9d70` Voice connection failed. Check your network and try again.
- `@0x98f3528` Enable the server-side advisor tool with the specified model (alias or full ID).
- `@0x98f7578` . Check your network connection, or run `claude auth login` to re-authenticate.
- `@0xb039300` No auth code found in the server response. Please check your network trace to determine what happened.

### Interpretation notes (#39)
- Network copy appears in managed-settings load / auth / voice / generic retry paths.
- Advisor productized via advisorModel, --advisor, CLAUDE_CODE_*_ADVISOR_TOOL, applyAdvisor.
- Thinking via alwaysThinkingEnabled / showThinkingSummaries / CLAUDE_CODE_DISABLE_*THINKING*.
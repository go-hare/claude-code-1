/**
 * densable 2.1.283 leftover gold `ySn` @202270861 extraReach compositor.
 *
 * Unique bag only: launchDirReal / foreign verdict / extraReachRoots map.
 * No hook-forward fleet. No laptop FS engine. Seams for realpath `_t` + judge.
 */

import { isAbsolute } from 'path'

/** gold leftover unique tI @181365189 — absolute path this version can place. */
export function isPlaceableAbsolutePath(path: string): boolean {
  return isAbsolute(path)
}

/**
 * gold leftover unique verdicts from `wCe`/`ag` @181499283.
 * `local` / `foreign` / `unreadable` / `opaque` / `linked`.
 */
export type ExtraReachVerdict =
  | 'local'
  | 'foreign'
  | 'unreadable'
  | 'opaque'
  | 'linked'

export type ExtraReachJudgement = {
  spelling: string
  verdict: ExtraReachVerdict
  via?: string
}

/** gold leftover unique `$i` @202270722 */
export type CloudHooksEmptyPack = {
  forwarded: unknown[]
  templates: unknown[]
  held: unknown[]
  heldCounts: {
    after_edit: number
    kind_unsupported: number
    plugin: number
    managed: number
    other: number
  }
  notices: string[]
}

export type ExtraReachBag = {
  launchDirReal: string
  projectDirReal: string
  configHomeReal: string
  extraReach: string[]
}

/** gold leftover unique `$i` @202270722 */
export function emptyCloudHooksPack(): CloudHooksEmptyPack {
  return {
    forwarded: [],
    templates: [],
    held: [],
    heldCounts: {
      after_edit: 0,
      kind_unsupported: 0,
      plugin: 0,
      managed: 0,
      other: 0,
    },
    notices: [],
  }
}

/** gold leftover unique notice in `ySn` @202272208 */
export const HOOKS_STAY_UNPLACEABLE_COPY =
  'Hooks stay on this machine: its launch, config or sync directory is not an absolute path this version can place, so none are offered to the cloud session.'

/**
 * gold leftover unique `vo` @202270640 —
 * `${e} is configured more than once; the cloud runs it once.`
 */
export function duplicateHookConfiguredOnceCopy(name: string): string {
  return `${name} is configured more than once; the cloud runs it once.`
}

/** gold leftover unique `Zt` @202257042 */
export const CLOUD_HOOK_TEMPLATE_CAP = 8
/** gold leftover unique `Jt` @202257042 */
export const CLOUD_HOOK_FORWARDED_CAP = 128
/** gold leftover unique `mo=Ot` @202172096 / @202257042 */
export const CLOUD_HOOK_PER_EVENT_CAP = 64

/**
 * gold leftover unique `Ce` @202257042 — source labels for leftover hook notices.
 */
export const CLOUD_HOOK_SOURCE_COPY = {
  user: 'your user settings',
  local: "this checkout's settings.local.json",
  flag: 'the --settings file',
} as const

/** gold leftover unique `xi` @202257042 */
export const CLOUD_HOOK_READONLY_TEMPLATES = [
  'gh-api-readonly',
  'ruff-autofix',
] as const

/** gold leftover unique ySn hold reason @202272208 */
export const CLOUD_HOOK_UNVERIFIABLE_TARGET = 'unverifiable_target'

/**
 * gold leftover unique `Hi` @202276367 —
 * `n=e.forwarded+e.templateNames.length`
 */
export function hooksCouldRunForCloudCopy(count: number): string {
  return `${count === 1 ? 'One of your hooks' : `${count} of your hooks`} could run for cloud sessions started from this machine — run /hooks to decide (nothing from this machine runs for them until you do).`
}

/** gold leftover unique `Hi(e)` pack shape */
export function hooksCouldRunForCloudFromPack(e: {
  forwarded: number
  templateNames: { length: number }
}): string {
  return hooksCouldRunForCloudCopy(e.forwarded + e.templateNames.length)
}

/** gold leftover unique ySn over_cap — templates */
export function cloudHookTemplatesOverCapCopy(cap: number): string {
  return `Only ${cap} templates can run in the cloud session; the rest stay on this machine.`
}

/** gold leftover unique ySn over_cap — forwarded hooks */
export function cloudHooksOfferedOverCapCopy(cap: number): string {
  return `Only the first ${cap} hooks are offered to the cloud session; the rest stay on this machine.`
}

/** gold leftover unique ySn over_cap — per-event hooks */
export function cloudHooksEventOverCapCopy(cap: number, event: string): string {
  return `Only the first ${cap} ${event} hooks are offered to the cloud session; the rest stay on this machine.`
}

/**
 * gold leftover unique ySn duplicate twin —
 * `"${command}" is the same script the cloud already runs as ${templateId}; it is not also run on this machine.`
 */
export function duplicateCloudScriptCopy(
  command: string,
  templateId: string,
): string {
  return `"${command}" is the same script the cloud already runs as ${templateId}; it is not also run on this machine.`
}

/**
 * gold leftover unique `Ce[source]` lookup — unknown source returns undefined.
 */
export function cloudHookSourceCopy(source: string): string | undefined {
  return CLOUD_HOOK_SOURCE_COPY[source as keyof typeof CLOUD_HOOK_SOURCE_COPY]
}

/**
 * gold leftover unique `_o` @202276282 BODY lives in leftoverTulip.ts
 * (`TIe`/`RIe` wrap). Re-export the leftover `_o` semantic name.
 */
export {
  leftoverHookAttestationBag,
  attestToolHostStatus,
  isToolHostAttestationHeldBack,
  unspecifiedToolHostAttestationBag,
} from './leftoverTulip.js'

/**
 * leftover `Xt` @202257218 BODY 179 B — identity key for duplicate cloud-hook detection.
 * Minify name is a comment only.
 */
export function cloudHookIdentityKey(
  site: { event: string; matcher?: string },
  hook: {
    type?: string
    command?: string
    shell?: string
    args?: unknown
    url?: string
    if?: string
  },
  defaultShell: string,
): string {
  const s =
    hook.type === 'command'
      ? `${hook.shell ?? defaultShell}\x00${hook.command}\x00${JSON.stringify(hook.args ?? null)}`
      : hook.url
  return `${site.event}\x00${site.matcher ?? ''}\x00${hook.type}\x00${s}\x00${hook.if ?? ''}`
}

/**
 * gold leftover unique `Ci` @202258629 —
 * source_in_sync_root vs config-dir write inlet.
 */
export function cloudHooksNotOfferedFromFileCopy(
  settingsFile: string,
  reason: 'source_in_sync_root' | string,
): string {
  const r =
    reason === 'source_in_sync_root'
      ? 'the file sits where the cloud session can write on this machine (the synced directory or a sandbox write inlet), so the session could rewrite it (or it could no longer be resolved on this machine)'
      : 'a directory the cloud session can write on this machine is a Claude config directory'
  const clipped =
    settingsFile.length > 200 ? settingsFile.slice(0, 200) : settingsFile
  return `Hooks from ${clipped} are not offered to the cloud session: ${r}.`
}

/**
 * gold leftover unique `ko` @202260269
 * Unique copy only — not the ySn fleet compositor.
 */
export function cloudDeviceMarkNotHonouredInCheckoutCopy(): string {
  return ' (Its cloud: "device" mark is not honoured in a file inside the checkout; mark it in your user settings instead.)'
}

/**
 * leftover `pi` @202250082 — git hook refuse copies.
 * Unique copy wrap only; not the git argv scanner.
 */
export function gitHookEnvClearedRefuseCopy(): string {
  return 'it runs git with the environment that switches its repository hooks off cleared or edited'
}

export function gitExecPathInLaunchDirRefuseCopy(): string {
  return 'it runs git with an exec path in the launch directory (git-* commands come from there)'
}

export function gitHooksPathOnRefuseCopy(): string {
  return "it runs git with the repository's own hooks switched back on (core.hooksPath), which run files the session writes"
}

export function gitConfigIncludedFromLaunchDirRefuseCopy(): string {
  return 'it runs git with a configuration file included from the launch directory'
}

export function gitConfigRunsFromCheckoutRefuseCopy(setting: string): string {
  return `it runs git with ${setting} set on the command line to something that runs from the checkout`
}

/**
 * leftover `gi` @202251842 — php load refuse copy.
 * Unique copy wrap only; not the php argv scanner.
 */
export function phpLoadsRelativeFileRefuseCopy(): string {
  return 'it runs php with -z, -c or a -d setting that loads a file (auto_prepend_file, include_path, extension…), naming one that is relative or in the reach'
}

/**
 * leftover `ro` @202252766 — python refuse copies.
 * Unique copy wrap only; not the python argv scanner.
 */
export function pythonInteractiveStdinRefuseCopy(): string {
  return 'it runs python with -i, which goes on to run standard input after its program'
}

export function pythonImportsWorkingDirRefuseCopy(): string {
  return 'it runs python in a mode that imports from the working directory first (-m, -c or a program on stdin, without -P or -I)'
}

/**
 * leftover `fo` @202254504 — script/payload refuse copies.
 * Unique copy wrap only; not the shebang/payload reader.
 */
export function namesPathRefuseCopy(name: string): string {
  return `it names ${name.replace('"', '')}`
}

export function readsClaudeProjectDirRefuseCopy(): string {
  return 'it reads $CLAUDE_PROJECT_DIR'
}

export function addressesWorkingDirectoryRefuseCopy(): string {
  return 'it addresses its working directory (the launch directory, for a forwarded hook)'
}

export function cshPathWorkingDirRefuseCopy(): string {
  return 'it sets path, which csh ties to PATH, with the working directory (or a relative entry) on it'
}

export function couldNotBeReadAsShellRefuseCopy(): string {
  return 'it could not be read as shell (the reading itself failed on it)'
}

export function includesRelativeBuildFileRefuseCopy(): string {
  return 'it includes another build file, plugin or awk source by a relative name (make include or load, awk @include)'
}

/**
 * leftover `Gt` @202256395 — shell unread refuse copies.
 * New copy function. NOT leftoverUnique `Gt` @202346212 drop-undefined.
 */
export function couldNotBeReadToEndAsShellCopy(reason: string): string {
  return `it could not be read to the end as shell (${reason})`
}

export function shellCodeNestedTooDeepRefuseCopy(): string {
  return 'it hands shell code to a shell more times over than this reading follows'
}

/**
 * leftover `Ei` @202257543 — COPY/reason token wrap only.
 * NOT ySn fleet compositor `Ei`/`Xt`.
 */
export const CLOUD_HOOK_HOLD_REASON = {
  source_in_sync_root: 'source_in_sync_root',
  sync_root_is_config_dir: 'sync_root_is_config_dir',
} as const

export type CloudHookHoldReason =
  (typeof CLOUD_HOOK_HOLD_REASON)[keyof typeof CLOUD_HOOK_HOLD_REASON]

export function cloudHookHoldReasonToken(
  reason: string,
): CloudHookHoldReason | undefined {
  if (
    reason === CLOUD_HOOK_HOLD_REASON.source_in_sync_root ||
    reason === CLOUD_HOOK_HOLD_REASON.sync_root_is_config_dir
  ) {
    return reason
  }
  return undefined
}

/**
 * leftover `Ln`/`Er` @202200073 / @202200160 — unique copy wrap only.
 */
export function cloudHookEventTooLargeCopy(displayName: string): string {
  return `not run — the event was too large to judge on ${displayName}; retry with less`
}

export function cloudHookTooManyInHandCopy(displayName: string): string {
  return `not run — ${displayName} has too many hook requests from the cloud session in hand at once; retry`
}

/**
 * leftover `ot` @202209140–202216814 — fail copies.
 * Unique copy wrap only; not the shell reader.
 */
export function nestsCommandSubstitutionsRefuseCopy(): string {
  return 'it nests command substitutions more deeply than this reading follows'
}

export function arrayAssignmentHoldsNonWordsRefuseCopy(): string {
  return 'an array assignment holds something other than words'
}

export function closingParenClosesNothingRefuseCopy(): string {
  return 'a closing parenthesis that closes nothing'
}

export function caseStatementNeverClosedRefuseCopy(): string {
  return 'a case statement that is never closed'
}

export function arrayAssignmentNeverClosedRefuseCopy(): string {
  return 'an array assignment that is never closed'
}

export function dollarOrParenNeverClosedRefuseCopy(): string {
  return 'a $( or ( that is never closed'
}

export function singleQuoteNeverClosedRefuseCopy(): string {
  return 'a single quote that is never closed'
}

export function ansiQuoteNeverClosedRefuseCopy(): string {
  return "a $' quote that is never closed"
}

export function doubleQuoteNeverClosedRefuseCopy(): string {
  return 'a double quote that is never closed'
}

export function dollarBraceCommandSubstitutionRefuseCopy(): string {
  return 'a ${ …; } command substitution, which this reading does not follow'
}

export function dollarBraceNeverClosedRefuseCopy(): string {
  return 'a ${ that is never closed'
}

export function backtickNeverClosedRefuseCopy(): string {
  return 'a backtick that is never closed'
}

export function heredocNeverTerminatedRefuseCopy(): string {
  return 'a heredoc is never terminated'
}

/**
 * leftover `St` @202224300–202232693 — refuse copies.
 * Unique copy wrap only; not the argv scanner.
 * Twin `it addresses its working directory` stays `addressesWorkingDirectoryRefuseCopy`.
 */
export function unsetsGitHooksOffEnvRefuseCopy(): string {
  return "it unsets the environment that switches git's repository hooks off for this hook"
}

export function unsetsPathWorkingDirLookupRefuseCopy(): string {
  return 'it unsets PATH, after which a command name is looked up in the working directory'
}

export function commandNameBuiltByExpansionRefuseCopy(): string {
  return 'it runs a command whose name is built by an expansion this reading does not perform'
}

export function commandHeldInVariableRefuseCopy(): string {
  return 'it runs a command held in a variable or produced by another command, which this reading cannot follow'
}

export function relativeFilePathRefuseCopy(): string {
  return 'it runs a file by a relative path (looked up in the launch directory)'
}

export function loopsOverFilesInLaunchDirRefuseCopy(name: string): string {
  return `it loops over files in the launch directory (for … in ${name} …)`
}

export function interpreterProgramOnPipeRefuseCopy(): string {
  return 'it runs a shell or interpreter whose program arrives on a pipe, a heredoc or a descriptor, which this reading cannot follow'
}

export function sourcesRelativeFileRefuseCopy(): string {
  return 'it sources a file by a relative name (looked up in the launch directory)'
}

export function unvouchedCommandOrFileRefuseCopy(program: string): string {
  return `it runs ${program} with a command or file this reading cannot follow or vouch for`
}

export function projectToolingReadsCheckoutRefuseCopy(): string {
  return 'it runs project tooling that reads the checkout (make, npm, pytest, cargo…)'
}

export function readsWorkingDirConfigRefuseCopy(program: string): string {
  return `it runs ${program}, which reads configuration from the working directory (the checkout)`
}

export function compoundCommandInputFromLaunchDirRefuseCopy(): string {
  return "it reads a compound command's input from a file in the launch directory"
}

export function relativeScriptNameRefuseCopy(): string {
  return 'it runs a script by a relative name (looked up in the launch directory)'
}

export function perlLibRelativeRefuseCopy(): string {
  return 'it runs perl with -I or the lib pragma naming a relative or in-reach directory, which imports from the working directory'
}

export function rubyLibRelativeRefuseCopy(): string {
  return 'it runs ruby with -I naming a relative or in-reach directory, or -r with a ./ or in-reach path (or bundler/setup, which reads ./Gemfile), which import from the working directory'
}

export function nodePreloadWorkingDirRefuseCopy(): string {
  return 'it runs node with a preload (--require/--import), which resolves from the working directory'
}

export function nodeBareOrRelativeModuleRefuseCopy(): string {
  return 'it runs node code that loads a module by a bare or relative name, which resolves from the working directory'
}

export function luaLoadWorkingDirRefuseCopy(): string {
  return 'it runs lua with -l, which loads from the working directory first'
}

export function unknownInterpreterOptionRefuseCopy(): string {
  return 'it runs an interpreter with an option this reading does not know ahead of its script'
}

export function javaWorkingDirClassPathRefuseCopy(): string {
  return 'it runs java with the working directory on its class path'
}

/**
 * leftover `lo`/`Vt` @202234178–202234870 — unique copy wrap only.
 */
export function wrapsCommandMoreThanFourLayersRefuseCopy(): string {
  return 'it wraps a command in more than four layers of commands that run a command (find -exec, parallel, script, op run, direnv exec…), which this reading does not follow'
}

export function envDashPRelativeDirRefuseCopy(): string {
  return 'it runs env with -P naming a relative directory, where the program is then looked up (the launch directory)'
}

export function parallelNoCommandRefuseCopy(): string {
  return 'it runs parallel with no command of its own, so each line of its input runs as a command'
}

export function scriptNoCommandRefuseCopy(): string {
  return 'it runs script with no command of its own, so the shell it starts reads its commands from its input'
}

export function suNoCommandRefuseCopy(): string {
  return 'it runs su with no command, so the shell it starts reads its commands from its input'
}

export function runuserNoCommandRefuseCopy(): string {
  return 'it runs runuser with no command, so the shell it starts reads its commands from its input'
}

export function sudoDoasNoCommandRefuseCopy(): string {
  return 'it starts a shell through sudo or doas with no command, so that shell reads its commands from its input'
}

/**
 * leftover `ni` @202237032 — pwsh encoded / shell on pipe / from variable.
 * Twin `could not be read to the end as shell` stays `couldNotBeReadToEndAsShellCopy`.
 */
export function pwshEncodedCommandRefuseCopy(): string {
  return 'it hands pwsh an encoded command, which this reading cannot follow'
}

export function shellRcFileFromLaunchDirRefuseCopy(shell: string): string {
  return `it runs ${shell} with an rc file from the launch directory`
}

export function shellProgramOnPipeRefuseCopy(): string {
  return 'it runs a shell whose program arrives on a pipe, a heredoc or a descriptor, which this reading cannot follow'
}

export function shellCommandFromVariableRefuseCopy(): string {
  return 'it hands a shell a command held in a variable or produced by another command, which this reading cannot follow'
}

/**
 * leftover `li` @202241335 — xargs refuse copies.
 */
export function xargsSplicesFromInputRefuseCopy(): string {
  return 'it runs what xargs splices into the command from its input'
}

export function xargsArgsFromLaunchDirFileRefuseCopy(): string {
  return 'it runs xargs with its arguments read from a file in the launch directory'
}

/**
 * leftover `oo` @202248847 — env-assign refuse copies.
 * Unique copy wrap only; not the env argv scanner.
 * Do not collide with `cshPathWorkingDirRefuseCopy`.
 */
export function envAssignWorkingDirRefuseCopy(name: string): string {
  return `it sets ${name} with the working directory (or a relative entry) on it`
}

export function envAssignZshTiedWorkingDirRefuseCopy(name: string): string {
  return `it sets ${name}, which zsh ties to ${name.toUpperCase()}, with the working directory (or a relative entry) on it`
}

export function envAssignPhpIniWorkingDirRefuseCopy(name: string): string {
  return `it sets ${name} to a php.ini location in the working directory (or a relative one)`
}

export function envAssignLoadsNamedRefuseCopy(name: string): string {
  return `it sets ${name}, which makes a shell, an interpreter or git load what it names`
}

export function envAssignToolRunsWorkingDirFileRefuseCopy(
  name: string,
  file: string,
): string {
  return `it sets ${name}, which a tool runs or loads, to a file in the working directory (${file})`
}

export const PHP_INI_SCAN_DIR = 'PHP_INI_SCAN_DIR'

/**
 * leftover `ko` @202260269 — unique `This entry for "` family.
 * Unique copy wrap only; not the 10308 B compositor.
 * Existing `cloudDeviceMarkNotHonouredInCheckoutCopy` stays.
 */
export function cloudHookEntrySkipCopy(entry: string, source: string): string {
  return `This entry for "${entry}" in ${source} is marked cloud: "skip" (or a value this version does not recognise) and stays on this machine.`
}

export function cloudHookEntryDeviceAfterEditCopy(
  entry: string,
  source: string,
): string {
  return `This entry for "${entry}" in ${source} is marked cloud: "device" but runs after a file edit, which this version never forwards; it runs in local sessions only.`
}

export function cloudHookEntryUnreadableAtStartupCopy(
  path: string,
  source: string,
): string {
  const clipped = path.length > 200 ? path.slice(0, 200) : path
  return `This entry for ${clipped} in ${source} could not be read and pinned at start-up (missing, too large, not a regular file, more than one hard link, or it resolves to a file this machine does not read as a hook script), so it is not offered to the cloud session.`
}

export function cloudHookEntryInReachCopy(
  entry: string,
  source: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} sits where the cloud session can write on this machine (the checkout, the synced directory or a sandbox write inlet), so it is not offered to the cloud session. Move the script outside the checkout (under ~/.claude, say) to have it forwarded; marking it cloud: "device" instead runs it for cloud sessions from this path — the entry file is pinned, but anything it loads from the checkout is whatever the session last wrote there, run on this machine outside the sandbox.${suffix}`
}

export function cloudHookEntryInterpreterUnvouchedCopy(
  entry: string,
  source: string,
  interpreter: string,
  why: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} runs its script with ${interpreter}, which ${why}, so it is not offered to the cloud session. Run it with an interpreter this version knows (such as bash, python3 or node), found on your PATH (#!/usr/bin/env python3) or named by a full path outside what the session can write, with no options or only simple switches this version knows (bash -eu, python3 -I); marking it cloud: "device" instead runs it as written.${suffix}`
}

export function cloudHookEntryLoadsFromReachCopy(
  entry: string,
  source: string,
  what: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} is a script outside the checkout, but ${what} — code or data the cloud session can write — so it is not offered to the cloud session. Marking it cloud: "device" runs it anyway (you vouch for what it loads); otherwise have it load its helpers by an absolute path outside the checkout.${suffix}`
}

export function cloudHookEntryDeviceScriptChangedCopy(
  entry: string,
  source: string,
): string {
  return `This entry for "${entry}" in ${source} is marked cloud: "device" and its script, which sits where the cloud session can write, changed since this session pinned it; it is not offered again until you relaunch claude --cloud — review the file first, since the cloud session may have written it.`
}

export function cloudHookEntryShellPrefixCopy(
  entry: string,
  source: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} would run wrapped in your CLAUDE_CODE_SHELL_PREFIX, so this machine cannot pin what actually runs and it is not offered to the cloud session. Marking it cloud: "device" runs it for cloud sessions anyway (through the prefix when that names an absolute wrapper outside what the session can write; without it otherwise).${suffix}`
}

export function cloudHookEntryPrivateDotdirCopy(
  entry: string,
  source: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} names a script under a dot-directory this feature never reads or pins (of those, only ~/.claude and ~/.config are), so it is not offered to the cloud session. Move the script to one of those, or elsewhere outside the checkout, to have it forwarded; marking it cloud: "device" instead runs the command as written for cloud sessions, unpinned.${suffix}`
}

export function cloudHookEntryUnpinnedCommandCopy(
  entry: string,
  source: string,
  suffix = '',
): string {
  return `This entry for "${entry}" in ${source} is not a single script this machine can pin, so it is not offered to the cloud session. Point it at one script outside the checkout (under ~/.claude, say) to have it forwarded; marking it cloud: "device" instead runs the command as written for cloud sessions — nothing is pinned, so whatever it names in the checkout is whatever the session last wrote there, run on this machine outside the sandbox.${suffix}`
}

/**
 * leftover `ko` @202260269 unique copy family (after-edit / not-run-in-cloud /
 * interpreter voucher). Unique copy wrap only — not the 10308 B compositor.
 */
export function cloudHookAfterEditNotForwardedCopy(name: string): string {
  return `${name} is an after-edit hook, so it is not forwarded either: it does not run for this cloud session, only in local ones.`
}

export function cloudHookNotRunInCloudAfterEditCopy(name: string): string {
  return `${name} is not run in the cloud in this version, and as an after-edit hook it is not forwarded either, so it only runs in local sessions.`
}

export function cloudHookNotRunInCloudCopy(name: string): string {
  return `${name} is not run in the cloud in this version; it runs on this machine instead.`
}

export function cloudHookConfiguredOnEventsCopy(
  name: string,
  source: string,
  events: string,
): string {
  return `${name} is configured on ${source}; the cloud runs it only on ${events}, so it runs on this machine instead.`
}

export const INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV =
  'cannot be vouched for from here (a relative interpreter or one spelled with "..", env with options, or a #! line that hands the interpreter a file of its own)'

export const INTERPRETER_SANDBOX_WRITE_INLET_COVERS =
  'sits where the cloud session can write on this machine (a sandbox write inlet covers it)'

export const INTERPRETER_IT_NAMES = 'the interpreter it names'

export const INTERPRETER_HASHBANG_NAMES = 'the interpreter its #! line names'

export const INTERPRETER_CANNOT_BE_LOCATED = 'cannot be located on this machine'

/** leftover `ko` @202260269 unique interpreter voucher fragment. */
export const INTERPRETER_MAY_LOAD_FROM_CHECKOUT =
  'may load settings or code from the checkout, where the hook starts and which the cloud session can write (bun, tsx, lua and Rscript without --vanilla can; an interpreter or an option this version does not know might)'

/** gold leftover `ko` `po(...,{maxCodeUnits:200})` — ASCII matcher clip. */
function leftoverMatcherClip(matcher: string): string {
  return matcher.length <= 200 ? matcher : matcher.slice(0, 200)
}

/** leftover `ko` @202260269 unique copy — older local vs cloud id. */
export function cloudHookOlderCopyNotRunCopy(
  filename: string,
  id: string,
): string {
  return `${filename} is an older copy of ${id}; the cloud will not run it. Update it from dotfiles.`
}

export function cloudHookOlderCopyCloudRunsCopy(
  filename: string,
  id: string,
): string {
  return `${filename} is an older copy of ${id}; the cloud will run that copy. Update it from dotfiles to get fixes.`
}

export function cloudHookCannotReproduceCopy(filename: string): string {
  return `${filename} is run in a way the cloud cannot reproduce (arguments, a condition, async or once), so it runs on this machine instead.`
}

export function cloudHookMatcherRunsOnCopy(
  filename: string,
  matcher: string,
  cloudMatcher: string,
): string {
  return `${filename} is configured with the matcher "${leftoverMatcherClip(matcher)}" and the cloud runs it on "${cloudMatcher}", so it runs on this machine instead.`
}

export function cloudHookMatcherCloudOnlyCopy(
  filename: string,
  matcher: string,
  cloudMatcher: string,
): string {
  return `${filename} is configured with the matcher "${leftoverMatcherClip(matcher)}"; in the cloud it runs on "${cloudMatcher}" only.`
}

export function cloudHookCannotMoveCopy(filename: string): string {
  return `${filename} cannot move to the cloud here.`
}

/**
 * leftover `ko` @202260269 — gold
 * `${(A??`${W.filename} cannot move to the cloud here.`).replace(/(?:, so|; it) (?:it )?runs on this machine instead\.$/,".").replace(/\.$/,"")}, and as an after-edit hook it is not forwarded either: it runs in local sessions only.`
 */
export function cloudHookCannotMoveAfterEditCopy(
  filename: string,
  reason?: string,
): string {
  const A = reason ?? `${filename} cannot move to the cloud here.`
  const trimmed = A.replace(
    /(?:, so|; it) (?:it )?runs on this machine instead\.$/,
    '.',
  ).replace(/\.$/, '')
  return `${trimmed}, and as an after-edit hook it is not forwarded either: it runs in local sessions only.`
}

export function cloudHookPatternMatcherLocalOnlyCopy(
  name: string,
  matcher: string,
): string {
  return `"${name}" is configured with the pattern matcher "${leftoverMatcherClip(matcher)}", which a cloud session cannot take, so it is not offered to it and runs in local sessions only. Use a plain list such as Edit|Write for it to run for cloud sessions too.`
}

/**
 * leftover `ko` @202260269 unique reason tokens (copy/reason wrap only).
 * `after_edit` / `kind_unsupported` already exist on heldCounts.
 */
export const CLOUD_HOOK_ENTRY_REASON = {
  after_edit: 'after_edit',
  author_skip: 'author_skip',
  container_internal: 'container_internal',
  in_reach: 'in_reach',
  interpreter_unvouched: 'interpreter_unvouched',
  kind_unsupported: 'kind_unsupported',
  loads_from_reach: 'loads_from_reach',
  private_dotdir: 'private_dotdir',
  script_in_reach: 'script_in_reach',
  script_outside_reach: 'script_outside_reach',
  shell_prefix: 'shell_prefix',
  unpinned_command: 'unpinned_command',
  unverifiable_target: 'unverifiable_target',
} as const

export type CloudHookEntryReason =
  (typeof CLOUD_HOOK_ENTRY_REASON)[keyof typeof CLOUD_HOOK_ENTRY_REASON]

export function cloudHookEntryReasonToken(
  reason: string,
): CloudHookEntryReason | undefined {
  if (
    Object.values(CLOUD_HOOK_ENTRY_REASON).includes(
      reason as CloudHookEntryReason,
    )
  ) {
    return reason as CloudHookEntryReason
  }
  return undefined
}

/** gold leftover unique `M` — unique, order-preserving. */
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * gold leftover unique `ECe` @181500293 — foreign → spelling; else volume roots.
 * No windows drive-letter laptop FS engine: non-foreign is `['/']`.
 */
export function extraReachVolumeRoots(
  judgement: ExtraReachJudgement,
  _launchDir: string,
): string[] {
  if (judgement.verdict === 'foreign') return [judgement.spelling]
  return ['/']
}

/**
 * gold leftover unique extraReachRoots map inside `ySn`:
 * `local` → `[A, real]`; `foreign` → `[L.spelling]`; else `[A, ...ECe]`.
 */
export async function mapExtraReachRoot(
  spelling: string,
  opts: {
    launchDir: string
    realpath: (path: string) => Promise<string>
    judge: (path: string, launchDir: string) => Promise<ExtraReachJudgement>
  },
): Promise<string[]> {
  const judged = await opts.judge(spelling, opts.launchDir)
  if (judged.verdict === 'local') {
    return [spelling, await opts.realpath(judged.spelling)]
  }
  if (judged.verdict === 'foreign') {
    return [judged.spelling]
  }
  return [spelling, ...extraReachVolumeRoots(judged, opts.launchDir)]
}

/**
 * gold leftover unique `ySn` roots bag @202270861 — launchDirReal / extraReach.
 */
export async function composeExtraReachBag(opts: {
  launchDir: string
  projectDir: string
  configHome: string
  repoRoot?: string
  extraReachRoots?: string[]
  realpath: (path: string) => Promise<string>
  judge?: (path: string, launchDir: string) => Promise<ExtraReachJudgement>
}): Promise<ExtraReachBag> {
  const judge =
    opts.judge ??
    (async (path: string): Promise<ExtraReachJudgement> => ({
      spelling: path,
      verdict: 'local',
    }))
  const extraReach = uniqueStrings(
    (
      await Promise.all(
        [
          ...(opts.repoRoot !== undefined ? [opts.repoRoot] : []),
          ...(opts.extraReachRoots ?? []),
        ].map(root =>
          mapExtraReachRoot(root, {
            launchDir: opts.launchDir,
            realpath: opts.realpath,
            judge,
          }),
        ),
      )
    ).flat(),
  )
  return {
    launchDirReal: await opts.realpath(opts.launchDir),
    projectDirReal: await opts.realpath(opts.projectDir),
    configHomeReal: await opts.realpath(opts.configHome),
    extraReach,
  }
}

/**
 * gold leftover unique `ySn` `tI` gate — launch/config/sync/extraReachRoots
 * must be placeable absolute paths.
 */
export function extraReachHasUnplaceableRoot(opts: {
  launchDir?: string
  configHome?: string
  sync?: { rootReal?: string; root?: string }
  extraReachRoots?: string[]
}): boolean {
  return [
    opts.launchDir,
    opts.configHome,
    opts.sync?.rootReal,
    opts.sync?.root,
    ...(opts.extraReachRoots ?? []),
  ].some(path => path !== undefined && !isPlaceableAbsolutePath(path))
}

/**
 * gold leftover unique `ySn` wrap: empty pack, extraReach bag, unplaceable notice.
 * Additive `entries` calls leftover `ko` classifier (`classifyCloudHookEntry`).
 * `sources`/`sites` wrap leftover `Ei` + over_cap / after_edit / kind_unsupported
 * / `vo` / `Hi` copies. Bag-only callers omit `entries` — no Xt fleet WS.
 */
export async function composeExtraReachForCloudHooks(opts: {
  kind: 'none' | string
  launchDir: string
  projectDir: string
  configHome: string
  repoRoot?: string
  extraReachRoots?: string[]
  sync?: { rootReal?: string; root?: string }
  realpath: (path: string) => Promise<string>
  judge?: (path: string, launchDir: string) => Promise<ExtraReachJudgement>
  entries?: import('./leftoverCloudHookOffer.js').CloudHookOfferEntry[]
  offer?: import('./leftoverCloudHookOffer.js').CloudHookOfferContext
  sources?: CloudHookComposeSource[]
  defaultShell?: string
}): Promise<{ pack: CloudHooksEmptyPack; roots?: ExtraReachBag }> {
  const pack = emptyCloudHooksPack()
  if (opts.kind === 'none') return { pack }
  const roots = await composeExtraReachBag(opts)
  const seen = new Set<string>()
  const identity = new Set<string>()
  const defaultShell = opts.defaultShell ?? 'bash'
  const note = (notice: string | undefined) => {
    if (notice === undefined || seen.has(notice)) return
    seen.add(notice)
    pack.notices.push(notice)
  }
  const takeIdentity = (site: CloudHookComposeSite): boolean => {
    if (site.hook === undefined) return true
    const key = cloudHookIdentityKey(site, site.hook, defaultShell)
    if (identity.has(key)) {
      if (site.templateId !== undefined)
        note(duplicateHookConfiguredOnceCopy(site.templateId))
      else if (
        site.hook.command !== undefined &&
        site.templateId !== undefined
      ) {
        note(duplicateCloudScriptCopy(site.hook.command, site.templateId))
      } else if (site.hook.command !== undefined) {
        note(duplicateHookConfiguredOnceCopy(site.hook.command))
      }
      holdCloudHookSite(pack, site, 'duplicate')
      return false
    }
    identity.add(key)
    return true
  }
  if (extraReachHasUnplaceableRoot(opts)) {
    note(HOOKS_STAY_UNPLACEABLE_COPY)
    pack.heldCounts.other += 1
    pack.held.push({ reason: CLOUD_HOOK_UNVERIFIABLE_TARGET })
    if (opts.sources) {
      for (const source of opts.sources) {
        for (const site of source.sites ?? []) {
          holdCloudHookSite(pack, site, CLOUD_HOOK_UNVERIFIABLE_TARGET)
        }
      }
      return { pack, roots }
    }
  }
  if (opts.entries !== undefined) {
    const { classifyCloudHookEntry, foldCloudHookOffer } = await import(
      './leftoverCloudHookOffer.js'
    )
    const offer = opts.offer ?? {
      opts: { launchDir: opts.launchDir },
      deps: { realpath: opts.realpath },
      reach: { launchDir: opts.launchDir, extraReach: roots.extraReach },
      seams: { realpath: opts.realpath },
    }
    for (const entry of opts.entries) {
      foldCloudHookOffer(pack, await classifyCloudHookEntry(entry, offer))
    }
  }
  if (opts.sources) {
    const eventCounts = new Map<string, number>()
    const holdCtx: SettingsFileHoldContext = {
      opts: {
        sync: opts.sync,
        launchDir: opts.launchDir,
        configHome: opts.configHome,
      },
      roots: {
        extraReach: roots.extraReach,
        configHomeReal: roots.configHomeReal,
      },
      deps: { realpath: opts.realpath },
      judge: opts.judge,
    }
    for (const source of opts.sources) {
      const fileHold = await holdReasonForSettingsFileVsSyncRoot(
        { settingsFile: source.settingsFile },
        holdCtx,
      )
      const sites = source.sites ?? []
      if (fileHold !== null && sites.length > 0 && source.settingsFile) {
        note(cloudHooksNotOfferedFromFileCopy(source.settingsFile, fileHold))
      }
      for (const site of sites) {
        if (fileHold !== null) {
          const reason = site.holdReason
          holdCloudHookSite(
            pack,
            site,
            reason !== undefined &&
              (reason.startsWith('event_') ||
                reason === 'kind_unsupported' ||
                reason === 'after_edit')
              ? reason
              : fileHold,
          )
          continue
        }
        if (site.offer === 'held' || site.holdReason !== undefined) {
          note(site.notice)
          holdCloudHookSite(pack, site, site.holdReason ?? 'other')
          continue
        }
        if (site.offer === 'template') {
          if (pack.templates.length >= CLOUD_HOOK_TEMPLATE_CAP) {
            holdCloudHookSite(pack, site, 'over_cap')
            note(cloudHookTemplatesOverCapCopy(CLOUD_HOOK_TEMPLATE_CAP))
            continue
          }
          if (!takeIdentity(site)) continue
          pack.templates.push(site)
          if (site.templateId !== undefined) {
            note(duplicateHookConfiguredOnceCopy(site.templateId))
          }
          note(site.notice)
          continue
        }
        const eventCount = eventCounts.get(site.event) ?? 0
        const underEvent = eventCount < CLOUD_HOOK_PER_EVENT_CAP
        if (pack.forwarded.length >= CLOUD_HOOK_FORWARDED_CAP) {
          holdCloudHookSite(pack, site, 'over_cap')
          note(cloudHooksOfferedOverCapCopy(CLOUD_HOOK_FORWARDED_CAP))
          continue
        }
        if (!underEvent) {
          holdCloudHookSite(pack, site, 'over_cap')
          note(cloudHooksEventOverCapCopy(CLOUD_HOOK_PER_EVENT_CAP, site.event))
          continue
        }
        if (!takeIdentity(site)) continue
        eventCounts.set(site.event, eventCount + 1)
        note(site.notice)
        pack.forwarded.push(site)
      }
    }
  }
  const couldRun = pack.forwarded.length + pack.templates.length
  if (couldRun > 0) note(hooksCouldRunForCloudCopy(couldRun))
  return { pack, roots }
}

/**
 * leftover argv scanners — gold `pi`/`gi`/`ro`/`fo`/`Gt`/`oo`/`Ei` BODIES
 * wrapping the copy helpers above. Tokenize as `{text}` like gold.
 * Minify names are comments only.
 */

/** gold leftover argv token */
export type ArgvToken = {
  text: string
  quoted?: boolean
  raw?: string
  expands?: boolean
}

export type ShellRedirect = { op: string; target: ArgvToken }

export type ShellCommand = {
  program: ArgvToken
  args: ArgvToken[]
  assignments: ArgvToken[]
  redirects?: ShellRedirect[]
  heredoc?: string
  piped?: boolean
}

export type ShellScanContext = {
  roots: string[]
  home: string
  fromPayload?: boolean
  standing?: string[]
  relativeNames?: Set<string>
  shell?: string
  make?: boolean
  nesting?: number
}

export type ShellParseResult = {
  commands: ShellCommand[]
  unreadable: string | null
}

export type CloudHookComposeSite = {
  event: string
  matcher?: string
  source: { source: string }
  hook?: {
    type?: string
    command?: string
    shell?: string
    args?: unknown
    url?: string
    if?: string
  }
  offer?: 'forward' | 'template' | 'held'
  holdReason?: string
  notice?: string
  templateId?: string
}

export type CloudHookComposeSource = {
  settingsFile: string | null
  sites?: CloudHookComposeSite[]
}

export type SettingsFileHoldContext = {
  opts: {
    sync?: { rootReal?: string; root?: string }
    launchDir: string
    configHome?: string
  }
  roots: {
    extraReach: string[]
    configHomeReal?: string
  }
  deps: {
    realpath: (path: string) => Promise<string>
  }
  judge?: (path: string, launchDir: string) => Promise<ExtraReachJudgement>
  platform?: string
}

export function tokenizeArgv(argv: readonly string[]): ArgvToken[] {
  return argv.map(text => ({ text }))
}

/** leftover `ui` @202247441 */
const INTERPRETER_FLAG_ONLY: Record<string, RegExp> = {
  python: /^-[bBdEhiIOPqRsSuvVxE]+$|^--(?:version|help)$/,
  pypy: /^-[bBdEhiIOqRsSuvVx]+$/,
  node: /^--(?:enable-source-maps|no-warnings|no-deprecation|throw-deprecation|trace-warnings|trace-deprecation|pending-deprecation|experimental-strip-types|expose-gc|no-addons|preserve-symlinks|frozen-intrinsics|disallow-code-generation-from-strings|jitless|version|help)$|^-[civ]$/,
  ruby: /^-[acdhlnpsSTUvwWy0]+$|^--[a-z][a-z-]*$/,
  perl: /^-(?:[acfgnpsStTuUvwWX]|l[0-7]*|0[0-7]*|i\S*)+$/,
  osascript: /^-i$/,
  rscript: /^--[a-z][a-z-]*$/,
  php: /^-[aeHilmnqsvw]+$|^--[a-z-]+$/,
  lua: /^-[ivEW]$/,
  tsx: /^--[a-z][a-z0-9-]*$/,
  'ts-node': /^--[a-zA-Z][a-zA-Z0-9-]*$|^-[hvT]$/,
  bb: /^--?[a-z][a-z-]*$/,
}

/** leftover `eo` @202221644 — php takes-value flags for leftover `ze`. */
const INTERPRETER_VALUE_FLAGS: Record<string, Set<string>> = {
  python: new Set(['-W', '-X', '--check-hash-based-pycs']),
  pypy: new Set(['-W', '-X']),
  php: new Set([
    '-r',
    '-d',
    '--define',
    '-c',
    '--php-ini',
    '-B',
    '-R',
    '-F',
    '-E',
    '-z',
    '--zend-extension',
    '-f',
    '--file',
  ]),
}

/** leftover `mi` @202251646 */
const PHP_DANGEROUS_DEFINE =
  /^(?:auto_prepend_file|auto_append_file|include_path|extension_dir|(?:zend_)?extension|opcache\.(?:preload|file_cache)|ffi\.preload|phar\.cache_list|sendmail_path|sqlite3\.extension_dir)$/

/** leftover `GMe` @181509715 */
const PATHLIKE_ENV_NAMES = [
  'PATH',
  'PYTHONPATH',
  'NODE_PATH',
  'RUBYLIB',
  'PERL5LIB',
  'PERLLIB',
  'GEM_PATH',
  'CLASSPATH',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'LD_LIBRARY_PATH',
  'LIBRARY_PATH',
  'CPATH',
  'C_INCLUDE_PATH',
  'CPLUS_INCLUDE_PATH',
  'R_LIBS',
  'R_LIBS_USER',
  'R_LIBS_SITE',
]

/** leftover `Wr` @202217695 */
const TOOL_ENV_NAMES = new Set([
  'DEVELOPER_DIR',
  'MAKEFILES',
  'MAKEFLAGS',
  'GNUMAKEFLAGS',
  'AWKPATH',
  'AWKLIBPATH',
  'GOFLAGS',
  'RUSTFLAGS',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_EXTERNAL_DIFF',
  'GIT_PROXY_COMMAND',
  'SUDO_ASKPASS',
  'ZDOTDIR',
  'CDPATH',
  'GCONV_PATH',
  'NLSPATH',
  'DOTNET_STARTUP_HOOKS',
  'npm_config_node_options',
  'NPM_CONFIG_NODE_OPTIONS',
  'LESSOPEN',
  'LESSCLOSE',
  'MANPAGER',
  'MAVEN_OPTS',
  'GRADLE_OPTS',
  'OPENSSL_ENGINES',
  'SHELLOPTS',
  'BASHOPTS',
  'PS4',
  'PROMPT_COMMAND',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_EXEC_PATH',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_PAGER',
  'PAGER',
  'EDITOR',
  'VISUAL',
  'BROWSER',
  'PYTHONWARNINGS',
  'PYTHONBREAKPOINT',
  'PERL5DB',
  'NODE_REPL_EXTERNAL_MODULE',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'NODE_OPTIONS',
  'NODE_COMPILE_CACHE',
  'PYTHONSTARTUP',
  'PYTHONHOME',
  'PYTHONUSERBASE',
  'BASH_ENV',
  'ENV',
  'PERL5OPT',
  'RUBYOPT',
  'GEM_HOME',
  'RUBYGEMS_GEMDEPS',
  'BUNDLE_GEMFILE',
  'OPENSSL_CONF',
  'OPENSSL_MODULES',
  'DYLD_INSERT_LIBRARIES',
  'LD_PRELOAD',
  'LD_AUDIT',
])

/** leftover `Fr` @202218642 */
const TOOL_ENV_PREFIX = /^(?:DYLD_|LD_|BASH_FUNC_|GIT_CONFIG_|LUA_C?PATH)/
/** leftover `jr` @202218696 */
const TOOL_ENV_SPECIAL =
  /^(?:GH_BROWSER|RSYNC_RSH|CVS_RSH|SOPS_GPG_EXEC|PERL5SHELL|RUBYSHELL|JAVACMD|CLOUDSDK_PYTHON|UV_PYTHON|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|npm_config_script_shell|NPM_CONFIG_SCRIPT_SHELL|R_(?:PROFILE|ENVIRON)(?:_USER)?|TAR_OPTIONS|BUN_OPTIONS|TF_CLI_ARGS\w*|CARGO_ALIAS_\w+|[A-Z0-9][A-Z0-9_]*_(?:EXTERNAL_DIFF|PAGER|EDITOR))$/
/** leftover `Ur` @202219028 */
const RELATIVE_TOOL_FILE =
  /^(?![/~$-])(?:[^\s]*\/[^\s]*|[^\s/]+\.(?:sh|bash|zsh|fish|py|rb|pl|js|mjs|cjs|ts|php|lua|R|r|ps1|awk|tcl|exs?|jl))$/
/** leftover `Xr` @202222777 */
const PYTHON_C_IMPORTS = /\bimport\b|__import__|\bexec\b/
/** leftover `Gr` @202219780 */
const SHELL_BASENAME =
  /^(?:bash|sh|zsh|dash|ash|(?:pd|lo|o|m|r)?ksh[0-9]*|rbash|fish|csh|tcsh|yash|posh|[oy]sh)$/i
/** leftover `Ft`/`wi`/`ki`/`yi` @202253988 */
const MAKE_OR_AWK = /^(?:[gbp]|gnu)?(?:make|[gnm]?awk)$/i
const MAKE_INCLUDE_LINE =
  /^[ \t]*-?(?:s?include|load)[ \t]+(?!=)([^\n]*)$|^[ \t]*\.[ \t]*[ds-]?include[ \t]*("[^\n]*)$|^[ \t]*@(?:include|load)[ \t]*("[^\n]*)$/gm
const CLAUDE_PROJECT_DIR_RE = /\bCLAUDE_PROJECT_DIR\b/i
const HASH_COMMENT_LINE = /^[ \t]*#.*$/gm
/** leftover `zr`/`Br` @202219563 */
const RELATIVE_CWD_ADDR =
  /(?:^|[\s"'=(`:;&|<>])\.\.?\/|\bprocess\.cwd\(\)|\bos\.getcwd\(\)|\bPath\.cwd\(\)|\bDir\.pwd\b|\bgit\b[^\n]{0,12}\brev-parse\b[^\n]{0,6}--show-toplevel\b/im
const PWD_ADDR = /\$PWD\b|\$\{PWD\b|\$\(pwd(?:[ \t]+-[LP])?\)|`pwd`/im

/** leftover `Pe` @202235524 */
function isVouchedPath(path: string): boolean {
  return /^[/~$]/.test(path) && !/^~[+-]/.test(path) && path !== ''
}

/** leftover `qr` @202219151 */
function envNameLoadsWhatItNames(name: string): boolean {
  return TOOL_ENV_NAMES.has(name) || TOOL_ENV_PREFIX.test(name)
}

/** leftover `io` @202219195 */
function splitCshPathWords(value: string): string[] {
  return (value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map(n =>
    n.replace(/["']/g, ''),
  )
}

/** leftover `zc` @181015105 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** leftover `Rd` @181365304 — posix identity; no macos NFD laptop FS. */
function posixPathText(path: string): string {
  return path
}

/** leftover `RU` @181364035 posix branch */
function pathIsUnder(child: string, root: string): boolean {
  const r = root.length > 1 && root.endsWith('/') ? root.slice(0, -1) : root
  return child === r || child.startsWith(r === '/' ? '/' : `${r}/`)
}

/** leftover `vt` @202235590 */
function takeFlagValue(
  argv: ArgvToken[],
  attached: string,
  index: number,
): { value: string; tildeLiteral: boolean } {
  return attached !== ''
    ? { value: attached, tildeLiteral: true }
    : {
        value: argv[index + 1]?.text ?? '',
        tildeLiteral: argv[index + 1]?.quoted ?? false,
      }
}

/** leftover `rt` @202235991 — in-reach name, posix. */
function tokenNamesReach(token: ArgvToken, ctx: ShellScanContext): boolean {
  if (ctx.roots.length === 0) return false
  let path = token.text
  if (/^\$(?:HOME|\{HOME\})(?=\/|$)/.test(path)) {
    path = ctx.home + path.replace(/^\$(?:HOME|\{HOME\})/, '')
  } else if (/^~[A-Za-z0-9._-]*(?=\/|$)/.test(path)) {
    path = ctx.home + path.replace(/^~[A-Za-z0-9._-]*/, '')
  }
  if (!path.startsWith('/')) return false
  return ctx.roots.some(root => pathIsUnder(path, root))
}

/** leftover `it` @202235706 */
function valueLoadsRelativeOrReach(
  taken: { value: string; tildeLiteral: boolean },
  ctx: ShellScanContext,
): boolean {
  const { value, tildeLiteral } = taken
  return (
    (tildeLiteral && value.startsWith('~')) ||
    !isVouchedPath(value) ||
    (ctx.make === true && /^\$[({](?:CURDIR|PWD)[)}]/.test(value)) ||
    tokenNamesReach({ text: value, quoted: false, raw: value }, ctx)
  )
}

/** leftover `Bt` @202222312 */
function isEvalStyleFlag(interpreter: string, flag: string): boolean {
  switch (interpreter) {
    case 'node':
    case 'nodejs':
    case 'tsx':
    case 'ts-node':
      return (
        /^(?:-e|--eval|-p|--print)$/.test(flag) || /^-[a-zA-Z]*[ep]$/.test(flag)
      )
    case 'python':
    case 'pypy':
      return /^-[bBdEhiIOPqRsSuvVx]*[cm]/.test(flag)
    case 'perl':
      return /^-[acfgnpsStTuUwWXl0-9]*[eE]$/.test(flag)
    case 'ruby':
      return /^-[acdhlnpsSUvwy]*e$/.test(flag)
    case 'php':
      return /^-[aeHilmnqsvw]*[rRBE]$/.test(flag)
    case 'lua':
    case 'bb':
    case 'osascript':
    case 'rscript':
    case 'erb':
      return flag === '-e'
    default:
      return false
  }
}

/** leftover `Le` @202235864 */
function isStdinLikeToken(token: ArgvToken | undefined): boolean {
  return (
    token !== undefined &&
    /^(?:\/dev\/(?:stdin|fd\/\d+)|\/proc\/(?:self|\d+)\/fd\/\d+|-|[<>]\(…\))$/.test(
      token.text,
    )
  )
}

/** leftover `ze` @202246416 */
function findInterpreterProgram(
  interpreter: string,
  argv: ArgvToken[],
): ArgvToken | 'unknown_option' | undefined {
  if (interpreter === 'deno') {
    return argv[0]?.text === 'run'
      ? argv.slice(1).find(h => !h.text.startsWith('-'))
      : undefined
  }
  if (interpreter === 'php') {
    const takes = INTERPRETER_VALUE_FLAGS.php
    for (let g = 0; g < argv.length; g += 1) {
      const v = argv[g].text
      const w = /^(?:-[fF]|--file)(?:=?([\s\S]+))?$/.exec(v)
      if (w !== null) {
        return w[1] !== undefined ? { ...argv[g], text: w[1] } : argv[g + 1]
      }
      if (!v.startsWith('-') || v === '-' || v === '--') break
      if (takes.has(v)) g += 1
    }
  }
  if (/^(?:[gnm]?awk|g?sed)$/.test(interpreter)) {
    const awk = interpreter.endsWith('awk')
    const g = awk ? /^-[a-zA-Z]*[fE]$/ : /^-[a-zA-Z]*f$/
    const v = awk ? /^-[fE]./ : /^-f./
    for (let w = 0; w < argv.length; w += 1) {
      const b = argv[w].text
      if (g.test(b)) return argv[w + 1]
      if (v.test(b)) return { ...argv[w], text: b.slice(2) }
      if (b.startsWith('--file=')) return { ...argv[w], text: b.slice(7) }
    }
    return
  }
  const takes = INTERPRETER_VALUE_FLAGS[interpreter] ?? new Set<string>()
  let unknown = false
  for (let h = 0; h < argv.length; h += 1) {
    const g = argv[h].text
    if (g === '--') return argv[h + 1]
    if (g === '-' || !g.startsWith('-')) {
      return g === '-' ? argv[h] : unknown ? 'unknown_option' : argv[h]
    }
    if (isEvalStyleFlag(interpreter, g)) return
    if (takes.has(g)) {
      h += 1
      continue
    }
    if (
      [...takes].some(v => v.length === 2 && g.length > 2 && g.startsWith(v))
    ) {
      continue
    }
    if (g.startsWith('--') && g.includes('=')) continue
    if (!INTERPRETER_FLAG_ONLY[interpreter]?.test(g)) unknown = true
  }
  return
}

/** leftover `jt` @202254174 */
function shebangProgramBasename(line: string): string {
  const n = line.trim().split(/[ \t]+/)
  let r = 0
  if (/(?:^|\/)env$/.test(n[0] ?? '')) {
    r = 1
    while (
      r < n.length &&
      (n[r].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(n[r]))
    ) {
      r += /^-[A-Za-z]*[PuC]$|^--(?:unset|chdir)$/.test(n[r]) ? 2 : 1
    }
  }
  const s = n[r] ?? ''
  return s.slice(s.lastIndexOf('/') + 1)
}

/** leftover `Vr` @202219296 */
function pathNameSpellings(path: string, home: string): string[] {
  const r = path.replace(/\/+$/, '')
  if (!r.startsWith('/') || r === '') return []
  const s =
    home !== '' && home !== '/' && (r === home || r.startsWith(`${home}/`))
      ? r.slice(home.length)
      : null
  const h = s === '' ? '/' : s
  return s === null
    ? [r]
    : [r, `~${h}`, `$HOME${h}`, `$HOME"${h}`, `\${HOME}${h}`, `\${HOME}"${h}`]
}

/** leftover `Si` @202255967 */
function makeIncludesRelative(text: string): boolean {
  for (const n of text.matchAll(MAKE_INCLUDE_LINE)) {
    const r = (n[1] ?? n[2] ?? n[3] ?? '')
      .trim()
      .replace(/^"|"$/g, '')
      .split(/[ \t]+/)
      .filter(Boolean)
    if (
      r.length === 0 ||
      r.some(s => !/^(?:\/|~\/|\$\(HOME\)|\$\{HOME\}|"\/|'\/|<)/.test(s))
    ) {
      return true
    }
  }
  return false
}

function payloadUtf8(payload: string | Uint8Array): string {
  if (typeof payload === 'string') return payload
  const bytes = Array.from(payload)
  if (bytes.includes(0)) {
    return Buffer.from(bytes.filter(j => j !== 0)).toString('utf8')
  }
  return Buffer.from(payload).toString('utf8')
}

function defaultParseShell(text: string): ShellParseResult {
  const commands: ShellCommand[] = []
  for (const line of text.split(/[\n;]/)) {
    const parts = line.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue
    const assignments: ArgvToken[] = []
    let i = 0
    while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i])) {
      assignments.push({ text: parts[i] })
      i += 1
    }
    if (i >= parts.length) {
      if (assignments.length > 0) {
        commands.push({
          program: { text: 'export' },
          args: [],
          assignments,
        })
      }
      continue
    }
    commands.push({
      program: { text: parts[i] },
      args: parts.slice(i + 1).map(text => ({ text })),
      assignments,
    })
  }
  return { commands, unreadable: null }
}

/**
 * leftover `oo` @202248847 BODY 1235 B — env-assign scanner.
 * Returns existing envAssign* copy helpers.
 */
export function envAssignArgvRefuse(
  tokens: ArgvToken[],
  zshTied = false,
): string | undefined {
  for (const r of tokens) {
    const s = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=([\s\S]*)$/.exec(
      r.text,
    )
    if (s === null) continue
    const h = s[1]
    const g = s[2]
    const v = (b: string) =>
      b === '.' || !/^[/~$]/.test(b) || /^~[+-]|^\$\{?PWD\b|^\$\(/.test(b)
    const w = (b: string) =>
      /^\$/.test(b) && !new RegExp(`^\\$\\{?(?:${h}|HOME|PATH)\\b`).test(b)
    if (PATHLIKE_ENV_NAMES.includes(h)) {
      if (g.split(':').some(b => v(b) || w(b))) {
        return envAssignWorkingDirRefuseCopy(h)
      }
    } else if (zshTied && /^(?:path|fpath|manpath|cdpath)$/.test(h)) {
      const b = /^\(([\s\S]*)\)$/.exec(g)?.[1]
      if ((b === undefined ? [g] : splitCshPathWords(b)).some(v)) {
        return envAssignZshTiedWorkingDirRefuseCopy(h)
      }
    } else if (h === 'PHPRC' || h === PHP_INI_SCAN_DIR) {
      const b = h === 'PHPRC' ? [g] : g.split(':').filter(R => R !== '')
      if (g !== '' && b.some(v)) return envAssignPhpIniWorkingDirRefuseCopy(h)
    } else if (
      envNameLoadsWhatItNames(h) ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM)$/.test(
        h,
      )
    ) {
      return envAssignLoadsNamedRefuseCopy(h)
    } else if (TOOL_ENV_SPECIAL.test(h)) {
      const b = g.split(/[\s=]+/).find(R => RELATIVE_TOOL_FILE.test(R))
      if (b !== undefined)
        return envAssignToolRunsWorkingDirFileRefuseCopy(h, b)
    }
  }
  return
}

/**
 * leftover `pi` @202250082 BODY 1564 B — git argv scanner.
 */
export function gitArgvRefuse(
  argv: ArgvToken[],
  envTokens: ArgvToken[] = [],
  nested: string[] = [],
): string | undefined {
  if (
    envTokens.some(
      s =>
        /^(?:env|-i|--ignore-environment|-u|--unset)$/.test(
          s.text.slice(s.text.lastIndexOf('/') + 1),
        ) || s.text.startsWith('GIT_CONFIG'),
    )
  ) {
    return gitHookEnvClearedRefuseCopy()
  }
  for (let s = 0; s < argv.length; s += 1) {
    const h = argv[s].text
    let g: string | undefined
    if (h === '-c' || h === '--config-env') {
      s += 1
      g = argv[s]?.text
    } else if (h.startsWith('--config-env=')) g = h.slice(13)
    else if (/^-c./.test(h)) g = h.slice(2)
    else if (/^--exec-path=(?![/~])/.test(h)) {
      return gitExecPathInLaunchDirRefuseCopy()
    }
    if (g === undefined) {
      if (/^(?:bisect|submodule|rebase)$/.test(h)) {
        const R = argv.slice(s + 1)
        const I = R.findIndex(x => /^(?:run|foreach|-x|--exec)$/.test(x.text))
        if (I !== -1 && R[I + 1] !== undefined) {
          nested.push(
            R.slice(I + 1)
              .map(x => x.text)
              .join(' '),
          )
        }
        break
      }
      continue
    }
    const v = g.indexOf('=')
    const w = v === -1 ? g : g.slice(0, v)
    const b = v === -1 ? '' : g.slice(v + 1)
    if (/^core\.hookspath$/i.test(w)) {
      if (!/^(?:\/|~\/)/.test(b) || /^~[+-]/.test(b)) {
        return gitHooksPathOnRefuseCopy()
      }
    } else if (/^include(?:if\.[^=]*)?\.path$/i.test(w) && !isVouchedPath(b)) {
      return gitConfigIncludedFromLaunchDirRefuseCopy()
    } else if (
      b.startsWith('!') ||
      (b.includes('/') && !/^[/~$]/.test(b)) ||
      /^(?:core\.(?:fsmonitor|sshcommand|askpass|editor|pager|gitproxy)|credential\.helper|diff\.external|gpg\.(?:\w+\.)?program|sequence\.editor|uploadpack\.packobjectshook)$/i.test(
        w,
      )
    ) {
      return gitConfigRunsFromCheckoutRefuseCopy(w)
    }
  }
  return
}

/**
 * leftover `gi` @202251842 BODY 924 B — php -z/-c/-d scanner.
 */
export function phpArgvLoadsRelativeRefuse(
  argv: ArgvToken[],
  ctx: ShellScanContext = { roots: [], home: '' },
): string | undefined {
  const r = findInterpreterProgram('php', argv)
  const s = typeof r === 'object' ? argv.indexOf(r) : -1
  const h = argv.findIndex(b => b.text === '--')
  const g =
    typeof r === 'object' &&
    s !== -1 &&
    !/^(?:-[fF]|--file)$/.test(argv[s - 1]?.text ?? '')
      ? argv.slice(0, s)
      : argv.filter((_b, R) => R !== s && (h === -1 || R < h))
  const v = (b: string, R: number) => takeFlagValue(g, b.replace(/^=/, ''), R)
  return g.some((b, R) => {
    const I = /^(?:-[zc]|--zend-extension=?|--php-ini=?)(.*)$/.exec(b.text)
    if (I !== null) return valueLoadsRelativeOrReach(v(I[1], R), ctx)
    const x = /^(?:-d|--define=?)(.*)$/.exec(b.text)
    if (x === null) return false
    const { value: P } = v(x[1], R)
    const O = P.indexOf('=')
    const q = (O === -1 ? P : P.slice(0, O)).trim()
    const T = O === -1 ? '1' : P.slice(O + 1)
    if (!PHP_DANGEROUS_DEFINE.test(q)) return false
    const j = (A: string) =>
      valueLoadsRelativeOrReach({ value: A, tildeLiteral: true }, ctx)
    if (q === 'include_path') return T.split(':').some(j)
    if (/^(?:zend_)?extension$/.test(q) && !T.includes('/')) return false
    return T !== '' && j(T)
  })
    ? phpLoadsRelativeFileRefuseCopy()
    : undefined
}

/**
 * leftover `ro` @202252766 BODY 1222 B — python -i / -m / -c / stdin.
 */
export function pythonArgvRefuse(argv: ArgvToken[]): string | undefined {
  const r = findInterpreterProgram('python', argv)
  const s = argv.findIndex(g => g === r || isEvalStyleFlag('python', g.text))
  if (
    (s === -1 ? argv : argv.slice(0, argv[s] === r ? s : s + 1)).some(g =>
      /^-[bBdEhIOPqRsSuvVx]*i/.test(g.text),
    )
  ) {
    return pythonInteractiveStdinRefuseCopy()
  }
  for (let g = 0; g < argv.length; g += 1) {
    const v = argv[g].text
    if (v === '-' || isStdinLikeToken(argv[g])) {
      return pythonImportsWorkingDirRefuseCopy()
    }
    if (!v.startsWith('-') || v === '--') return
    if (v.startsWith('--')) {
      if (v === '--version' || v === '--help') return
      if (v === '--check-hash-based-pycs') g += 1
      continue
    }
    for (let w = 1; w < v.length; w += 1) {
      const b = v[w]
      if (b === 'I' || b === 'P') return
      if (b === 'V' || b === 'h') return
      if (b === 'W' || b === 'X') {
        if (w === v.length - 1) g += 1
        break
      }
      if (b === 'm') return pythonImportsWorkingDirRefuseCopy()
      if (b === 'c') {
        const R = w < v.length - 1 ? v.slice(w + 1) : (argv[g + 1]?.text ?? '')
        return PYTHON_C_IMPORTS.test(R)
          ? pythonImportsWorkingDirRefuseCopy()
          : undefined
      }
    }
  }
  return pythonImportsWorkingDirRefuseCopy()
}

/** leftover `ei` @202234170 — wrap-depth cap. */
const WRAP_LAYER_CAP = 4

/** leftover `$e` @202219875 */
const SHELL_PROGRAMS = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ash',
  'ksh',
  'mksh',
  'rbash',
  'fish',
  'csh',
  'tcsh',
  'pwsh',
  'yash',
  'posh',
  'osh',
  'ysh',
  'pdksh',
  'loksh',
  'oksh',
])

/** leftover `Ut` @202220017 */
const INTERPRETER_PROGRAMS = new Set([
  'python',
  'pypy',
  'node',
  'nodejs',
  'ruby',
  'perl',
  'php',
  'lua',
  'tsx',
  'ts-node',
  'bb',
  'awk',
  'gawk',
  'osascript',
  'expect',
  'tclsh',
  'wish',
  'rscript',
  'irb',
  'erb',
  'nawk',
  'mawk',
  'sed',
  'gsed',
  'm4',
])

/** leftover `ti` @202235452 */
const WORKING_DIR_CONFIG_PROGRAMS = new Set([
  'bun',
  'deno',
  'tsx',
  'ts-node',
  'lua',
  'rscript',
  'r',
  'bb',
])

/** leftover `Jr` @202220321 */
const PROJECT_TOOLING = new Set([
  'bmake',
  'pmake',
  'gnumake',
  'make',
  'gmake',
  'ninja',
  'nix-build',
  'nix-instantiate',
  'nix-env',
  'ctest',
  'meson',
  'cmake',
  'bazel',
  'bazelisk',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'bunx',
  'lint-staged',
  'npm-run-all',
  'run-p',
  'run-s',
  'turbo',
  'nx',
  'lerna',
  'lefthook',
  'gulp',
  'grunt',
  'eslint',
  'prettier',
  'jest',
  'vitest',
  'mocha',
  'ava',
  'playwright',
  'cypress',
  'webpack',
  'rollup',
  'vite',
  'babel',
  'postcss',
  'tailwindcss',
  'next',
  'tsc',
  'commitlint',
  'stylelint',
  'uv',
  'pip',
  'pip3',
  'poetry',
  'pipenv',
  'hatch',
  'pdm',
  'rye',
  'pytest',
  'tox',
  'nox',
  'pylint',
  'flake8',
  'mypy',
  'pre-commit',
  'cargo',
  'rake',
  'bundle',
  'rspec',
  'rubocop',
  'rails',
  'composer',
  'phpunit',
  'phpstan',
  'psalm',
  'gradle',
  'gradlew',
  'mvn',
  'mvnw',
  'scons',
  'ant',
  'hg',
  'sbt',
  'lein',
  'clj',
  'clojure',
  'stack',
  'cabal',
  'mix',
  'dotnet',
  'msbuild',
  'swift',
  'xcodebuild',
  'pod',
  'fastlane',
  'just',
  'task',
  'terraform',
  'tofu',
  'terragrunt',
  'snakemake',
  'vagrant',
  'docker-compose',
  'podman-compose',
  'devbox',
  'mise',
  'asdf',
])

/** leftover `Zr` @202221280 */
const PROJECT_TOOLING_SUBCOMMAND: Record<string, Set<string>> = {
  go: new Set([
    'generate',
    'run',
    'test',
    'build',
    'install',
    'get',
    'vet',
    'tool',
  ]),
  deno: new Set(['task', 'test', 'bench', 'lint', 'fmt', 'check']),
  docker: new Set(['compose', 'build', 'buildx']),
  podman: new Set(['compose', 'build']),
  nix: new Set([
    'develop',
    'run',
    'build',
    'shell',
    'flake',
    'eval',
    'profile',
    'bundle',
    'print-dev-env',
    'fmt',
    'repl',
  ]),
  node: new Set(['--run', '--test']),
}

/** leftover `Qn` @202221254 */
const VERSION_OR_HELP = /^--(?:version|help)$/

/** leftover `Kr` @202220213 */
const SCRIPT_EXT_BY_INTERPRETER: Record<string, RegExp> = {
  julia: /\.jl$/,
  elixir: /\.exs?$/,
  groovy: /\.groovy$/,
  racket: /\.rkt$/,
  guile: /\.scm$/,
  sbcl: /\.(?:lisp|cl)$/,
}

/** leftover `K1n` @181357725 */
const KNOWN_INTERPRETER_NAME =
  /^(?:sh|bash|zsh|dash|ash|ksh\d*|mksh|rbash|fish|csh|tcsh|python(?:\d+(?:\.\d+)?)?|pypy\d*(?:\.\d+)?|node(?:js)?\d*|deno|bun|perl|ruby|irb|erb|php|lua|tclsh[\d.]*|wish[\d.]*|expect|m4|Rscript|R|script|osascript|pwsh|env)$/iu

/** leftover `Gn` @202202314 */
const LAUNCHER_PROGRAMS = new Set([
  'env',
  'nice',
  'nohup',
  'exec',
  'time',
  'caffeinate',
  'builtin',
  'command',
  'xargs',
  'sudo',
  'doas',
  'runuser',
  'coproc',
  'timeout',
  'gtimeout',
  'flock',
  'arch',
  'setsid',
  'stdbuf',
  'unbuffer',
  'chronic',
  'busybox',
  'strace',
  'ltrace',
  'entr',
])

/** leftover `Ht` @202202547 */
const FLOCK_VALUED_FLAGS = new Set([
  '-w',
  '--wait',
  '--timeout',
  '-E',
  '--conflict-exit-code',
])

/** leftover `Ar` @202203840 */
const LAUNCHER_POSITIONAL: Record<string, number> = {
  timeout: 1,
  gtimeout: 1,
  flock: 1,
  chrt: 1,
  taskset: 1,
}

/** leftover `Dr` @202202615 */
const LAUNCHER_VALUED_FLAGS: Record<string, Set<string>> = {
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  gtimeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  sudo: new Set([
    '-u',
    '-g',
    '-C',
    '-D',
    '-h',
    '-p',
    '-R',
    '-T',
    '-U',
    '--user',
    '--group',
    '--host',
    '--prompt',
    '--close-from',
    '--chdir',
    '--role',
    '--type',
    '--other-user',
  ]),
  doas: new Set(['-u', '-C']),
  runuser: new Set([
    '-u',
    '-g',
    '-G',
    '--user',
    '--group',
    '--supp-group',
    '-w',
    '--whitelist-environment',
  ]),
  xargs: new Set([
    '-n',
    '-P',
    '-I',
    '-L',
    '-s',
    '-d',
    '-E',
    '-a',
    '--arg-file',
    '--max-args',
    '--max-procs',
    '--delimiter',
  ]),
  env: new Set(['-u', '-C', '-P', '--unset', '--chdir']),
  caffeinate: new Set(['-t', '-w']),
  exec: new Set(['-a']),
  flock: new Set([...FLOCK_VALUED_FLAGS, '-c', '--command']),
  arch: new Set(['-arch', '-e', '-d']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
  strace: new Set(['-e', '-o', '-p', '-s', '-P', '-E', '-u', '-a', '-X']),
  ltrace: new Set(['-e', '-o', '-p', '-s', '-n', '-u', '-a', '-F']),
  ionice: new Set([
    '-c',
    '--class',
    '-n',
    '--classdata',
    '-p',
    '--pid',
    '-P',
    '--pgid',
    '-u',
    '--uid',
  ]),
  chrt: new Set([
    '-T',
    '--sched-runtime',
    '-P',
    '--sched-period',
    '-D',
    '--sched-deadline',
  ]),
  'xvfb-run': new Set([
    '-n',
    '--server-num',
    '-s',
    '--server-args',
    '-f',
    '--auth-file',
    '-e',
    '--error-file',
    '-w',
    '--wait',
    '-p',
    '--xauth-protocol',
  ]),
}

/** leftover `Zn` @202204899 */
const SHELL_KEYWORD = new Set([
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
])

/** leftover `oi` @202237900 */
const POSIX_SHELL_FOR_O = new Set([
  'bash',
  'sh',
  'dash',
  'ash',
  'ksh',
  'mksh',
  'zsh',
  'rbash',
])

/** leftover `Wt` @202241839 */
const PARALLEL_VALUED_FLAGS = new Set([
  '-j',
  '-P',
  '-a',
  '-S',
  '-C',
  '-N',
  '-n',
  '-L',
  '-s',
  '-I',
  '-U',
  '-d',
  '-E',
  '-J',
  '-D',
  '--jobs',
  '--max-procs',
  '--arg-file',
  '--sshlogin',
  '--sshloginfile',
  '--slf',
  '--colsep',
  '--max-replace-args',
  '--max-args',
  '--max-lines',
  '--max-chars',
  '--delimiter',
  '--eof',
  '--halt',
  '--halt-on-error',
  '--joblog',
  '--results',
  '--res',
  '--delay',
  '--timeout',
  '--retries',
  '--tmpdir',
  '--workdir',
  '--wd',
  '--tagstring',
  '--env',
  '--rpl',
  '--load',
  '--memfree',
  '--memsuspend',
  '--nice',
  '--limit',
  '--termseq',
  '--basefile',
  '--bf',
  '--return',
  '--profile',
  '--transferfile',
  '--tf',
  '--block',
  '--blocksize',
  '--block-size',
  '--recstart',
  '--recend',
  '--compress-program',
  '--header',
  '--id',
  '--semaphorename',
  '--semaphoretimeout',
  '--st',
  '--shellquote-ignore',
])

/** leftover `no` @202242553 */
const SCRIPT_VALUED_FLAGS = new Set([
  '-t',
  '-F',
  '-E',
  '--echo',
  '-O',
  '--log-out',
  '-I',
  '--log-in',
  '-B',
  '--log-io',
  '-T',
  '--log-timing',
  '-m',
  '--logging-format',
  '-o',
  '--output-limit',
])

/** leftover `hi` @202248109 */
const NODE_BUILTIN_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'test',
  'sqlite',
])

/** leftover `Vt` @202234461 — maps through existing copy helpers. */
const NO_COMMAND_REFUSE: Record<string, string> = {
  parallel: parallelNoCommandRefuseCopy(),
  script: scriptNoCommandRefuseCopy(),
  su: suNoCommandRefuseCopy(),
  runuser: runuserNoCommandRefuseCopy(),
  sudo: sudoDoasNoCommandRefuseCopy(),
}

const STANDING_REFUSE = new Set([
  wrapsCommandMoreThanFourLayersRefuseCopy(),
  envDashPRelativeDirRefuseCopy(),
  ...Object.values(NO_COMMAND_REFUSE),
])

type LauncherRule = {
  anchored: (token: ArgvToken) => boolean
  takesNext: (valued: (flag: string) => boolean, flag: string) => boolean
  alsoLaunchers: Set<string>
  alsoValued: Record<string, Set<string>>
  runuserIsSu: boolean
  stepsPastVariable?: boolean
}

/** leftover `Nt` @202203891 */
function isAnchoredLauncher(token: ArgvToken): boolean {
  return (
    /^(?:\/|\$(?!\{?(?:CURDIR|PWD)\b)(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})\/)/.test(
      token.text,
    ) || /^~(?:[A-Za-z_][A-Za-z0-9._-]*)?\//.test(token.raw ?? '')
  )
}

/** leftover `mt`/`Kn` @202203891 */
const DEFAULT_LAUNCHER_RULE: LauncherRule = {
  anchored: isAnchoredLauncher,
  takesNext: (valued, flag) =>
    valued(flag) ||
    (!flag.startsWith('--') &&
      Array.from(flag).findIndex((r, s) => s > 0 && valued('-' + r)) ===
        flag.length - 1),
  alsoLaunchers: new Set(['ionice', 'chrt', 'taskset', 'xvfb-run']),
  alsoValued: { sudo: new Set(['-r', '-t']) },
  runuserIsSu: true,
}

const LAUNCHER_RULES: LauncherRule[] = [
  {
    anchored: e => e.text.startsWith('/'),
    takesNext: (valued, flag) =>
      !flag.includes('=') &&
      (valued(flag) ||
        (/^-[a-zA-Z]{2,}$/.test(flag) && valued('-' + flag.at(-1)))),
    alsoLaunchers: new Set(),
    alsoValued: {},
    runuserIsSu: false,
  },
  DEFAULT_LAUNCHER_RULE,
  {
    ...DEFAULT_LAUNCHER_RULE,
    alsoValued: {
      ...DEFAULT_LAUNCHER_RULE.alsoValued,
      time: new Set(['-f', '--format', '-o', '--output']),
      strace: new Set(['-I', '-b']),
      xargs: new Set(['-J']),
    },
  },
  { ...DEFAULT_LAUNCHER_RULE, stepsPastVariable: true },
]

/** leftover `wt` @202222813 */
function commandBasename(token: ArgvToken): string {
  const n = token.text
  return n.slice(n.lastIndexOf('/') + 1).toLowerCase()
}

/** leftover `Yr` @202222892 */
function stripInterpreterVersion(name: string): string {
  return name.replace(
    /^(python|pypy|perl|ruby|php|lua|node|nodejs|ksh|tclsh|wish)[0-9.]+t?$/,
    '$1',
  )
}

/** leftover `Qr` @202223002 */
function isKnownInterpreter(name: string): boolean {
  return (
    SHELL_PROGRAMS.has(name) ||
    INTERPRETER_PROGRAMS.has(name) ||
    KNOWN_INTERPRETER_NAME.test(name)
  )
}

/** leftover `ao` @202223058 */
function isVouchedCommandToken(token: ArgvToken): boolean {
  return /^[/~$]|^[<>]\(/.test(token.text) && !/^~[+-]/.test(token.text)
}

/** leftover `Ee` @202223134 */
function isRelativeWordToken(token: ArgvToken | undefined): boolean {
  return (
    token !== undefined &&
    token.text !== '' &&
    !isVouchedCommandToken(token) &&
    !token.text.startsWith('-')
  )
}

/** leftover `to` @202234037 */
function projectToolingSubcommand(
  name: string,
  args: ArgvToken[],
): string | undefined {
  const r = PROJECT_TOOLING_SUBCOMMAND[name]
  if (r === undefined) return
  return args.find(s =>
    r.has(s.text.startsWith('--') ? s.text.split('=')[0] : s.text),
  )?.text
}

/** leftover `yt` @202235018 */
function standingRefuse(reason: string, ctx: ShellScanContext): string {
  if (STANDING_REFUSE.has(reason)) ctx.standing?.push(reason)
  return reason
}

/** leftover `Jn` @202204654 */
function isLauncherName(name: string): boolean {
  return (
    LAUNCHER_PROGRAMS.has(name) ||
    LAUNCHER_RULES.some(n => n.alsoLaunchers.has(name))
  )
}

/** leftover `Ir` @202204724 */
function runuserUserFlags(argv: ArgvToken[]): boolean[] {
  const n = Array(argv.length + 1).fill(false) as boolean[]
  for (let r = argv.length - 1; r >= 0; r -= 1) {
    const s = argv[r].text
    n[r] = s !== '--' && (/^(?:-[flmpPT]*u|--user(?:=|$))/.test(s) || n[r + 1])
  }
  return n
}

const ASSIGN_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/

/** leftover `Mr` @202207010 — peel env/xargs/sudo wrappers. */
function peelLauncher(
  argv: ArgvToken[],
  opts: { make?: boolean },
  rule: LauncherRule,
):
  | { program: ArgvToken; args: ArgvToken[]; assignments: ArgvToken[] }
  | undefined {
  const s: ArgvToken[] = []
  let h: boolean[] | undefined
  let g = false
  let v: { k: number; kept: number } | undefined
  let w = 0
  for (;;) {
    while (w < argv.length) {
      const O = argv[w]
      if (ASSIGN_TOKEN.test(O.raw ?? O.text)) s.push(O)
      else if (!(!O.quoted && SHELL_KEYWORD.has(O.text))) break
      w += 1
    }
    let b = argv[w]
    if (b === undefined) {
      return s.length > 0
        ? {
            program: { text: ':', quoted: false, raw: ':' },
            args: [],
            assignments: s,
          }
        : undefined
    }
    if (opts.make && !b.quoted && /^[@+-]+./.test(b.text)) {
      const O = b.text.replace(/^[@+-]+/, '')
      b = { ...b, text: O, raw: O }
    }
    const R = b.text.slice(b.text.lastIndexOf('/') + 1).toLowerCase()
    if (
      !(LAUNCHER_PROGRAMS.has(R) || rule.alsoLaunchers.has(R)) ||
      /[ \t]/.test(b.text) ||
      (b.text.includes('/') && !rule.anchored(b))
    ) {
      if (
        rule.stepsPastVariable === true &&
        g &&
        b.text.startsWith('$') &&
        argv[w + 1] !== undefined
      ) {
        v ??= { k: w, kept: s.length }
        s.push(b)
        w += 1
        continue
      }
      const O = b.text.startsWith('$') && !/^\$\((?:…|\(…\))\)$/.test(b.text)
      if (
        v !== undefined &&
        (b.text.startsWith('-') || (!O && (b.quoted || b.expands === true)))
      ) {
        return {
          program: argv[v.k],
          args: argv.slice(v.k + 1),
          assignments: s.slice(0, v.kept),
        }
      }
      return { program: b, args: argv.slice(w + 1), assignments: s }
    }
    if (R === 'command') {
      let O = false
      for (let q = w + 1; argv[q]?.text.startsWith('-') === true; q += 1) {
        O ||= /^-[pvV]*[vV][pvV]*$/.test(argv[q].text)
      }
      if (O) return { program: b, args: argv.slice(w + 1), assignments: s }
    }
    if (R === 'runuser' && rule.runuserIsSu) {
      h ??= runuserUserFlags(argv)
      if (!h[w + 1])
        return { program: b, args: argv.slice(w + 1), assignments: s }
    }
    if (R === 'busybox') {
      s.push(b)
      w += 1
      continue
    }
    s.push(b)
    g = true
    v = undefined
    w += 1
    let I = LAUNCHER_POSITIONAL[R] ?? 0
    const x = (O: string) =>
      (LAUNCHER_VALUED_FLAGS[R]?.has(O) ?? false) ||
      (rule.alsoValued[R]?.has(O) ?? false)
    let P = false
    while (w < argv.length) {
      const O = argv[w].text
      if (!P && O === '--') {
        s.push(argv[w])
        P = true
        w += 1
        continue
      }
      if (!P && R === 'env' && O === '-') {
        s.push({ ...argv[w], text: '-i' })
        w += 1
        continue
      }
      if (!P && O.startsWith('-') && O !== '-') {
        const q = rule.takesNext(x, O)
        s.push(argv[w])
        if (q && argv[w + 1] !== undefined) s.push(argv[w + 1])
        w += q ? 2 : 1
        continue
      }
      if (I > 0 && (R !== 'chrt' || /^\d+$/.test(O))) {
        s.push(argv[w])
        I -= 1
        w += 1
        continue
      }
      break
    }
  }
}

/** leftover `Yn`/`Mt` @202208716 */
function peelLaunchers(
  argv: ArgvToken[],
  opts: { make?: boolean } = {},
): { program: ArgvToken; args: ArgvToken[]; assignments: ArgvToken[] }[] {
  return LAUNCHER_RULES.flatMap(r => {
    const s = peelLauncher(argv, opts, r)
    return s === undefined ? [] : [s]
  }).filter(
    (r, s, h) =>
      h.findIndex(
        g => g.program.raw === r.program.raw && g.args.length === r.args.length,
      ) === s,
  )
}

/** leftover `di` @202241540 */
function flockCommandSlot(
  assignments: ArgvToken[],
  at: number,
): { at: number; text: string } | undefined {
  const r = assignments.slice(at + 1)
  const s = r.findIndex(
    (v, w) =>
      !v.text.startsWith('-') && !FLOCK_VALUED_FLAGS.has(r[w - 1]?.text ?? ''),
  )
  const h = s === -1 ? '' : (r[s + 1]?.text ?? '')
  const g = /^(?:-c|--command)$/.test(h) ? r[s + 2] : undefined
  if (g !== undefined) return { at: at + s + 3, text: g.text }
  return h.startsWith('--command=')
    ? { at: at + s + 2, text: h.slice(10) }
    : undefined
}

/** leftover `uo` @202239141 */
function shellCommandFlag(name: string): RegExp {
  return name === 'pwsh'
    ? /^-(?:c|command|cwa|commandwithargs|e|ec|encodedcommand)$/i
    : /^-[a-zA-Z]*c[a-zA-Z]*$|^--command(?:=|$)/
}

/** leftover `zt` @202237957 */
function shellFlagTakesValue(name: string, flag: string): number {
  if (/^--(?:rcfile|init-file)$/.test(flag)) return 1
  if (POSIX_SHELL_FOR_O.has(name)) {
    const r = /^[-+]([a-zA-Z]+)$/.exec(flag)
    if (r === null) return 0
    if (name === 'zsh' || name === 'ksh' || name === 'mksh') {
      return (name === 'zsh' ? /o$/ : /[oO]$/).test(r[1]) ? 1 : 0
    }
    return (r[1].match(/[oO]/g) ?? []).length
  }
  if (name === 'fish') {
    return /^(?:[+-]O|\+o|-C|--init-command|-p|--profile|-d|--debug|-D|--debug-stack-frames|-f|--features)$/.test(
      flag,
    )
      ? 1
      : 0
  }
  if (name === 'pwsh') {
    return /^-(?:o|of|outputformat|ex|ep|executionpolicy|wd|workingdirectory|config|configurationname|custompipename|if|inp|inputformat|settings|settingsfile|w|windowstyle|v|version)$/i.test(
      flag,
    )
      ? 1
      : 0
  }
  return flag === '-o' || flag === '+o' || flag === '-O' || flag === '+O'
    ? 1
    : 0
}

/** leftover `ri` @202238598 */
function shellConsumedIndexes(name: string, args: ArgvToken[]): Set<number> {
  const r = new Set<number>()
  for (let s = 0; s < args.length; s += 1) {
    const h = args[s].text
    if (h === '--') break
    if (h.startsWith('-') || h.startsWith('+')) {
      const g = shellFlagTakesValue(name, h)
      for (let v = 1; v <= g; v += 1) r.add(s + v)
      s += g
    }
  }
  return r
}

/** leftover `ii` @202238795 */
function shellHasOwnCommand(name: string, args: ArgvToken[]): boolean {
  const r = shellConsumedIndexes(name, args)
  const s = args.findIndex((v, w) => !r.has(w) && !/^[-+]./.test(v.text))
  const h = s === -1 ? args : args.slice(0, s)
  if (h.some(v => shellCommandFlag(name).test(v.text))) {
    return (
      (s !== -1 || h.some(v => /^--command=./.test(v.text))) &&
      !(name === 'pwsh' && args[s]?.text === '-')
    )
  }
  const g =
    name !== 'fish' &&
    name !== 'pwsh' &&
    h.some(v => /^-[a-zA-Z]*s[a-zA-Z]*$/.test(v.text))
  return s !== -1 && !isStdinLikeToken(args[s]) && !g
}

/** leftover `si` @202239277 */
function interpreterHasOwnProgram(name: string, args: ArgvToken[]): boolean {
  const r = findInterpreterProgram(name, args)
  return (
    args.some(s => isEvalStyleFlag(name, s.text)) ||
    (/^(?:[gnm]?awk|g?sed)$/.test(name) &&
      args.some(s => !s.text.startsWith('-'))) ||
    (typeof r === 'object' && !isStdinLikeToken(r))
  )
}

/** leftover `ai` @202239441 */
function pushShellCommandOrHeld(
  token: ArgvToken,
  nested: string[],
): string | undefined {
  if (/^\$/.test(token.text.trim())) return shellCommandFromVariableRefuseCopy()
  nested.push(token.text)
  return
}

/** leftover `kt` @202242706 */
function skipValuedFlags(
  args: ArgvToken[],
  valued: Set<string>,
  clustered = false,
): ArgvToken[] {
  let s = 0
  while (s < args.length && args[s].text.startsWith('-')) {
    const h = args[s].text
    s +=
      valued.has(h) ||
      (clustered && /^-[A-Za-z]{2,}$/.test(h) && valued.has('-' + h.at(-1)))
        ? 2
        : 1
  }
  return args.slice(s)
}

type WrapperScan =
  | 'reads_input'
  | 'held'
  | { words?: ArgvToken[][]; lines?: string[]; held?: boolean }

/** leftover `ci` @202242882 */
function scanWrapperCommand(
  name: string,
  args: ArgvToken[],
): WrapperScan | undefined {
  const r = (h: number): WrapperScan | undefined =>
    h >= 0 && h < args.length ? { words: [args.slice(h)] } : undefined
  const s = (h: ArgvToken[][]) =>
    h.filter(
      (g, v) =>
        g.length > 0 &&
        h.findIndex(
          w => w.length === g.length && w.every((b, R) => b === g[R]),
        ) === v,
    )
  switch (name) {
    case 'su':
    case 'runuser': {
      const h = args.flatMap((w, b) => {
        const R =
          /^(?:-[flmpPT]*c|--(?:session-)?command(?==|$))=?([\s\S]*)$/.exec(
            w.text,
          )
        return R === null ? [] : [R[1] !== '' ? R[1] : args[b + 1]?.text]
      })
      const g = args.some((w, b) => {
        const R = /^(?:-[flmpPT]*s|--shell)(?:=?([\s\S]+))?$/.exec(w.text)
        const I = R === null ? undefined : (R[1] ?? args[b + 1]?.text)
        return I !== undefined && !/^[/~$]/.test(I)
      })
      if (h.length === 0) {
        if (
          (name === 'runuser' &&
            args.some(b => /^(?:-[flmpPT]*u|--user(?:=|$))/.test(b.text))) ||
          (args.length > 0 &&
            args.every(b => /^(?:--version|--help|-V|-h)$/.test(b.text)))
        ) {
          return
        }
        const w = args.filter(
          (b, R) =>
            !b.text.startsWith('-') &&
            !/^(?:-[flmpPT]*[sgGwu]|--shell|--group|--supp-group|--whitelist-environment|--user)$/.test(
              args[R - 1]?.text ?? '',
            ),
        )
        return w.length <= 1
          ? 'reads_input'
          : g
            ? 'held'
            : {
                words: [
                  [{ text: 'sh', quoted: false, raw: 'sh' }, ...w.slice(1)],
                ],
              }
      }
      const v = h.filter((w): w is string => w !== undefined)
      return { lines: v, held: v.length < h.length || g }
    }
    case 'watch': {
      const h = uniqueStrings(
        [
          /^(?:-n|--interval|-d|--differences|-q|--equexit)$/,
          /^(?:-[a-zA-Z]*[nq]|--interval|--equexit)$/,
        ].map(g => {
          let v = 0
          while (v < args.length && args[v].text.startsWith('-')) {
            v += g.test(args[v].text) ? 2 : 1
          }
          return String(v)
        }),
      )
        .map(Number)
        .filter(g => g < args.length)
      return h.length === 0
        ? undefined
        : {
            lines: h.map(g =>
              args
                .slice(g)
                .map(v => v.text)
                .join(' '),
            ),
          }
    }
    case 'script': {
      const h = args.findIndex(b => /^(?:-[a-zA-Z]*c|--command)$/.test(b.text))
      if (h !== -1) {
        const b = args[h + 1]?.text
        return b === undefined ? 'held' : { lines: [b] }
      }
      const g = args.filter(b => !b.text.startsWith('-'))
      if (g.length < 2) {
        return args.length > 0 &&
          args.every(b => /^(?:--version|--help|-V|-h)$/.test(b.text))
          ? undefined
          : 'reads_input'
      }
      const v = skipValuedFlags(args, SCRIPT_VALUED_FLAGS)
      const w = skipValuedFlags(args, SCRIPT_VALUED_FLAGS, true)
      if (v.length <= 1 || w.length <= 1) return 'reads_input'
      return {
        words: s([
          g.slice(1),
          args.slice(args.indexOf(g[0]) + 1),
          v.slice(1),
          w.slice(1),
        ]),
      }
    }
    case 'dotenv':
      return 'held'
    case 'direnv': {
      if (args[0]?.text !== 'exec') return
      const h = args[1]
      return h === undefined || !isVouchedPath(h.text) ? 'held' : r(2)
    }
    case 'op': {
      if (args[0]?.text !== 'run') return
      const h = args.findIndex(v => /^--env-file(?:=|$)/.test(v.text))
      if (h !== -1) {
        const v = args[h].text.includes('=')
          ? args[h].text.slice(11)
          : (args[h + 1]?.text ?? '')
        if (!isVouchedPath(v)) return 'held'
      }
      const g = args.findIndex(v => v.text === '--')
      return g === -1 ? undefined : r(g + 1)
    }
    case 'hyperfine': {
      const h: string[] = []
      const g = /^(?:-p|--prepare|-s|--setup|-c|--cleanup|--conclude)$/
      const v =
        /^(?:-w|--warmup|-r|--runs|-m|--min-runs|-M|--max-runs|-n|--command-name|--export-\w+|--output|--shell|--sort|-u|--time-unit|-D|--parameter-step-size)$/
      const w: string[] = []
      for (let b = 0; b < args.length; b += 1) {
        const R = args[b].text
        if (g.test(R)) {
          h.push(args[b + 1]?.text ?? '')
          b += 1
        } else if (/^(?:-L|--parameter-list)$/.test(R)) {
          w.push(...(args[b + 2]?.text ?? '').split(','))
          b += 2
        } else if (/^(?:-P|--parameter-scan)$/.test(R)) b += 3
        else if (v.test(R)) b += 1
        else if (!R.startsWith('-')) h.push(R)
      }
      return { lines: [h.join('\n'), ...(h.length > 1 ? h : []), ...w] }
    }
    case 'parallel': {
      const h = args.filter(O => !O.text.startsWith('-') && O.text !== ':::')
      if (h.length === 0) return 'reads_input'
      const g = args.findIndex(O => !O.text.startsWith('-'))
      const v = args.slice(g)
      const w = v.findIndex(O => /^::::?\+?$/.test(O.text))
      const b = v.filter(O => !/^::::?\+?$/.test(O.text))
      const R = skipValuedFlags(args, PARALLEL_VALUED_FLAGS)
      const I = skipValuedFlags(args, PARALLEL_VALUED_FLAGS, true)
      if ([R, I].some(O => O.length === 0 || /^::::\+?$/.test(O[0].text))) {
        return 'reads_input'
      }
      const x = new Set(
        args
          .filter(
            (O, q) =>
              PARALLEL_VALUED_FLAGS.has(args[q - 1]?.text ?? '') &&
              /^\{[-+]?\d*[.#%+]{0,4}\}$/.test(O.text),
          )
          .map(O => O.text),
      )
      const P = (O: ArgvToken[]) => {
        const q = O.findIndex(T => !x.has(T.text))
        return q === -1 ? [] : O.slice(q)
      }
      return {
        words: s([
          P(h),
          P(b),
          R.filter(O => !/^::::?\+?$/.test(O.text)),
          I.filter(O => !/^::::?\+?$/.test(O.text)),
        ]),
        lines:
          w === 0 || [R, I].some(O => /^:::\+?$/.test(O[0].text))
            ? b.map(O => O.text)
            : [],
      }
    }
    default:
      return
  }
}

/** leftover `fi` @202248538 */
function nodeLoadsBareOrRelative(code: string): boolean {
  for (const n of code.matchAll(
    /(?:\brequire\s*(?:\?\.)?\s*\(|\bimport\s*\(|\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?|\bfrom\s+|\bcreateRequire\b[^'"]*)\s*['"]([^'"]+)['"]/g,
  )) {
    const r = n[1]
    if (r.startsWith('/') || r.startsWith('node:')) continue
    if (!NODE_BUILTIN_MODULES.has(r.split('/')[0])) return true
  }
  return /\bcreateRequire\b/.test(code)
}

/** leftover `li` @202240032 */
function envXargsRefuse(
  assignments: ArgvToken[],
  nested: string[],
  argv: ArgvToken[] = [],
): string | undefined {
  const s: (string | undefined)[] = Array(assignments.length + 1)
  const h = Array(assignments.length + 1).fill(false) as boolean[]
  const g = Array(assignments.length + 3).fill(false) as boolean[]
  for (let x = assignments.length - 1; x >= 0; x -= 1) {
    const P = assignments[x].text
    const O = /^(?:-[iv0]*[uCP]|--unset|--chdir)$/.test(P) ? 2 : 1
    g[x] =
      P.startsWith('-') &&
      ((/^-[iv0]*P/.test(P) &&
        !(P.replace(/^-[iv0]*P/, '') || (assignments[x + 1]?.text ?? ''))
          .split(':')
          .every(isVouchedPath)) ||
        g[x + O])
    s[x] = /^(?:-S.|--split-string=)/.test(P)
      ? P.replace(/^(?:-S|--split-string=)/, '')
      : s[x + 1]
    const q = /^-[0oprtx]+a([\s\S]*)$/.exec(P)
    const T = /^(?:-a|--arg-file)$/.test(P)
      ? assignments[x + 1]?.text
      : P.startsWith('--arg-file=')
        ? P.slice(11)
        : P.startsWith('-a') && P.length > 2
          ? P.slice(2)
          : q !== null
            ? q[1] || assignments[x + 1]?.text
            : undefined
    h[x] = (T !== undefined && !isVouchedPath(T)) || h[x + 1]
  }
  const v = assignments.map(x =>
    x.text.slice(x.text.lastIndexOf('/') + 1).toLowerCase(),
  )
  const w = v.indexOf('xargs')
  const b =
    w === -1
      ? []
      : uniqueStrings(
          assignments.slice(w + 1).flatMap((x, P, O) => {
            const q = /^-[0oprtx]*([IJi])([\s\S]*)$/.exec(x.text)
            if (q === null) {
              return /^--replace(?:=|$)/.test(x.text)
                ? [x.text.split('=')[1] ?? '{}']
                : []
            }
            return q[1] === 'i'
              ? [
                  '{}',
                  ...(q[2] === '' ? [] : [q[2]]),
                  ...(q[2].includes('=') ? [x.text.split('=')[1]] : []),
                ]
              : [q[2] || O[P + 1]?.text].filter(
                  (T): T is string => T !== undefined,
                )
          }),
        )
  const R = b.length > 64 || argv.some(x => b.some(P => x.text.includes(P)))
  v.forEach((x, P) => {
    if (x === 'env' && s[P + 1] !== undefined) nested.push(s[P + 1] as string)
  })
  const I = v.map((x, P) => {
    if (x === 'env') {
      return !assignments[P].text.startsWith('-') && g[P + 1]
        ? envDashPRelativeDirRefuseCopy()
        : undefined
    }
    if (x !== 'xargs') return
    return R
      ? xargsSplicesFromInputRefuseCopy()
      : h[P + 1]
        ? xargsArgsFromLaunchDirFileRefuseCopy()
        : undefined
  })
  return (
    I.find(x => x === envDashPRelativeDirRefuseCopy()) ??
    I.find(x => x !== undefined)
  )
}

/** leftover `ni` @202236315 */
function scanShellInterpreter(
  name: string,
  args: ArgvToken[],
  nested: string[],
  ctx: ShellScanContext,
  io: { redirects: ShellRedirect[]; heredoc?: string; piped?: boolean },
): string | undefined {
  const v =
    io.piped ||
    io.heredoc !== undefined ||
    io.redirects.some(R => R.op.startsWith('<'))
  const w = (R: ArgvToken) =>
    v && !/^\$/.test(R.text.trim())
      ? nestedPayloadRefuse(R.text, io, nested, ctx)
      : pushShellCommandOrHeld(R, nested)
  let b = false
  for (let R = 0; R < args.length; R += 1) {
    const I = args[R]
    const x = I.text
    if (x === '--') {
      const O = args[R + 1]
      if (O === undefined) return
      return b
        ? w(O)
        : !/^[/~$]/.test(O.text) || /^~[+-]/.test(O.text)
          ? relativeScriptNameRefuseCopy()
          : undefined
    }
    if (name === 'fish') {
      const O = /^(?:-C|--init-command(?:=([\s\S]*))?)$/.exec(x)
      if (O !== null) {
        const q = O[1] !== undefined ? { ...I, text: O[1] } : args[R + 1]
        const T = q === undefined ? undefined : w(q)
        if (T !== undefined && ctx.standing === undefined) return T
        R += O[1] !== undefined ? 0 : 1
        continue
      }
    }
    if (shellCommandFlag(name).test(x) && !x.startsWith('--command=')) {
      if (name === 'pwsh' && /^-e/i.test(x))
        return pwshEncodedCommandRefuseCopy()
      b = true
      R += shellFlagTakesValue(name, x)
      continue
    }
    if (x.startsWith('--command=')) return w({ ...I, text: x.slice(10) })
    if (/^--(?:rcfile|init-file)=/.test(x)) {
      if (!isVouchedPath(x.slice(x.indexOf('=') + 1))) {
        return shellRcFileFromLaunchDirRefuseCopy(name)
      }
      continue
    }
    const P = shellFlagTakesValue(name, x)
    if (P > 0) {
      const O = args[R + 1]?.text
      R += P
      if (
        /^--(?:rcfile|init-file)$/.test(x) &&
        O !== undefined &&
        !isVouchedPath(O)
      ) {
        return shellRcFileFromLaunchDirRefuseCopy(name)
      }
      continue
    }
    if (x.startsWith('-') || x.startsWith('+')) continue
    if (b) {
      const O = w(I)
      return name === 'pwsh' && R + 1 < args.length
        ? (O ??
            w({
              ...I,
              text: args
                .slice(R)
                .map(q => q.text)
                .join(' '),
            }))
        : O
    }
    return isStdinLikeToken(I)
      ? shellProgramOnPipeRefuseCopy()
      : isRelativeWordToken(I)
        ? relativeScriptNameRefuseCopy()
        : undefined
  }
  return
}

/** leftover `ho` @202239628 — payload as nested shell; parse seam via defaultParseShell. */
function nestedPayloadRefuse(
  text: string,
  io: { redirects?: ShellRedirect[]; heredoc?: string; piped?: boolean },
  nested: string[],
  ctx: ShellScanContext,
): string | undefined {
  const { commands: h, unreadable: g } = defaultParseShell(text)
  if (g !== null) return couldNotBeReadToEndAsShellCopy(g)
  return h
    .map(v =>
      scanShellCommand(
        v.program.text === ':' &&
          v.args.length === 0 &&
          (v.redirects ?? []).length === 0
          ? v
          : {
              ...v,
              redirects: [
                ...(v.redirects ?? []),
                ...(io.redirects ?? []).filter(w => w.op.startsWith('<')),
              ],
              heredoc: v.heredoc ?? io.heredoc,
              piped: v.piped || io.piped,
            },
        nested,
        { ...ctx, fromPayload: true },
      ),
    )
    .find(v => v !== undefined)
}

/** leftover `Lt` @202235077 — recursive argv walk. */
function scanArgvAsCommand(
  argv: ArgvToken[],
  piped: boolean | undefined,
  nested: string[],
  ctx: ShellScanContext,
  skipHead = false,
): string | undefined {
  const g = (ctx.nesting ?? 0) + 1
  if (g > WRAP_LAYER_CAP) {
    return standingRefuse(wrapsCommandMoreThanFourLayersRefuseCopy(), ctx)
  }
  if (argv.length === 0) return
  const v = [
    ...(skipHead
      ? []
      : [
          {
            program: argv[0],
            args: argv.slice(1),
            assignments: [] as ArgvToken[],
          },
        ]),
    ...peelLaunchers(argv).filter(
      b => skipHead || b.args.length !== argv.length - 1,
    ),
  ]
  const w: (string | undefined)[] = []
  for (const b of v) {
    const R = scanShellCommand({ ...b, redirects: [], piped }, nested, {
      ...ctx,
      nesting: g,
    })
    if (R !== undefined && ctx.standing === undefined) return R
    w.push(R)
  }
  return w.find(b => b !== undefined)
}

/**
 * leftover `St` @202223213 BODY 10824 B — command refuse walker.
 * Maps leftover oo/pi/gi/ro/li/ni/Vt/yt onto existing copy helpers.
 */
export function scanShellCommand(
  command: ShellCommand,
  nested: string[],
  ctx: ShellScanContext = { roots: [], home: '', fromPayload: false },
): string | undefined {
  let { program: e, args: n, assignments: r } = command
  const s = command.redirects ?? []
  const h = command.heredoc
  const g = command.piped
  const P = r.findIndex(D => commandBasename(D) === 'flock')
  const O = P === -1 ? undefined : flockCommandSlot(r, P)
  const q = [
    ...r.filter((_D, F) => F !== O?.at),
    ...(/^(?:export|declare|typeset|local|readonly)$/.test(e.text) ? n : []),
  ]
  const T = envAssignArgvRefuse(q, ctx.shell === 'zsh')
  if (T !== undefined && ctx.standing === undefined) return T
  const j = r.find(D => tokenNamesReach(D, ctx))
  if (j !== undefined) return namesPathRefuseCopy(j.text)
  const A = envXargsRefuse(r, nested, [e, ...n])
  if (
    A !== undefined &&
    (ctx.standing === undefined || STANDING_REFUSE.has(A))
  ) {
    return standingRefuse(A, ctx)
  }
  const L =
    e.text === ':'
      ? r.findIndex(D => /^(?:sudo|doas)$/.test(commandBasename(D)))
      : -1
  if (
    L !== -1 &&
    r.some(
      (D, F) =>
        F > L && /^(?:-[A-Za-z]*[si][A-Za-z]*|--shell|--login)$/.test(D.text),
    )
  ) {
    return standingRefuse(NO_COMMAND_REFUSE.sudo, ctx)
  }
  if (O !== undefined) {
    const D = nestedPayloadRefuse(
      O.text,
      { redirects: s, heredoc: h, piped: g },
      nested,
      ctx,
    )
    if (D !== undefined && ctx.standing === undefined) return D
  }
  if (
    e.text === 'setenv' ||
    (e.text === 'set' && /^-[a-zA-Z]*x/.test(n[0]?.text ?? ''))
  ) {
    const D = e.text === 'setenv' ? 0 : 1
    const F = n[D]
    const ee = envAssignArgvRefuse(
      F === undefined
        ? []
        : [
            {
              ...F,
              text:
                F.text +
                '=' +
                n
                  .slice(D + 1)
                  .map(J => J.text)
                  .join(':'),
            },
          ],
    )
    if (ee !== undefined) return ee
  }
  if (e.text === 'unset' && n.some(D => D.text.startsWith('GIT_CONFIG'))) {
    return unsetsGitHooksOffEnvRefuseCopy()
  }
  if (e.text === 'unset' && n.some(D => D.text === 'PATH')) {
    return unsetsPathWorkingDirLookupRefuseCopy()
  }
  if (e.expands && !/^\$/.test(e.text)) {
    return commandNameBuiltByExpansionRefuseCopy()
  }
  if (/^\$\(…\)/.test(e.text)) return commandHeldInVariableRefuseCopy()
  if (/^\$/.test(e.text)) {
    if (tokenNamesReach(e, ctx)) return namesPathRefuseCopy(e.text)
    const D = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?\//.exec(e.text)?.[1]
    if (D !== undefined && ctx.relativeNames?.has(D) === true) {
      return relativeFilePathRefuseCopy()
    }
    if (/^\$[({](?:CURDIR|PWD)[)}]/.test(e.text)) {
      return addressesWorkingDirectoryRefuseCopy()
    }
    const F = e.text.replace(
      /^\$\{[^}]*\}|^\$\([^)]*\)|^\$[A-Za-z_][A-Za-z0-9_]*/,
      '',
    )
    if (F !== e.text && /^[^/~$].*\//.test(F))
      return relativeFilePathRefuseCopy()
    const ee =
      ctx.make === true &&
      /^(?:\$[({][A-Za-z_]+[)}])*\$[({]MAKE[)}]$/.test(e.text)
        ? 'make'
        : /:-([^}]+)\}$/.exec(e.text)?.[1]
    if (ee === undefined) {
      if (ctx.fromPayload) return commandHeldInVariableRefuseCopy()
      const J = n.find(ae => !ae.text.startsWith('-'))
      if (
        J !== undefined &&
        isRelativeWordToken(J) &&
        (J.text.includes('/') || /\.[A-Za-z0-9]{1,5}$/.test(J.text))
      ) {
        return relativeFilePathRefuseCopy()
      }
      if (!/^\/(?:.*\/)?[^/$]+$/.test(F)) return
      const te = commandBasename(e)
      if (isLauncherName(te) && te !== 'runuser') {
        return isAnchoredLauncher(e) && !/[ \t]/.test(e.text)
          ? undefined
          : scanArgvAsCommand(
              [{ text: te, quoted: false, raw: te }, ...n],
              g,
              nested,
              ctx,
              true,
            )
      }
    } else {
      e = { ...e, text: ee }
    }
  }
  if (e.quoted && /[ \t]/.test(e.text) && !e.text.includes('/')) {
    nested.push(e.text)
    return
  }
  const U = stripInterpreterVersion(commandBasename(e))
  const N = [e, ...n, ...s.map(D => D.target)].find(D =>
    tokenNamesReach(D, ctx),
  )
  if (N !== undefined) return namesPathRefuseCopy(N.text)
  if (
    e.text.includes('/') &&
    !isVouchedCommandToken(e) &&
    !e.text.endsWith('/')
  ) {
    return relativeFilePathRefuseCopy()
  }
  if (
    ctx.standing === undefined &&
    /(?:^|[^$])\{[-+]?\d*[./#%+]{0,4}\}/.test(e.text)
  ) {
    return relativeFilePathRefuseCopy()
  }
  if (U === 'for' || U === 'select') {
    const D = n.slice(n.findIndex(F => F.text === 'in') + 1)
    return D.some(F => isRelativeWordToken(F) && /[/*?[]/.test(F.text))
      ? loopsOverFilesInLaunchDirRefuseCopy(D[0].text)
      : undefined
  }
  if (U === 'source' || e.text === '.') {
    const D = n[0]?.text === '--' ? n[1] : n[0]
    if (D !== undefined && isStdinLikeToken(D)) {
      if (h !== undefined && D.text !== '<(…)') {
        nested.push(h)
        return
      }
      return interpreterProgramOnPipeRefuseCopy()
    }
    return isRelativeWordToken(D) ? sourcesRelativeFileRefuseCopy() : undefined
  }
  const V = scanWrapperCommand(U, n)
  if (V === 'reads_input') {
    return standingRefuse(
      NO_COMMAND_REFUSE[U] ?? unvouchedCommandOrFileRefuseCopy(U),
      ctx,
    )
  }
  if (V !== undefined) {
    if (V !== 'held') for (const D of V.lines ?? []) nested.push(D)
    return V === 'held' || V.held
      ? unvouchedCommandOrFileRefuseCopy(U)
      : (V.words ?? [])
          .map(D => scanArgvAsCommand(D, g, nested, ctx))
          .find(D => D !== undefined)
  }
  if (PROJECT_TOOLING.has(U) || projectToolingSubcommand(U, n) !== undefined) {
    return U !== 'hg' &&
      n.length > 0 &&
      n.every(D => VERSION_OR_HELP.test(D.text))
      ? undefined
      : projectToolingReadsCheckoutRefuseCopy()
  }
  const B = U === 'rscript' ? findInterpreterProgram(U, n) : undefined
  if (
    WORKING_DIR_CONFIG_PROGRAMS.has(U) &&
    !(
      U === 'rscript' &&
      (typeof B === 'object' ? n.slice(0, n.indexOf(B)) : n).some(
        D => D.text === '--vanilla',
      )
    )
  ) {
    return readsWorkingDirConfigRefuseCopy(U)
  }
  if (
    SHELL_PROGRAMS.has(U) ||
    INTERPRETER_PROGRAMS.has(U) ||
    (e.text === ':' && O === undefined)
  ) {
    const D = SHELL_PROGRAMS.has(U)
    const F =
      e.text !== ':' &&
      (D ? shellHasOwnCommand(U, n) : interpreterHasOwnProgram(U, n))
    if (!F) {
      for (const { op: J, target: te } of s) {
        if (
          (J === '<' || J === '<>') &&
          (isRelativeWordToken(te) || isStdinLikeToken(te))
        ) {
          return e.text === ':'
            ? compoundCommandInputFromLaunchDirRefuseCopy()
            : relativeScriptNameRefuseCopy()
        }
        if (J === '<<<' && SHELL_PROGRAMS.has(U)) {
          if (/^\$/.test(te.text.trim()))
            return commandHeldInVariableRefuseCopy()
          nested.push(te.text)
        }
      }
      if (h !== undefined && SHELL_PROGRAMS.has(U)) nested.push(h)
    }
    const ee =
      D &&
      !F &&
      h === undefined &&
      !s.some(J => /^<(?!>)/.test(J.op) || J.op === '<>')
    if (
      !F &&
      e.text !== ':' &&
      (g ||
        ee ||
        (!SHELL_PROGRAMS.has(U) &&
          (h !== undefined || s.some(J => J.op === '<<<'))))
    ) {
      return U === 'python' || U === 'pypy'
        ? pythonArgvRefuse(n)
        : interpreterProgramOnPipeRefuseCopy()
    }
  }
  if (SHELL_PROGRAMS.has(U)) {
    return scanShellInterpreter(U, n, nested, ctx, {
      redirects: s,
      heredoc: h,
      piped: g,
    })
  }
  if (U === 'python' || U === 'pypy') {
    const D = pythonArgvRefuse(n)
    if (D !== undefined) return D
  } else if (U === 'perl') {
    if (
      n.some((D, F) => {
        const ee =
          /^-[acnpsTtwWX]*(?:I([\s\S]*)|[Mm]lib(?:=([\s\S]*)|(\s[\s\S]*))?)$/.exec(
            D.text,
          )
        return (
          ee !== null &&
          (ee[1] !== undefined
            ? valueLoadsRelativeOrReach(takeFlagValue(n, ee[1], F), ctx)
            : ee[3] !== undefined
              ? ee[3].trim() !== ''
              : (ee[2] ?? '')
                  .split(',')
                  .some(
                    J =>
                      J !== '' &&
                      valueLoadsRelativeOrReach(
                        { value: J, tildeLiteral: true },
                        ctx,
                      ),
                  ))
        )
      })
    ) {
      return perlLibRelativeRefuseCopy()
    }
  } else if (U === 'ruby') {
    const D = findInterpreterProgram('ruby', n)
    const F =
      typeof D === 'object' && n.includes(D) ? n.slice(0, n.indexOf(D)) : n
    if (
      F.some((ee, J) => {
        const te = /^-[acdlnpsvwy]*I(.*)$/.exec(ee.text)
        if (te !== null) {
          return takeFlagValue(F, te[1], J)
            .value.split(':')
            .some(
              (Y, oe, ie) =>
                (Y !== '' || ie.length === 1) &&
                valueLoadsRelativeOrReach(
                  { value: Y, tildeLiteral: false },
                  ctx,
                ),
            )
        }
        const ae = /^(?:-[acdlnpsvwy]*r|--require=?)([\s\S]*)$/.exec(ee.text)
        if (ae === null) return false
        const { value: z } = takeFlagValue(F, ae[1], J)
        return (
          /^\.\.?\//.test(z) ||
          /^bundler(?:\/+setup(?:\.rb)?)?$/i.test(z) ||
          tokenNamesReach({ text: z, quoted: false, raw: z }, ctx)
        )
      })
    ) {
      return rubyLibRelativeRefuseCopy()
    }
  } else if (U === 'node' || U === 'nodejs' || U === 'tsx' || U === 'ts-node') {
    if (
      n.some(
        (ee, J) =>
          /^(?:-r|--require|--import|--(?:experimental-)?loader)(?:=|$)/.test(
            ee.text,
          ) &&
          !/^(?:\/|node:)/.test(
            ee.text.includes('=')
              ? (ee.text.split('=')[1] ?? '')
              : (n[J + 1]?.text ?? ''),
          ),
      )
    ) {
      return nodePreloadWorkingDirRefuseCopy()
    }
    const D = n.findIndex(ee =>
      /^(?:-e|--eval|-p|--print|-pe|-ep)$/.test(ee.text),
    )
    const F =
      D !== -1
        ? n[D + 1]?.text
        : n
            .find(ee => /^--(?:eval|print)=/.test(ee.text))
            ?.text.replace(/^--(?:eval|print)=/, '')
    if (F !== undefined && nodeLoadsBareOrRelative(F)) {
      return nodeBareOrRelativeModuleRefuseCopy()
    }
  } else if (U === 'lua') {
    if (n.some(D => /^-l/.test(D.text))) return luaLoadWorkingDirRefuseCopy()
  } else if (U === 'php') {
    const D = phpArgvLoadsRelativeRefuse(n, ctx)
    if (D !== undefined) return D
  }
  if (
    INTERPRETER_PROGRAMS.has(U) ||
    (isKnownInterpreter(U) && !SHELL_PROGRAMS.has(U))
  ) {
    const D = findInterpreterProgram(U, n)
    if (D === 'unknown_option') return unknownInterpreterOptionRefuseCopy()
    if (
      D !== undefined &&
      isStdinLikeToken(D) &&
      U !== 'python' &&
      U !== 'pypy'
    ) {
      return interpreterProgramOnPipeRefuseCopy()
    }
    if (D !== undefined && (D.text === '{}' || isRelativeWordToken(D))) {
      return relativeScriptNameRefuseCopy()
    }
    return
  }
  if (
    /^(?:emacs|vim?|nvim|gvim|view|ex)$/.test(U) &&
    n.some((D, F) => {
      const ee = /^(?:--?script|--load|-l|-S|-u)(?:=([\s\S]*))?$/.exec(D.text)
      const J = ee === null ? undefined : (ee[1] ?? n[F + 1]?.text ?? '-')
      return (
        J !== undefined &&
        !(D.text === '-u' && /^(?:NONE|NORC|DEFAULTS)$/.test(J)) &&
        (J.startsWith('-') ? D.text === '-S' : !/^[/~$]/.test(J))
      )
    })
  ) {
    return relativeScriptNameRefuseCopy()
  }
  const Z = SCRIPT_EXT_BY_INTERPRETER[U]
  if (Z !== undefined) {
    if (
      n.some(
        D =>
          D.text === '{}' ||
          (!D.text.startsWith('-') && Z.test(D.text) && isRelativeWordToken(D)),
      )
    ) {
      return relativeScriptNameRefuseCopy()
    }
    if (
      n.every(D => D.text.startsWith('-')) &&
      (g || h !== undefined || s.some(D => D.op.startsWith('<')))
    ) {
      return interpreterProgramOnPipeRefuseCopy()
    }
  }
  const W =
    U === 'dart'
      ? (n[0]?.text === 'run' ? n.slice(1) : n).find(
          D => !D.text.startsWith('-'),
        )
      : undefined
  if (W !== undefined && W.text.endsWith('.dart') && isRelativeWordToken(W)) {
    return relativeScriptNameRefuseCopy()
  }
  if (U === 'git') return gitArgvRefuse(n, r, nested)
  if (U === 'java') {
    const D = n.findIndex(J => J.text === '-jar')
    const F = n.findIndex(J => /^(?:-cp|-classpath|--class-path)$/.test(J.text))
    const ee =
      F === -1
        ? n.find(J => J.text.startsWith('--class-path='))?.text.slice(13)
        : n[F + 1]?.text
    if (D !== -1) {
      return isRelativeWordToken(n[D + 1])
        ? relativeFilePathRefuseCopy()
        : undefined
    }
    return n.length > 0 && n.every(J => VERSION_OR_HELP.test(J.text))
      ? undefined
      : ee !== undefined && ee.split(':').every(J => isVouchedPath(J))
        ? undefined
        : javaWorkingDirClassPathRefuseCopy()
  }
  if (U === 'eval') {
    nested.push(
      (n[0]?.text === '--' ? n.slice(1) : n).map(D => D.text).join(' '),
    )
    return
  }
  if (U === 'nix-shell' || U === 'nix') {
    const D = n.findIndex(F => /^(?:--run|--command|-c)$/.test(F.text))
    if (D !== -1 && n[D + 1] !== undefined) {
      nested.push(
        n
          .slice(D + 1)
          .map(F => F.text)
          .join(' '),
      )
    }
    return projectToolingSubcommand(U, n) !== undefined || U === 'nix-shell'
      ? projectToolingReadsCheckoutRefuseCopy()
      : undefined
  }
  if (U === 'trap') {
    const D = n[0]?.text === '--' ? n.slice(1) : n
    if (D.length >= 2 && !/^-[lp]$/.test(D[0].text) && D[0].text !== '-') {
      nested.push(D[0].text)
    }
    return
  }
  if (U === 'alias') {
    for (const D of n) {
      const F = D.text.indexOf('=')
      if (F > 0) nested.push(D.text.slice(F + 1))
    }
    return
  }
  if (U === 'enable' || U === 'hash') {
    const D = n.findIndex(F => F.text === (U === 'enable' ? '-f' : '-p'))
    return D !== -1 && isRelativeWordToken(n[D + 1])
      ? relativeFilePathRefuseCopy()
      : undefined
  }
  if (U === 'exec' || U === ':') return
  if (U === 'find') {
    const D: (string | undefined)[] = []
    for (let F = 0; F < n.length; F += 1) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(n[F].text)) continue
      let ee = F + 1
      while (ee < n.length && n[ee].text !== ';' && n[ee].text !== '+') ee += 1
      const J = n.slice(F + 1, ee)
      if (J.length === 0) continue
      const te = scanArgvAsCommand(J, false, nested, ctx)
      D.push(
        J[0].text === '{}' ||
          peelLaunchers(J).some(ae => ae.program.text === '{}')
          ? relativeFilePathRefuseCopy()
          : te,
      )
      F = ee
    }
    return D.find(F => F !== undefined)
  }
  return
}

/**
 * leftover `Gt` @202256395 BODY 647 B — nested shell unread / too-deep.
 */
export function nestedShellUnreadRefuse(
  text: string,
  make: boolean,
  ctx: ShellScanContext,
  depth = 0,
  seams?: {
    parseShell?: (text: string, opts: { make: boolean }) => ShellParseResult
    scanCommand?: typeof scanShellCommand
  },
): string | undefined {
  const parse = seams?.parseShell ?? defaultParseShell
  const scan = seams?.scanCommand ?? scanShellCommand
  const { commands: h, unreadable: g } = parse(text, { make })
  const v: string[] = []
  const w = new Set(ctx.relativeNames)
  for (const { program: b, args: R, assignments: I } of h) {
    const x = /^(?:export|declare|typeset|local|readonly)$/.test(b.text)
      ? [...I, ...R]
      : I
    for (const P of x) {
      const O = /^([A-Za-z_][A-Za-z0-9_]*)=([^/~$][\s\S]*)$/.exec(P.text)
      if (O !== null) w.add(O[1])
    }
  }
  for (const b of h) {
    const R = scan(b, v, { ...ctx, make, relativeNames: w })
    if (R !== undefined) return R
  }
  if (g !== null) return couldNotBeReadToEndAsShellCopy(g)
  for (const b of v) {
    const R =
      depth >= 3
        ? shellCodeNestedTooDeepRefuseCopy()
        : nestedShellUnreadRefuse(
            b,
            false,
            { ...ctx, fromPayload: true },
            depth + 1,
            seams,
          )
    if (R !== undefined) return R
  }
  return
}

/**
 * leftover `_i` @202256203 — shebang line as nested shell.
 */
function shebangNestedRefuse(
  shebang: string,
  ctx: ShellScanContext,
  seams?: {
    parseShell?: (text: string, opts: { make: boolean }) => ShellParseResult
    scanCommand?: typeof scanShellCommand
  },
): string | undefined {
  const r: string[] = []
  const s: string[] = []
  const parse = seams?.parseShell ?? defaultParseShell
  for (const h of parse(shebang, { make: false }).commands) {
    scanShellCommand(h, r, {
      roots: [],
      home: '',
      fromPayload: false,
      standing: s,
    })
  }
  return (
    s[0] ??
    r
      .map(h =>
        nestedShellUnreadRefuse(
          h,
          false,
          { ...ctx, fromPayload: true },
          1,
          seams,
        ),
      )
      .find(h => h !== undefined)
  )
}

/**
 * leftover `fo` @202254504 BODY 1352 B — payload names / $CLAUDE_PROJECT_DIR /
 * working dir / csh path / unread shell / make include.
 */
export function scriptPayloadRefuse(
  payload: string | Uint8Array,
  roots: string[],
  home: string,
  interpreter?: string | null,
  seams?: {
    parseShell?: (text: string, opts: { make: boolean }) => ShellParseResult
    scanCommand?: typeof scanShellCommand
  },
): string | undefined {
  const g = payloadUtf8(payload)
  const v = g.indexOf('\n')
  const w = g.startsWith('#!') ? g.slice(2, v === -1 ? undefined : v) : ''
  const b = shebangProgramBasename(w)
  const R =
    interpreter !== undefined && interpreter !== null
      ? /^(?:bash|sh|zsh|dash|ash|ksh|mksh|rbash|fish)$/i.test(interpreter)
      : b === '' || SHELL_BASENAME.test(b) || MAKE_OR_AWK.test(b)
  const I = g.startsWith('#!') ? (v === -1 ? '' : g.slice(v + 1)) : g
  const x = w + '\n' + (R ? I : g.replace(HASH_COMMENT_LINE, ''))
  const P = posixPathText(x)
  const O = uniqueStrings(roots)
    .flatMap(j => pathNameSpellings(j, home))
    .find(j =>
      new RegExp(
        `(?<![\\w./~$-])${escapeRegExp(posixPathText(j))}${j.endsWith('/') ? '' : '(?![\\w.-])'}`,
      ).test(P),
    )
  if (O !== undefined) return namesPathRefuseCopy(O)
  if (CLAUDE_PROJECT_DIR_RE.test(P)) return readsClaudeProjectDirRefuseCopy()
  if (RELATIVE_CWD_ADDR.test(P) || (R && PWD_ADDR.test(P))) {
    return addressesWorkingDirectoryRefuseCopy()
  }
  const q = (interpreter ?? b).toLowerCase()
  if (
    /^t?csh$/.test(q) &&
    Array.from(
      I.matchAll(/^[ \t]*set[ \t]+path[ \t]*=[ \t]*\(([^)\n]*)\)/gm),
    ).some(j =>
      splitCshPathWords(j[1]).some(A => A === '.' || !/^[/~$]/.test(A)),
    )
  ) {
    return cshPathWorkingDirRefuseCopy()
  }
  let T: string | undefined
  try {
    const j: ShellScanContext = {
      roots: uniqueStrings(roots),
      home,
      fromPayload: false,
      shell: q,
    }
    T =
      (R
        ? nestedShellUnreadRefuse(
            I,
            MAKE_OR_AWK.test(shebangProgramBasename(w)),
            j,
            0,
            seams,
          )
        : undefined) ?? shebangNestedRefuse(w, j, seams)
  } catch {
    T = couldNotBeReadAsShellRefuseCopy()
  }
  if (T !== undefined) return T
  if (MAKE_OR_AWK.test(shebangProgramBasename(w)) && makeIncludesRelative(x)) {
    return includesRelativeBuildFileRefuseCopy()
  }
  return
}

/**
 * leftover `Ei` @202257543 BODY 1086 B — settingsFile vs extraReach/sync root.
 * Injected realpath/judge like composeExtraReachBag. No laptop FS engine.
 */
export async function holdReasonForSettingsFileVsSyncRoot(
  source: { settingsFile: string | null },
  ctx: SettingsFileHoldContext,
): Promise<CloudHookHoldReason | null> {
  const r = ctx.opts.sync?.rootReal
  if (
    source.settingsFile === null ||
    (r === undefined && ctx.roots.extraReach.length === 0)
  ) {
    return null
  }
  const s = source.settingsFile
  const judge =
    ctx.judge ??
    (async (path: string): Promise<ExtraReachJudgement> => ({
      spelling: path,
      verdict: 'local',
    }))
  const h = await judge(s, ctx.opts.launchDir)
  if (h.verdict !== 'local') {
    return CLOUD_HOOK_HOLD_REASON.source_in_sync_root
  }
  let g: string
  try {
    g = await ctx.deps.realpath(h.spelling)
  } catch {
    return CLOUD_HOOK_HOLD_REASON.source_in_sync_root
  }
  const v = [s, h.spelling, g].map(posixPathText)
  const windows = ctx.platform === 'windows'
  const b = windows ? /[\\/]/ : '/'
  const R = [
    ...(r !== undefined ? [r] : []),
    ...(ctx.opts.sync?.root !== undefined ? [ctx.opts.sync.root] : []),
    ...ctx.roots.extraReach,
  ].map(q =>
    windows
      ? posixPathText(q).replace(/[\\/]+$/, '') || '/'
      : posixPathText(q.replace(/\/+$/, '') || '/'),
  )
  if (R.some(q => v.some(T => !pathIsUnder(T, q) && pathIsUnder(T, q)))) {
    return CLOUD_HOOK_HOLD_REASON.source_in_sync_root
  }
  const I = R.filter(q => v.some(T => pathIsUnder(T, q)))
  const x = v.flatMap(q =>
    I.flatMap(T =>
      pathIsUnder(q, T)
        ? [q === T ? '' : q.slice(T === '/' ? 1 : T.length + 1)]
        : [],
    ),
  )
  if (x.length === 0) return null
  const P = uniqueStrings(
    [ctx.roots.configHomeReal, ctx.opts.configHome]
      .filter((q): q is string => q !== undefined)
      .map(posixPathText),
  )
  if (
    I.some(
      q =>
        P.some(T => q === T || pathIsUnder(q, T) || pathIsUnder(T, q)) ||
        q.split(b as string).includes('.claude'),
    )
  ) {
    return CLOUD_HOOK_HOLD_REASON.sync_root_is_config_dir
  }
  return x.some(q => !q.split(b as string).some(T => T.startsWith('.')))
    ? CLOUD_HOOK_HOLD_REASON.source_in_sync_root
    : null
}

/** leftover `ySn` `v` hold — after_edit / kind_unsupported / other. */
export function holdCloudHookSite(
  pack: CloudHooksEmptyPack,
  site: CloudHookComposeSite,
  reason: string,
): void {
  pack.held.push({
    event: site.event,
    ...(site.matcher !== undefined && {
      matcher: leftoverMatcherClip(site.matcher),
    }),
    source: site.source.source,
    command: site.hook?.command,
    reason,
  })
  if (reason === 'after_edit') pack.heldCounts.after_edit += 1
  else if (reason === 'kind_unsupported') pack.heldCounts.kind_unsupported += 1
  else pack.heldCounts.other += 1
}

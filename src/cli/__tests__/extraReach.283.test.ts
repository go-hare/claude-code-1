/**
 * densable 2.1.283 leftover gold `ySn` @202270861 wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CLOUD_HOOK_FORWARDED_CAP,
  CLOUD_HOOK_PER_EVENT_CAP,
  CLOUD_HOOK_READONLY_TEMPLATES,
  CLOUD_HOOK_SOURCE_COPY,
  CLOUD_HOOK_TEMPLATE_CAP,
  CLOUD_HOOK_UNVERIFIABLE_TARGET,
  HOOKS_STAY_UNPLACEABLE_COPY,
  cloudHookTemplatesOverCapCopy,
  cloudHooksEventOverCapCopy,
  cloudHooksOfferedOverCapCopy,
  composeExtraReachBag,
  composeExtraReachForCloudHooks,
  emptyCloudHooksPack,
  cloudHookSourceCopy,
  duplicateCloudScriptCopy,
  duplicateHookConfiguredOnceCopy,
  leftoverHookAttestationBag,
  cloudHooksNotOfferedFromFileCopy,
  cloudDeviceMarkNotHonouredInCheckoutCopy,
  gitHookEnvClearedRefuseCopy,
  gitExecPathInLaunchDirRefuseCopy,
  gitHooksPathOnRefuseCopy,
  gitConfigIncludedFromLaunchDirRefuseCopy,
  gitConfigRunsFromCheckoutRefuseCopy,
  phpLoadsRelativeFileRefuseCopy,
  pythonInteractiveStdinRefuseCopy,
  pythonImportsWorkingDirRefuseCopy,
  namesPathRefuseCopy,
  readsClaudeProjectDirRefuseCopy,
  addressesWorkingDirectoryRefuseCopy,
  cshPathWorkingDirRefuseCopy,
  couldNotBeReadAsShellRefuseCopy,
  includesRelativeBuildFileRefuseCopy,
  couldNotBeReadToEndAsShellCopy,
  shellCodeNestedTooDeepRefuseCopy,
  CLOUD_HOOK_HOLD_REASON,
  cloudHookHoldReasonToken,
  cloudHookEventTooLargeCopy,
  cloudHookTooManyInHandCopy,
  nestsCommandSubstitutionsRefuseCopy,
  arrayAssignmentHoldsNonWordsRefuseCopy,
  closingParenClosesNothingRefuseCopy,
  caseStatementNeverClosedRefuseCopy,
  arrayAssignmentNeverClosedRefuseCopy,
  dollarOrParenNeverClosedRefuseCopy,
  singleQuoteNeverClosedRefuseCopy,
  ansiQuoteNeverClosedRefuseCopy,
  doubleQuoteNeverClosedRefuseCopy,
  dollarBraceCommandSubstitutionRefuseCopy,
  dollarBraceNeverClosedRefuseCopy,
  backtickNeverClosedRefuseCopy,
  heredocNeverTerminatedRefuseCopy,
  unsetsGitHooksOffEnvRefuseCopy,
  unsetsPathWorkingDirLookupRefuseCopy,
  commandNameBuiltByExpansionRefuseCopy,
  commandHeldInVariableRefuseCopy,
  relativeFilePathRefuseCopy,
  loopsOverFilesInLaunchDirRefuseCopy,
  interpreterProgramOnPipeRefuseCopy,
  sourcesRelativeFileRefuseCopy,
  unvouchedCommandOrFileRefuseCopy,
  projectToolingReadsCheckoutRefuseCopy,
  readsWorkingDirConfigRefuseCopy,
  compoundCommandInputFromLaunchDirRefuseCopy,
  relativeScriptNameRefuseCopy,
  perlLibRelativeRefuseCopy,
  rubyLibRelativeRefuseCopy,
  nodePreloadWorkingDirRefuseCopy,
  nodeBareOrRelativeModuleRefuseCopy,
  luaLoadWorkingDirRefuseCopy,
  unknownInterpreterOptionRefuseCopy,
  javaWorkingDirClassPathRefuseCopy,
  wrapsCommandMoreThanFourLayersRefuseCopy,
  envDashPRelativeDirRefuseCopy,
  parallelNoCommandRefuseCopy,
  scriptNoCommandRefuseCopy,
  suNoCommandRefuseCopy,
  runuserNoCommandRefuseCopy,
  sudoDoasNoCommandRefuseCopy,
  pwshEncodedCommandRefuseCopy,
  shellRcFileFromLaunchDirRefuseCopy,
  shellProgramOnPipeRefuseCopy,
  shellCommandFromVariableRefuseCopy,
  xargsSplicesFromInputRefuseCopy,
  xargsArgsFromLaunchDirFileRefuseCopy,
  envAssignWorkingDirRefuseCopy,
  envAssignZshTiedWorkingDirRefuseCopy,
  envAssignPhpIniWorkingDirRefuseCopy,
  envAssignLoadsNamedRefuseCopy,
  envAssignToolRunsWorkingDirFileRefuseCopy,
  PHP_INI_SCAN_DIR,
  cloudHookEntrySkipCopy,
  cloudHookEntryDeviceAfterEditCopy,
  cloudHookEntryUnreadableAtStartupCopy,
  cloudHookEntryInReachCopy,
  cloudHookEntryInterpreterUnvouchedCopy,
  cloudHookEntryLoadsFromReachCopy,
  cloudHookEntryDeviceScriptChangedCopy,
  cloudHookEntryShellPrefixCopy,
  cloudHookEntryPrivateDotdirCopy,
  cloudHookEntryUnpinnedCommandCopy,
  cloudHookAfterEditNotForwardedCopy,
  cloudHookNotRunInCloudAfterEditCopy,
  cloudHookNotRunInCloudCopy,
  cloudHookConfiguredOnEventsCopy,
  INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV,
  INTERPRETER_SANDBOX_WRITE_INLET_COVERS,
  INTERPRETER_IT_NAMES,
  INTERPRETER_HASHBANG_NAMES,
  INTERPRETER_CANNOT_BE_LOCATED,
  INTERPRETER_MAY_LOAD_FROM_CHECKOUT,
  cloudHookOlderCopyNotRunCopy,
  cloudHookOlderCopyCloudRunsCopy,
  cloudHookCannotReproduceCopy,
  cloudHookMatcherRunsOnCopy,
  cloudHookMatcherCloudOnlyCopy,
  cloudHookCannotMoveCopy,
  cloudHookCannotMoveAfterEditCopy,
  cloudHookPatternMatcherLocalOnlyCopy,
  CLOUD_HOOK_ENTRY_REASON,
  cloudHookEntryReasonToken,
  extraReachHasUnplaceableRoot,
  extraReachVolumeRoots,
  hooksCouldRunForCloudCopy,
  hooksCouldRunForCloudFromPack,
  isPlaceableAbsolutePath,
  mapExtraReachRoot,
  tokenizeArgv,
  gitArgvRefuse,
  phpArgvLoadsRelativeRefuse,
  pythonArgvRefuse,
  envAssignArgvRefuse,
  scriptPayloadRefuse,
  nestedShellUnreadRefuse,
  holdReasonForSettingsFileVsSyncRoot,
  holdCloudHookSite,
  scanShellCommand,
  cloudHookIdentityKey,
  type ShellCommand,
} from '../extraReach.js'

const src = readFileSync(join(import.meta.dir, '../extraReach.ts'), 'utf8')

describe('extraReach 283 leftover gold ySn wrap', () => {
  test('source-locks gold ySn unique strings; no minify public API', () => {
    expect(src).toContain('gold `ySn` @202270861')
    expect(src).toContain('launchDirReal')
    expect(src).toContain("verdict === 'foreign'")
    expect(src).toContain('extraReachRoots')
    expect(src).toContain('HOOKS_STAY_UNPLACEABLE_COPY')
    expect(src).toContain('gold leftover unique `vo`')
    expect(src).toContain('gold leftover unique `Hi`')
    expect(src).toContain('run /hooks to decide')
    expect(src).toContain('the cloud runs it once.')
    expect(src).toContain('the rest stay on this machine.')
    expect(src).toContain('your user settings')
    expect(src).toContain("this checkout's settings.local.json")
    expect(src).toContain('the --settings file')
    expect(src).toContain('gh-api-readonly')
    expect(src).toContain('ruff-autofix')
    expect(src).toContain('unverifiable_target')
    expect(src).toContain(
      'gold leftover unique `_o` @202276282 BODY lives in leftoverTulip.ts',
    )
    expect(src).toContain('gold leftover unique `ko` @202260269')
    expect(src).toContain('mark is not honoured in a file inside the checkout')
    expect(src).toContain('leftover `pi` @202250082')
    expect(src).toContain('leftover `gi` @202251842')
    expect(src).toContain('leftover `ro` @202252766')
    expect(src).toContain('leftover `fo` @202254504')
    expect(src).toContain('leftover `Gt` @202256395')
    expect(src).toContain('leftover `Ei` @202257543')
    expect(src).toContain('leftover `Xt` @202257218')
    expect(src).toContain('leftover `St` @202223213')
    expect(src).toContain(
      'is an after-edit hook, so it is not forwarded either',
    )
    expect(src).toContain('is not run in the cloud in this version')
    expect(src).toContain('cannot be vouched for from here')
    expect(src).toContain('a sandbox write inlet covers it')
    expect(src).toContain('the interpreter its #! line names')
    expect(src).toContain('author_skip')
    expect(src).toContain('container_internal')
    expect(src).toContain('script_in_reach')
    expect(src).toContain('script_outside_reach')
    expect(src).toContain('private_dotdir')
    expect(src).toContain(
      'may load settings or code from the checkout, where the hook starts and which the cloud session can write',
    )
    expect(src).toContain('the cloud will not run it. Update it from dotfiles.')
    expect(src).toContain('cannot move to the cloud here.')
    expect(src).toContain('which a cloud session cannot take')
    expect(src).toContain(
      'it runs git with the environment that switches its repository hooks off cleared or edited',
    )
    expect(src).toContain(
      'it runs php with -z, -c or a -d setting that loads a file (auto_prepend_file, include_path, extension…), naming one that is relative or in the reach',
    )
    expect(src).toContain(
      'it runs python with -i, which goes on to run standard input after its program',
    )
    expect(src).toContain('it reads $CLAUDE_PROJECT_DIR')
    expect(src).toContain('it could not be read to the end as shell')
    expect(src).toContain('sync_root_is_config_dir')
    expect(src).toContain('leftover `Ln`/`Er` @202200073')
    expect(src).toContain('leftover `ot` @202209140')
    expect(src).toContain('leftover `St` @202224300')
    expect(src).toContain('leftover `lo`/`Vt` @202234178')
    expect(src).toContain('leftover `ni` @202237032')
    expect(src).toContain('leftover `li` @202241335')
    expect(src).toContain('leftover `oo` @202248847')
    expect(src).toContain(
      'leftover `ko` @202260269 — unique `This entry for "`',
    )
    expect(src).toContain(
      'not run — the event was too large to judge on ${displayName}; retry with less',
    )
    expect(src).toContain('it nests command substitutions more deeply')
    expect(src).toContain('a heredoc is never terminated')
    expect(src).toContain('it unsets PATH, after which a command name')
    expect(src).toContain('it wraps a command in more than four layers')
    expect(src).toContain('it hands pwsh an encoded command')
    expect(src).toContain('it runs what xargs splices into the command')
    expect(src).toContain('PHP_INI_SCAN_DIR')
    expect(src).toContain('which zsh ties to')
    expect(src).toContain(
      'This entry for "${entry}" in ${source} is marked cloud: "skip"',
    )
    expect(src).not.toMatch(/^export (async )?function ySn\b/m)
    expect(src).not.toMatch(/^export (async )?function ko\b/m)
    expect(src).not.toMatch(/^export (async )?function Ei\b/m)
    expect(src).not.toMatch(/^export (async )?function Xt\b/m)
    expect(src).not.toMatch(/^export (async )?function pi\b/m)
    expect(src).not.toMatch(/^export (async )?function gi\b/m)
    expect(src).not.toMatch(/^export (async )?function ro\b/m)
    expect(src).not.toMatch(/^export (async )?function fo\b/m)
    expect(src).not.toMatch(/^export (async )?function Gt\b/m)
    expect(src).not.toMatch(/^export (async )?function St\b/m)
    expect(src).not.toMatch(/^export (async )?function ot\b/m)
    expect(src).not.toMatch(/^export (async )?function Ln\b/m)
    expect(src).not.toMatch(/^export (async )?function Er\b/m)
    expect(src).not.toMatch(/^export (async )?function lo\b/m)
    expect(src).not.toMatch(/^export (async )?function Vt\b/m)
    expect(src).not.toMatch(/^export (async )?function ni\b/m)
    expect(src).not.toMatch(/^export (async )?function li\b/m)
    expect(src).not.toMatch(/^export (async )?function oo\b/m)
    expect(src).toContain('function gitArgvRefuse')
    expect(src).toContain('function phpArgvLoadsRelativeRefuse')
    expect(src).toContain('function pythonArgvRefuse')
    expect(src).toContain('function envAssignArgvRefuse')
    expect(src).toContain('function scriptPayloadRefuse')
    expect(src).toContain('function nestedShellUnreadRefuse')
    expect(src).toContain('function scanShellCommand')
    expect(src).toContain('WRAP_LAYER_CAP = 4')
    expect(src).toContain('function cloudHookIdentityKey')
    expect(src).toContain('function holdReasonForSettingsFileVsSyncRoot')
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('tI placeable absolute; unplaceable notice 1:1', () => {
    expect(isPlaceableAbsolutePath('/tmp')).toBe(true)
    expect(isPlaceableAbsolutePath('relative')).toBe(false)
    expect(HOOKS_STAY_UNPLACEABLE_COPY).toBe(
      'Hooks stay on this machine: its launch, config or sync directory is not an absolute path this version can place, so none are offered to the cloud session.',
    )
    expect(
      extraReachHasUnplaceableRoot({
        launchDir: '/tmp',
        extraReachRoots: ['not-absolute'],
      }),
    ).toBe(true)
    expect(
      extraReachHasUnplaceableRoot({
        launchDir: '/tmp',
        extraReachRoots: ['/extra'],
      }),
    ).toBe(false)
  })

  test('local / foreign / else extraReach map; launchDirReal bag', async () => {
    expect(
      extraReachVolumeRoots(
        { spelling: '/other-host', verdict: 'foreign' },
        '/launch',
      ),
    ).toEqual(['/other-host'])
    expect(
      extraReachVolumeRoots({ spelling: '/x', verdict: 'opaque' }, '/launch'),
    ).toEqual(['/'])

    expect(
      await mapExtraReachRoot('/repo', {
        launchDir: '/launch',
        realpath: async p => `${p}-real`,
        judge: async path => ({ spelling: path, verdict: 'local' }),
      }),
    ).toEqual(['/repo', '/repo-real'])
    expect(
      await mapExtraReachRoot('/foreign', {
        launchDir: '/launch',
        realpath: async p => p,
        judge: async () => ({ spelling: '/other', verdict: 'foreign' }),
      }),
    ).toEqual(['/other'])
    expect(
      await mapExtraReachRoot('/opaque', {
        launchDir: '/launch',
        realpath: async p => p,
        judge: async path => ({ spelling: path, verdict: 'unreadable' }),
      }),
    ).toEqual(['/opaque', '/'])

    const bag = await composeExtraReachBag({
      launchDir: '/launch',
      projectDir: '/proj',
      configHome: '/home/.claude',
      repoRoot: '/repo',
      extraReachRoots: ['/extra', '/repo'],
      realpath: async p => `${p}-real`,
      judge: async path => ({ spelling: path, verdict: 'local' }),
    })
    expect(bag.launchDirReal).toBe('/launch-real')
    expect(bag.projectDirReal).toBe('/proj-real')
    expect(bag.configHomeReal).toBe('/home/.claude-real')
    expect(bag.extraReach).toEqual([
      '/repo',
      '/repo-real',
      '/extra',
      '/extra-real',
    ])
  })

  test('ySn kind none empty pack; unplaceable notice; no fleet', async () => {
    const none = await composeExtraReachForCloudHooks({
      kind: 'none',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      realpath: async p => p,
    })
    expect(none.pack).toEqual({
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
    })
    expect(none.roots).toBeUndefined()

    const held = await composeExtraReachForCloudHooks({
      kind: 'forward',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      extraReachRoots: ['relative'],
      realpath: async p => p,
    })
    expect(held.pack.notices).toEqual([HOOKS_STAY_UNPLACEABLE_COPY])
    expect(held.pack.held).toEqual([{ reason: CLOUD_HOOK_UNVERIFIABLE_TARGET }])
    expect(held.pack.heldCounts.other).toBe(1)
    expect(held.roots?.launchDirReal).toBe('/l')
  })

  test('ySn leftover unique Hi/vo/over_cap copies 1:1', () => {
    expect(duplicateHookConfiguredOnceCopy('format')).toBe(
      'format is configured more than once; the cloud runs it once.',
    )
    expect(hooksCouldRunForCloudCopy(1)).toBe(
      'One of your hooks could run for cloud sessions started from this machine — run /hooks to decide (nothing from this machine runs for them until you do).',
    )
    expect(hooksCouldRunForCloudCopy(3)).toBe(
      '3 of your hooks could run for cloud sessions started from this machine — run /hooks to decide (nothing from this machine runs for them until you do).',
    )
    expect(CLOUD_HOOK_TEMPLATE_CAP).toBe(8)
    expect(CLOUD_HOOK_FORWARDED_CAP).toBe(128)
    expect(CLOUD_HOOK_PER_EVENT_CAP).toBe(64)
    expect(cloudHookTemplatesOverCapCopy(CLOUD_HOOK_TEMPLATE_CAP)).toBe(
      'Only 8 templates can run in the cloud session; the rest stay on this machine.',
    )
    expect(cloudHooksOfferedOverCapCopy(CLOUD_HOOK_FORWARDED_CAP)).toBe(
      'Only the first 128 hooks are offered to the cloud session; the rest stay on this machine.',
    )
    expect(
      cloudHooksEventOverCapCopy(CLOUD_HOOK_PER_EVENT_CAP, 'PreToolUse'),
    ).toBe(
      'Only the first 64 PreToolUse hooks are offered to the cloud session; the rest stay on this machine.',
    )
    expect(
      hooksCouldRunForCloudFromPack({
        forwarded: 1,
        templateNames: [],
      }),
    ).toBe(hooksCouldRunForCloudCopy(1))
    expect(duplicateCloudScriptCopy('bun test', 'fmt')).toBe(
      '"bun test" is the same script the cloud already runs as fmt; it is not also run on this machine.',
    )
    expect(CLOUD_HOOK_SOURCE_COPY).toEqual({
      user: 'your user settings',
      local: "this checkout's settings.local.json",
      flag: 'the --settings file',
    })
    expect(cloudHookSourceCopy('user')).toBe('your user settings')
    expect(cloudHookSourceCopy('unknown')).toBeUndefined()
    expect(CLOUD_HOOK_READONLY_TEMPLATES).toEqual([
      'gh-api-readonly',
      'ruff-autofix',
    ])
    expect(
      leftoverHookAttestationBag('VERIFIED', { tulipMode: () => 'off' }),
    ).toBeUndefined()
    expect(
      leftoverHookAttestationBag('VERIFIED', { tulipMode: () => 'observe' }),
    ).toEqual({
      attestation: {
        mode: 'observe',
        status: 'VERIFIED',
        verdict: 'not_policed',
      },
      heldBack: false,
    })
    expect(
      cloudHooksNotOfferedFromFileCopy(
        '/tmp/hooks.json',
        'source_in_sync_root',
      ),
    ).toBe(
      'Hooks from /tmp/hooks.json are not offered to the cloud session: the file sits where the cloud session can write on this machine (the synced directory or a sandbox write inlet), so the session could rewrite it (or it could no longer be resolved on this machine).',
    )
    expect(cloudHooksNotOfferedFromFileCopy('/tmp/hooks.json', 'other')).toBe(
      'Hooks from /tmp/hooks.json are not offered to the cloud session: a directory the cloud session can write on this machine is a Claude config directory.',
    )
    expect(cloudDeviceMarkNotHonouredInCheckoutCopy()).toBe(
      ' (Its cloud: "device" mark is not honoured in a file inside the checkout; mark it in your user settings instead.)',
    )
  })

  test('leftover pi/gi/ro/fo/Gt/Ei hook refuse copies 1:1', () => {
    expect(gitHookEnvClearedRefuseCopy()).toBe(
      'it runs git with the environment that switches its repository hooks off cleared or edited',
    )
    expect(gitExecPathInLaunchDirRefuseCopy()).toBe(
      'it runs git with an exec path in the launch directory (git-* commands come from there)',
    )
    expect(gitHooksPathOnRefuseCopy()).toBe(
      "it runs git with the repository's own hooks switched back on (core.hooksPath), which run files the session writes",
    )
    expect(gitConfigIncludedFromLaunchDirRefuseCopy()).toBe(
      'it runs git with a configuration file included from the launch directory',
    )
    expect(gitConfigRunsFromCheckoutRefuseCopy('core.fsmonitor')).toBe(
      'it runs git with core.fsmonitor set on the command line to something that runs from the checkout',
    )
    expect(phpLoadsRelativeFileRefuseCopy()).toBe(
      'it runs php with -z, -c or a -d setting that loads a file (auto_prepend_file, include_path, extension…), naming one that is relative or in the reach',
    )
    expect(pythonInteractiveStdinRefuseCopy()).toBe(
      'it runs python with -i, which goes on to run standard input after its program',
    )
    expect(pythonImportsWorkingDirRefuseCopy()).toBe(
      'it runs python in a mode that imports from the working directory first (-m, -c or a program on stdin, without -P or -I)',
    )
    expect(namesPathRefuseCopy('foo"bar')).toBe('it names foobar')
    expect(readsClaudeProjectDirRefuseCopy()).toBe(
      'it reads $CLAUDE_PROJECT_DIR',
    )
    expect(addressesWorkingDirectoryRefuseCopy()).toBe(
      'it addresses its working directory (the launch directory, for a forwarded hook)',
    )
    expect(cshPathWorkingDirRefuseCopy()).toBe(
      'it sets path, which csh ties to PATH, with the working directory (or a relative entry) on it',
    )
    expect(couldNotBeReadAsShellRefuseCopy()).toBe(
      'it could not be read as shell (the reading itself failed on it)',
    )
    expect(includesRelativeBuildFileRefuseCopy()).toBe(
      'it includes another build file, plugin or awk source by a relative name (make include or load, awk @include)',
    )
    expect(couldNotBeReadToEndAsShellCopy('unclosed quote')).toBe(
      'it could not be read to the end as shell (unclosed quote)',
    )
    expect(shellCodeNestedTooDeepRefuseCopy()).toBe(
      'it hands shell code to a shell more times over than this reading follows',
    )
    expect(CLOUD_HOOK_HOLD_REASON.sync_root_is_config_dir).toBe(
      'sync_root_is_config_dir',
    )
    expect(CLOUD_HOOK_HOLD_REASON.source_in_sync_root).toBe(
      'source_in_sync_root',
    )
    expect(cloudHookHoldReasonToken('sync_root_is_config_dir')).toBe(
      'sync_root_is_config_dir',
    )
    expect(cloudHookHoldReasonToken('source_in_sync_root')).toBe(
      'source_in_sync_root',
    )
    expect(cloudHookHoldReasonToken('other')).toBeUndefined()
  })

  test('leftover Ln/ot/St/lo/ni/li/oo/ko unique refuse copies 1:1', () => {
    expect(cloudHookEventTooLargeCopy('PreToolUse')).toBe(
      'not run — the event was too large to judge on PreToolUse; retry with less',
    )
    expect(cloudHookTooManyInHandCopy('PreToolUse')).toBe(
      'not run — PreToolUse has too many hook requests from the cloud session in hand at once; retry',
    )
    expect(nestsCommandSubstitutionsRefuseCopy()).toBe(
      'it nests command substitutions more deeply than this reading follows',
    )
    expect(arrayAssignmentHoldsNonWordsRefuseCopy()).toBe(
      'an array assignment holds something other than words',
    )
    expect(closingParenClosesNothingRefuseCopy()).toBe(
      'a closing parenthesis that closes nothing',
    )
    expect(caseStatementNeverClosedRefuseCopy()).toBe(
      'a case statement that is never closed',
    )
    expect(arrayAssignmentNeverClosedRefuseCopy()).toBe(
      'an array assignment that is never closed',
    )
    expect(dollarOrParenNeverClosedRefuseCopy()).toBe(
      'a $( or ( that is never closed',
    )
    expect(singleQuoteNeverClosedRefuseCopy()).toBe(
      'a single quote that is never closed',
    )
    expect(ansiQuoteNeverClosedRefuseCopy()).toBe(
      "a $' quote that is never closed",
    )
    expect(doubleQuoteNeverClosedRefuseCopy()).toBe(
      'a double quote that is never closed',
    )
    expect(dollarBraceCommandSubstitutionRefuseCopy()).toBe(
      'a ${ …; } command substitution, which this reading does not follow',
    )
    expect(dollarBraceNeverClosedRefuseCopy()).toBe('a ${ that is never closed')
    expect(backtickNeverClosedRefuseCopy()).toBe(
      'a backtick that is never closed',
    )
    expect(heredocNeverTerminatedRefuseCopy()).toBe(
      'a heredoc is never terminated',
    )
    expect(unsetsGitHooksOffEnvRefuseCopy()).toBe(
      "it unsets the environment that switches git's repository hooks off for this hook",
    )
    expect(unsetsPathWorkingDirLookupRefuseCopy()).toBe(
      'it unsets PATH, after which a command name is looked up in the working directory',
    )
    expect(commandNameBuiltByExpansionRefuseCopy()).toBe(
      'it runs a command whose name is built by an expansion this reading does not perform',
    )
    expect(commandHeldInVariableRefuseCopy()).toBe(
      'it runs a command held in a variable or produced by another command, which this reading cannot follow',
    )
    expect(relativeFilePathRefuseCopy()).toBe(
      'it runs a file by a relative path (looked up in the launch directory)',
    )
    expect(loopsOverFilesInLaunchDirRefuseCopy('*')).toBe(
      'it loops over files in the launch directory (for … in * …)',
    )
    expect(interpreterProgramOnPipeRefuseCopy()).toBe(
      'it runs a shell or interpreter whose program arrives on a pipe, a heredoc or a descriptor, which this reading cannot follow',
    )
    expect(sourcesRelativeFileRefuseCopy()).toBe(
      'it sources a file by a relative name (looked up in the launch directory)',
    )
    expect(unvouchedCommandOrFileRefuseCopy('find')).toBe(
      'it runs find with a command or file this reading cannot follow or vouch for',
    )
    expect(projectToolingReadsCheckoutRefuseCopy()).toBe(
      'it runs project tooling that reads the checkout (make, npm, pytest, cargo…)',
    )
    expect(readsWorkingDirConfigRefuseCopy('Rscript')).toBe(
      'it runs Rscript, which reads configuration from the working directory (the checkout)',
    )
    expect(compoundCommandInputFromLaunchDirRefuseCopy()).toBe(
      "it reads a compound command's input from a file in the launch directory",
    )
    expect(relativeScriptNameRefuseCopy()).toBe(
      'it runs a script by a relative name (looked up in the launch directory)',
    )
    expect(perlLibRelativeRefuseCopy()).toBe(
      'it runs perl with -I or the lib pragma naming a relative or in-reach directory, which imports from the working directory',
    )
    expect(rubyLibRelativeRefuseCopy()).toBe(
      'it runs ruby with -I naming a relative or in-reach directory, or -r with a ./ or in-reach path (or bundler/setup, which reads ./Gemfile), which import from the working directory',
    )
    expect(nodePreloadWorkingDirRefuseCopy()).toBe(
      'it runs node with a preload (--require/--import), which resolves from the working directory',
    )
    expect(nodeBareOrRelativeModuleRefuseCopy()).toBe(
      'it runs node code that loads a module by a bare or relative name, which resolves from the working directory',
    )
    expect(luaLoadWorkingDirRefuseCopy()).toBe(
      'it runs lua with -l, which loads from the working directory first',
    )
    expect(unknownInterpreterOptionRefuseCopy()).toBe(
      'it runs an interpreter with an option this reading does not know ahead of its script',
    )
    expect(javaWorkingDirClassPathRefuseCopy()).toBe(
      'it runs java with the working directory on its class path',
    )
    expect(wrapsCommandMoreThanFourLayersRefuseCopy()).toBe(
      'it wraps a command in more than four layers of commands that run a command (find -exec, parallel, script, op run, direnv exec…), which this reading does not follow',
    )
    expect(envDashPRelativeDirRefuseCopy()).toBe(
      'it runs env with -P naming a relative directory, where the program is then looked up (the launch directory)',
    )
    expect(parallelNoCommandRefuseCopy()).toBe(
      'it runs parallel with no command of its own, so each line of its input runs as a command',
    )
    expect(scriptNoCommandRefuseCopy()).toBe(
      'it runs script with no command of its own, so the shell it starts reads its commands from its input',
    )
    expect(suNoCommandRefuseCopy()).toBe(
      'it runs su with no command, so the shell it starts reads its commands from its input',
    )
    expect(runuserNoCommandRefuseCopy()).toBe(
      'it runs runuser with no command, so the shell it starts reads its commands from its input',
    )
    expect(sudoDoasNoCommandRefuseCopy()).toBe(
      'it starts a shell through sudo or doas with no command, so that shell reads its commands from its input',
    )
    expect(pwshEncodedCommandRefuseCopy()).toBe(
      'it hands pwsh an encoded command, which this reading cannot follow',
    )
    expect(shellRcFileFromLaunchDirRefuseCopy('bash')).toBe(
      'it runs bash with an rc file from the launch directory',
    )
    expect(shellProgramOnPipeRefuseCopy()).toBe(
      'it runs a shell whose program arrives on a pipe, a heredoc or a descriptor, which this reading cannot follow',
    )
    expect(shellCommandFromVariableRefuseCopy()).toBe(
      'it hands a shell a command held in a variable or produced by another command, which this reading cannot follow',
    )
    expect(xargsSplicesFromInputRefuseCopy()).toBe(
      'it runs what xargs splices into the command from its input',
    )
    expect(xargsArgsFromLaunchDirFileRefuseCopy()).toBe(
      'it runs xargs with its arguments read from a file in the launch directory',
    )
    expect(envAssignWorkingDirRefuseCopy('PATH')).toBe(
      'it sets PATH with the working directory (or a relative entry) on it',
    )
    expect(envAssignZshTiedWorkingDirRefuseCopy('path')).toBe(
      'it sets path, which zsh ties to PATH, with the working directory (or a relative entry) on it',
    )
    expect(envAssignPhpIniWorkingDirRefuseCopy('PHPRC')).toBe(
      'it sets PHPRC to a php.ini location in the working directory (or a relative one)',
    )
    expect(envAssignLoadsNamedRefuseCopy('GIT_CONFIG_GLOBAL')).toBe(
      'it sets GIT_CONFIG_GLOBAL, which makes a shell, an interpreter or git load what it names',
    )
    expect(envAssignToolRunsWorkingDirFileRefuseCopy('EDITOR', './bin')).toBe(
      'it sets EDITOR, which a tool runs or loads, to a file in the working directory (./bin)',
    )
    expect(PHP_INI_SCAN_DIR).toBe('PHP_INI_SCAN_DIR')
    expect(cloudHookEntrySkipCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings is marked cloud: "skip" (or a value this version does not recognise) and stays on this machine.',
    )
    expect(cloudHookEntryDeviceAfterEditCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings is marked cloud: "device" but runs after a file edit, which this version never forwards; it runs in local sessions only.',
    )
    expect(
      cloudHookEntryUnreadableAtStartupCopy('/tmp/h.sh', 'your user settings'),
    ).toBe(
      'This entry for /tmp/h.sh in your user settings could not be read and pinned at start-up (missing, too large, not a regular file, more than one hard link, or it resolves to a file this machine does not read as a hook script), so it is not offered to the cloud session.',
    )
    expect(cloudHookEntryInReachCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings sits where the cloud session can write on this machine (the checkout, the synced directory or a sandbox write inlet), so it is not offered to the cloud session. Move the script outside the checkout (under ~/.claude, say) to have it forwarded; marking it cloud: "device" instead runs it for cloud sessions from this path — the entry file is pinned, but anything it loads from the checkout is whatever the session last wrote there, run on this machine outside the sandbox.',
    )
    expect(
      cloudHookEntryInterpreterUnvouchedCopy(
        'fmt',
        'your user settings',
        '/tmp/python',
        'cannot be located on this machine',
      ),
    ).toBe(
      'This entry for "fmt" in your user settings runs its script with /tmp/python, which cannot be located on this machine, so it is not offered to the cloud session. Run it with an interpreter this version knows (such as bash, python3 or node), found on your PATH (#!/usr/bin/env python3) or named by a full path outside what the session can write, with no options or only simple switches this version knows (bash -eu, python3 -I); marking it cloud: "device" instead runs it as written.',
    )
    expect(
      cloudHookEntryLoadsFromReachCopy('fmt', 'your user settings', './lib.py'),
    ).toBe(
      'This entry for "fmt" in your user settings is a script outside the checkout, but ./lib.py — code or data the cloud session can write — so it is not offered to the cloud session. Marking it cloud: "device" runs it anyway (you vouch for what it loads); otherwise have it load its helpers by an absolute path outside the checkout.',
    )
    expect(
      cloudHookEntryDeviceScriptChangedCopy('fmt', 'your user settings'),
    ).toBe(
      'This entry for "fmt" in your user settings is marked cloud: "device" and its script, which sits where the cloud session can write, changed since this session pinned it; it is not offered again until you relaunch claude --cloud — review the file first, since the cloud session may have written it.',
    )
    expect(cloudHookEntryShellPrefixCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings would run wrapped in your CLAUDE_CODE_SHELL_PREFIX, so this machine cannot pin what actually runs and it is not offered to the cloud session. Marking it cloud: "device" runs it for cloud sessions anyway (through the prefix when that names an absolute wrapper outside what the session can write; without it otherwise).',
    )
    expect(cloudHookEntryPrivateDotdirCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings names a script under a dot-directory this feature never reads or pins (of those, only ~/.claude and ~/.config are), so it is not offered to the cloud session. Move the script to one of those, or elsewhere outside the checkout, to have it forwarded; marking it cloud: "device" instead runs the command as written for cloud sessions, unpinned.',
    )
    expect(cloudHookEntryUnpinnedCommandCopy('fmt', 'your user settings')).toBe(
      'This entry for "fmt" in your user settings is not a single script this machine can pin, so it is not offered to the cloud session. Point it at one script outside the checkout (under ~/.claude, say) to have it forwarded; marking it cloud: "device" instead runs the command as written for cloud sessions — nothing is pinned, so whatever it names in the checkout is whatever the session last wrote there, run on this machine outside the sandbox.',
    )
    expect(cloudHookAfterEditNotForwardedCopy('fmt')).toBe(
      'fmt is an after-edit hook, so it is not forwarded either: it does not run for this cloud session, only in local ones.',
    )
    expect(cloudHookNotRunInCloudAfterEditCopy('fmt')).toBe(
      'fmt is not run in the cloud in this version, and as an after-edit hook it is not forwarded either, so it only runs in local sessions.',
    )
    expect(cloudHookNotRunInCloudCopy('fmt')).toBe(
      'fmt is not run in the cloud in this version; it runs on this machine instead.',
    )
    expect(
      cloudHookConfiguredOnEventsCopy('fmt', 'PreToolUse', 'SessionStart'),
    ).toBe(
      'fmt is configured on PreToolUse; the cloud runs it only on SessionStart, so it runs on this machine instead.',
    )
    expect(INTERPRETER_UNVOUCHED_RELATIVE_OR_ENV).toBe(
      'cannot be vouched for from here (a relative interpreter or one spelled with "..", env with options, or a #! line that hands the interpreter a file of its own)',
    )
    expect(INTERPRETER_SANDBOX_WRITE_INLET_COVERS).toBe(
      'sits where the cloud session can write on this machine (a sandbox write inlet covers it)',
    )
    expect(INTERPRETER_IT_NAMES).toBe('the interpreter it names')
    expect(INTERPRETER_HASHBANG_NAMES).toBe('the interpreter its #! line names')
    expect(INTERPRETER_CANNOT_BE_LOCATED).toBe(
      'cannot be located on this machine',
    )
    expect(CLOUD_HOOK_ENTRY_REASON.author_skip).toBe('author_skip')
    expect(CLOUD_HOOK_ENTRY_REASON.container_internal).toBe(
      'container_internal',
    )
    expect(CLOUD_HOOK_ENTRY_REASON.script_in_reach).toBe('script_in_reach')
    expect(CLOUD_HOOK_ENTRY_REASON.script_outside_reach).toBe(
      'script_outside_reach',
    )
    expect(CLOUD_HOOK_ENTRY_REASON.private_dotdir).toBe('private_dotdir')
    expect(cloudHookEntryReasonToken('author_skip')).toBe('author_skip')
    expect(cloudHookEntryReasonToken('nope')).toBeUndefined()
    expect(INTERPRETER_MAY_LOAD_FROM_CHECKOUT).toBe(
      'may load settings or code from the checkout, where the hook starts and which the cloud session can write (bun, tsx, lua and Rscript without --vanilla can; an interpreter or an option this version does not know might)',
    )
    expect(cloudHookOlderCopyNotRunCopy('fmt.sh', 'fmt')).toBe(
      'fmt.sh is an older copy of fmt; the cloud will not run it. Update it from dotfiles.',
    )
    expect(cloudHookOlderCopyCloudRunsCopy('fmt.sh', 'fmt')).toBe(
      'fmt.sh is an older copy of fmt; the cloud will run that copy. Update it from dotfiles to get fixes.',
    )
    expect(cloudHookCannotReproduceCopy('fmt.sh')).toBe(
      'fmt.sh is run in a way the cloud cannot reproduce (arguments, a condition, async or once), so it runs on this machine instead.',
    )
    expect(cloudHookMatcherRunsOnCopy('fmt.sh', 'Edit', 'Write')).toBe(
      'fmt.sh is configured with the matcher "Edit" and the cloud runs it on "Write", so it runs on this machine instead.',
    )
    expect(cloudHookMatcherCloudOnlyCopy('fmt.sh', 'Edit', 'Write')).toBe(
      'fmt.sh is configured with the matcher "Edit"; in the cloud it runs on "Write" only.',
    )
    expect(cloudHookCannotMoveCopy('fmt.sh')).toBe(
      'fmt.sh cannot move to the cloud here.',
    )
    expect(cloudHookCannotMoveAfterEditCopy('fmt.sh')).toBe(
      'fmt.sh cannot move to the cloud here, and as an after-edit hook it is not forwarded either: it runs in local sessions only.',
    )
    expect(
      cloudHookCannotMoveAfterEditCopy(
        'fmt.sh',
        'fmt.sh is not run in the cloud in this version; it runs on this machine instead.',
      ),
    ).toBe(
      'fmt.sh is not run in the cloud in this version, and as an after-edit hook it is not forwarded either: it runs in local sessions only.',
    )
    expect(cloudHookPatternMatcherLocalOnlyCopy('fmt', 'Edit|Write')).toBe(
      '"fmt" is configured with the pattern matcher "Edit|Write", which a cloud session cannot take, so it is not offered to it and runs in local sessions only. Use a plain list such as Edit|Write for it to run for cloud sessions too.',
    )
  })

  test('leftover pi/gi/ro/oo/fo scanners 1:1 wrapping copy helpers', () => {
    expect(gitArgvRefuse(tokenizeArgv(['status']), tokenizeArgv(['-i']))).toBe(
      gitHookEnvClearedRefuseCopy(),
    )
    expect(gitArgvRefuse(tokenizeArgv(['-c', 'core.hooksPath=hooks']))).toBe(
      gitHooksPathOnRefuseCopy(),
    )
    expect(
      phpArgvLoadsRelativeRefuse(tokenizeArgv(['-d', 'auto_prepend_file=./x'])),
    ).toBe(phpLoadsRelativeFileRefuseCopy())
    expect(pythonArgvRefuse(tokenizeArgv(['-i', 'app.py']))).toBe(
      pythonInteractiveStdinRefuseCopy(),
    )
    expect(envAssignArgvRefuse(tokenizeArgv(['PATH=.']))).toBe(
      envAssignWorkingDirRefuseCopy('PATH'),
    )
    expect(envAssignArgvRefuse(tokenizeArgv([`${PHP_INI_SCAN_DIR}=.`]))).toBe(
      envAssignPhpIniWorkingDirRefuseCopy(PHP_INI_SCAN_DIR),
    )
    expect(
      scriptPayloadRefuse('echo $CLAUDE_PROJECT_DIR\n', ['/launch'], '/home'),
    ).toBe(readsClaudeProjectDirRefuseCopy())
    expect(
      nestedShellUnreadRefuse('true', false, { roots: [], home: '' }, 0, {
        parseShell: () => ({
          commands: [],
          unreadable: 'unclosed quote',
        }),
      }),
    ).toBe(couldNotBeReadToEndAsShellCopy('unclosed quote'))
    expect(
      nestedShellUnreadRefuse('nested', false, { roots: [], home: '' }, 3, {
        parseShell: () => ({
          commands: [],
          unreadable: null,
        }),
      }),
    ).toBeUndefined()
    const nested: string[] = ['inner']
    expect(
      nestedShellUnreadRefuse('true', false, { roots: [], home: '' }, 3, {
        parseShell: () => ({
          commands: [
            {
              program: { text: ':' },
              args: [],
              assignments: [],
            },
          ],
          unreadable: null,
        }),
        scanCommand: (_c, v) => {
          v.push(...nested)
          return undefined
        },
      }),
    ).toBe(shellCodeNestedTooDeepRefuseCopy())
  })

  test('leftover Ei settingsFile vs extraReach/sync; ySn hold/cap/Hi', async () => {
    expect(
      await holdReasonForSettingsFileVsSyncRoot(
        { settingsFile: '/sync/hooks.json' },
        {
          opts: { launchDir: '/launch' },
          roots: { extraReach: ['/sync'] },
          deps: { realpath: async p => p },
        },
      ),
    ).toBe(CLOUD_HOOK_HOLD_REASON.source_in_sync_root)
    expect(
      await holdReasonForSettingsFileVsSyncRoot(
        { settingsFile: '/home/.claude/settings.json' },
        {
          opts: { launchDir: '/launch', configHome: '/home/.claude' },
          roots: {
            extraReach: ['/home/.claude'],
            configHomeReal: '/home/.claude',
          },
          deps: { realpath: async p => p },
        },
      ),
    ).toBe(CLOUD_HOOK_HOLD_REASON.sync_root_is_config_dir)

    const cap = await composeExtraReachForCloudHooks({
      kind: 'forward',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      realpath: async p => p,
      sources: [
        {
          settingsFile: null,
          sites: [
            {
              event: 'PreToolUse',
              source: { source: 'user' },
              offer: 'held',
              holdReason: 'after_edit',
              hook: { command: 'fmt' },
            },
            {
              event: 'Stop',
              source: { source: 'user' },
              offer: 'held',
              holdReason: 'kind_unsupported',
            },
            {
              event: 'UserPromptSubmit',
              source: { source: 'user' },
              offer: 'forward',
              hook: { command: 'ok' },
            },
          ],
        },
      ],
    })
    expect(cap.pack.heldCounts.after_edit).toBe(1)
    expect(cap.pack.heldCounts.kind_unsupported).toBe(1)
    expect(cap.pack.forwarded).toHaveLength(1)
    expect(cap.pack.notices).toContain(hooksCouldRunForCloudCopy(1))
    const pack = emptyCloudHooksPack()
    holdCloudHookSite(
      pack,
      { event: 'PreToolUse', source: { source: 'user' } },
      'after_edit',
    )
    expect(pack.heldCounts.after_edit).toBe(1)
  })

  test('leftover St scanShellCommand gold branches 1:1 wrapping copy helpers', () => {
    const cmd = (
      program: string,
      args: string[] = [],
      extra: Partial<ShellCommand> = {},
    ): ShellCommand => ({
      program: { text: program, ...extra.program },
      args: tokenizeArgv(args),
      assignments: extra.assignments ?? [],
      redirects: extra.redirects,
      heredoc: extra.heredoc,
      piped: extra.piped,
    })
    const nested: string[] = []
    const ctx = { roots: [] as string[], home: '' }

    expect(scanShellCommand(cmd('unset', ['PATH']), nested, ctx)).toBe(
      unsetsPathWorkingDirLookupRefuseCopy(),
    )
    expect(
      scanShellCommand(cmd('unset', ['GIT_CONFIG_PARAMETERS']), nested, ctx),
    ).toBe(unsetsGitHooksOffEnvRefuseCopy())
    expect(scanShellCommand(cmd('python', ['-i', 'app.py']), nested, ctx)).toBe(
      pythonInteractiveStdinRefuseCopy(),
    )
    expect(scanShellCommand(cmd('java', ['Main']), nested, ctx)).toBe(
      javaWorkingDirClassPathRefuseCopy(),
    )
    expect(
      scanShellCommand(
        cmd('java', ['-cp', '/opt/lib.jar', 'Main']),
        nested,
        ctx,
      ),
    ).toBeUndefined()
    expect(scanShellCommand(cmd('for', ['x', 'in', '*']), nested, ctx)).toBe(
      loopsOverFilesInLaunchDirRefuseCopy('*'),
    )
    expect(scanShellCommand(cmd('source', ['./hook.sh']), nested, ctx)).toBe(
      sourcesRelativeFileRefuseCopy(),
    )
    expect(scanShellCommand(cmd('.', ['rel.sh']), nested, ctx)).toBe(
      sourcesRelativeFileRefuseCopy(),
    )
    expect(scanShellCommand(cmd('node', ['-r', './x']), nested, ctx)).toBe(
      nodePreloadWorkingDirRefuseCopy(),
    )
    expect(
      scanShellCommand(cmd('perl', ['-I', './lib', 'x.pl']), nested, ctx),
    ).toBe(perlLibRelativeRefuseCopy())
  })

  test('leftover Xt cloudHookIdentityKey 1:1', () => {
    expect(
      cloudHookIdentityKey(
        { event: 'PreToolUse', matcher: 'Edit' },
        { type: 'command', command: 'fmt', args: ['--fix'] },
        'bash',
      ),
    ).toBe(
      `PreToolUse\x00Edit\x00command\x00bash\x00fmt\x00${JSON.stringify(['--fix'])}\x00`,
    )
    expect(
      cloudHookIdentityKey(
        { event: 'Stop' },
        { type: 'http', url: 'https://example.test/h', if: 'true' },
        'zsh',
      ),
    ).toBe('Stop\x00\x00http\x00https://example.test/h\x00true')
    expect(
      cloudHookIdentityKey(
        { event: 'SessionStart' },
        { type: 'command', shell: 'zsh', command: 'ok' },
        'bash',
      ),
    ).toBe(
      `SessionStart\x00\x00command\x00zsh\x00ok\x00${JSON.stringify(null)}\x00`,
    )
  })

  test('ySn compose duplicate detection via leftover Xt identity', async () => {
    const dup = await composeExtraReachForCloudHooks({
      kind: 'forward',
      launchDir: '/l',
      projectDir: '/p',
      configHome: '/c',
      realpath: async p => p,
      sources: [
        {
          settingsFile: null,
          sites: [
            {
              event: 'PreToolUse',
              matcher: 'Edit',
              source: { source: 'user' },
              offer: 'forward',
              hook: { type: 'command', command: 'fmt' },
            },
            {
              event: 'PreToolUse',
              matcher: 'Edit',
              source: { source: 'local' },
              offer: 'forward',
              hook: { type: 'command', command: 'fmt' },
            },
          ],
        },
      ],
    })
    expect(dup.pack.forwarded).toHaveLength(1)
    expect(
      dup.pack.held.some(
        h => (h as { reason?: string }).reason === 'duplicate',
      ),
    ).toBe(true)
    expect(dup.pack.notices).toContain(duplicateHookConfiguredOnceCopy('fmt'))
  })
})

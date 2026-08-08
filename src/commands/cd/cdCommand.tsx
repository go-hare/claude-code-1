/**
 * densable 2.1.218 #28 — /cd local-jsx (vCb + CdTrustPrompt + dVo/E7p/fVo/Srd)
 * + set_cwd control (fCb) headless twin.
 *
 * Move session working directory; show trust dialog when target is untrusted.
 */
import { realpath, stat } from 'fs/promises';
import { basename, dirname, parse as pathParse, resolve } from 'path';
import { randomUUID } from 'crypto';
import React from 'react';
import { getOriginalCwd, setCwdState, setOriginalCwd } from '../../bootstrap/state.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { getGlobalConfig, isPathTrusted, saveGlobalConfig } from '../../utils/config.js';
import { getCwd } from '../../utils/cwd.js';
import { logForDebugging } from '../../utils/debug.js';
import { findCanonicalGitRoot, findGitRoot, getIsGit } from '../../utils/git.js';
import { reanchorGitFileWatcher } from '../../utils/git/gitFilesystem.js';
import { expandPath, normalizePathForConfigKey } from '../../utils/path.js';
import { logEvent } from '../../services/analytics/index.js';
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js';
import { resolveTrustRootNote } from '../../components/TrustDialog/trustDialogCopy.js';
import { readBgJobState, patchBgJobState } from '../../daemon/jobState.js';
import {
  clearMemoryFileCaches,
  getClaudeMds,
  getMemoryFiles,
  getMemoryFilesForNestedDirectory,
} from '../../utils/claudemd.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { wrapInSystemReminder } from '../../utils/messages.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { escapeXmlForSystemReminder } from '../../utils/xml.js';
import { getGitStatus } from '../../context.js';
import { CdTrustPrompt } from './CdTrustPrompt.js';
import {
  cdRuleRefusalMessage,
  checkCdPermission,
  type CdPermissionCheck,
  hasUnsafePathChars,
  safeWireMessage,
} from './cdPermission.js';

function meta(s: string): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return s as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
}

/**
 * densable Frn / aq — project config key for trust latch.
 * `aMe(pu(dir) ?? resolve(dir))` where pu = findCanonicalGitRoot, aMe = path key normalize.
 * No findGitRoot fallback (densable only uses canonical git root).
 */
export function projectTrustConfigKey(directory: string): string {
  return normalizePathForConfigKey(findCanonicalGitRoot(directory) ?? resolve(directory));
}

/** densable Omt — persist hasTrustDialogAccepted under aq(directory). */
export function acceptTrustForDirectory(directory: string): void {
  const key = projectTrustConfigKey(directory);
  saveGlobalConfig(current => {
    const existing = current.projects?.[key];
    if (existing?.hasTrustDialogAccepted) return current;
    return {
      ...current,
      projects: {
        ...current.projects,
        [key]: {
          allowedTools: existing?.allowedTools ?? [],
          mcpContextUris: existing?.mcpContextUris ?? [],
          mcpServers: existing?.mcpServers ?? {},
          projectOnboardingSeenCount: existing?.projectOnboardingSeenCount ?? 0,
          ...existing,
          hasTrustDialogAccepted: true,
        },
      },
    };
  });
}

/**
 * densable EUe — trusted if aq(dir) is latched, else ancestor walk (isPathTrusted).
 * skipCanonicalKeyProbe skips the aq first probe (densable option).
 */
export function isDirectoryTrusted(directory: string, opts?: { skipCanonicalKeyProbe?: boolean }): boolean {
  if (!opts?.skipCanonicalKeyProbe) {
    const config = getGlobalConfig();
    if (config.projects?.[projectTrustConfigKey(directory)]?.hasTrustDialogAccepted) {
      return true;
    }
  }
  return isPathTrusted(directory);
}

/**
 * densable Srd — when this process is a bg job worker, rehome job state cwd.
 * Continues on failure (caller logs). No-op outside CLAUDE_JOB_DIR + SESSION_KIND=bg.
 */
export function rehomeBgJobCwd(directory: string): void {
  const jobDir = process.env.CLAUDE_JOB_DIR;
  if (!jobDir || process.env.CLAUDE_CODE_SESSION_KIND !== 'bg') {
    return;
  }
  // densable Ma/nm take full job dir; local jobState APIs take short id.
  const short = process.env.CLAUDE_BG_SHORT || basename(jobDir);
  const current = readBgJobState(short);
  if (!current) return;
  const nextOrigin = current.worktreePath ? current.originCwd : directory;
  if (current.cwd === directory && current.originCwd === nextOrigin) {
    return;
  }
  // densable re-reads before write; patchBgJobState re-reads under the hood.
  patchBgJobState(short, {
    cwd: directory,
    originCwd: current.worktreePath ? current.originCwd : directory,
  });
}

/**
 * densable pCb — load CLAUDE.md / rules along the new directory chain and
 * format via getClaudeMds (Guo). Continues empty on DISABLE / failure.
 */
export async function loadCdMemoryContext(directory: string): Promise<string> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS)) {
    return '';
  }
  // densable: seed processedPaths from already-loaded UH() memory files.
  const processedPaths = new Set<string>();
  try {
    for (const f of await getMemoryFiles()) {
      processedPaths.add(f.path);
    }
  } catch {
    // continue with empty seed
  }
  const chain: string[] = [];
  let n = directory;
  const root = pathParse(n).root;
  while (true) {
    chain.push(n);
    if (n === root) break;
    const parent = dirname(n);
    if (parent === n) break;
    n = parent;
  }
  chain.reverse();
  const files = [];
  for (const dir of chain) {
    files.push(...(await getMemoryFilesForNestedDirectory(dir, directory, processedPaths)));
  }
  return getClaudeMds(files);
}

/**
 * densable fVo core:
 * chdir + session cwd state + tNt + Srd + g_e reanchor +
 * $v isGit cache clear + Fo sandbox refreshConfig + pCb memory + model notice.
 *
 * densable tNt (`relocateSessionTranscript`): rehomes the session jsonl under
 * the project dir for the new originalCwd; on failure densable rolls back
 * chdir/cwd when possible and rethrows (or completes with transcript left
 * behind if rollback chdir fails).
 *
 * densable NC()?.refreshGitBranch?.() is a host/UI status-line callback —
 * no local hang point; omitted intentionally.
 */
export async function relocateSessionCwd(
  directory: string,
  source: 'cd_command' | 'set_cwd' = 'cd_command',
): Promise<{ modelMessage: string; transcriptRelocated: boolean }> {
  const previous = getCwd();
  const previousOriginal = getOriginalCwd();
  process.chdir(directory);
  setCwdState(directory);
  setOriginalCwd(directory);

  // densable tNt — transcript rehome; rollback cwd on throw when chdir back works
  let transcriptRelocated = true;
  try {
    const { relocateSessionTranscript } = await import('../../utils/sessionStorage.js');
    await relocateSessionTranscript();
  } catch (e) {
    transcriptRelocated = false;
    let rolledBack = false;
    try {
      process.chdir(previous);
      rolledBack = true;
    } catch {
      logForDebugging(
        `directory move: transcript move failed and rollback chdir failed; completing the move with the transcript left in its previous home: ${e}`,
        { level: 'error' },
      );
    }
    if (rolledBack) {
      setCwdState(previous);
      setOriginalCwd(previousOriginal);
      throw e;
    }
  }

  try {
    rehomeBgJobCwd(getCwd());
  } catch (e) {
    logForDebugging(`directory move: bg session state rehome failed (continuing): ${e}`, { level: 'error' });
  }

  // densable g_e() — reanchor git file watcher to new cwd
  reanchorGitFileWatcher();
  // densable $v.cache.clear — getIsGit is memoized on session id / cwd
  getIsGit.cache?.clear?.();
  // densable also clears git status context cache in sibling clear paths
  getGitStatus.cache?.clear?.();
  // Memory files are cwd-rooted; clear so next turn reloads for new root.
  clearMemoryFileCaches();
  // densable Fo.refreshConfig()
  try {
    SandboxManager.refreshConfig();
  } catch (e) {
    logForDebugging(`directory move: sandbox refreshConfig failed (continuing): ${e}`, { level: 'error' });
  }

  logEvent('tengu_cd_command', { source: meta(source) });

  let memory = '';
  try {
    memory = await loadCdMemoryContext(directory);
  } catch (e) {
    logForDebugging(`directory move: loading the new directory's memory context failed (continuing without it): ${e}`, {
      level: 'error',
    });
  }

  // densable O8e + BC system-reminder wrap for model-visible notice
  const escaped = escapeXmlForSystemReminder(directory);
  const via = source === 'cd_command' ? 'via /cd' : 'by the user';
  const body =
    `The session's working directory has changed to ${escaped} (${via}). ` +
    'The environment block at the start of this conversation still names the previous directory — that information is stale. ' +
    `All tool calls and relative paths now resolve from ${escaped}.`;
  const notice = wrapInSystemReminder(body);
  const modelMessage = memory ? `${notice}\n\n${memory}` : notice;

  if (previous !== directory) {
    logForDebugging(`/cd relocated ${previous} → ${directory}`);
  }
  return { modelMessage, transcriptRelocated };
}

export type ResolveCdResult =
  | { result: 'not_found'; path: string }
  | { result: 'not_a_directory'; path: string; parent: string }
  | { result: 'same'; directory: string }
  | { result: 'ok'; directory: string }
  | {
      result: 'blocked_by_rule';
      directory: string;
      check: Extract<CdPermissionCheck, { result: 'blockedByRule' } | { result: 'outsideAllowedPatterns' }>;
    }
  | { result: 'unsafe_path'; path: string };

/**
 * densable dVo — validate target path + E7p Cd permission rules.
 * unsafe_path (cVo) is checked on the canonical directory for defense-in-depth
 * (densable set_cwd fCb also gates on cVo after dVo).
 */
export async function resolveCdTarget(
  raw: string,
  toolPermissionContext?: ToolPermissionContext,
): Promise<ResolveCdResult> {
  const expanded = expandPath(raw.trim());
  let path = expanded;
  try {
    const st = await stat(path);
    if (!st.isDirectory()) {
      return { result: 'not_a_directory', path, parent: dirname(path) };
    }
  } catch {
    return { result: 'not_found', path };
  }
  let canonical = path;
  try {
    canonical = await realpath(path);
  } catch {
    // keep expanded
  }
  if (hasUnsafePathChars(canonical) || hasUnsafePathChars(path)) {
    return { result: 'unsafe_path', path: canonical };
  }
  if (canonical === getCwd()) {
    return { result: 'same', directory: canonical };
  }
  if (toolPermissionContext) {
    const check = checkCdPermission({ requestedPath: path, canonicalPath: canonical }, toolPermissionContext);
    if (check.result !== 'allowed') {
      return {
        result: 'blocked_by_rule',
        directory: canonical,
        check,
      };
    }
  }
  return { result: 'ok', directory: canonical };
}

// ---------------------------------------------------------------------------
// densable fCb — set_cwd control request (headless / SDK twin of /cd)
// ---------------------------------------------------------------------------

export type SetCwdControlRequest = {
  subtype: 'set_cwd';
  path: string;
  trust_accepted?: boolean;
  trusted_directory?: string;
};

export type SetCwdControlResponse =
  | {
      status: 'ok';
      cwd: string;
      changed: boolean;
      transcript_relocated: boolean;
    }
  | {
      status: 'needs_trust';
      directory: string;
      trust_root?: string;
    }
  | {
      status: 'rejected';
      reason: 'not_found' | 'not_a_directory' | 'blocked_by_rule' | 'busy' | 'unsafe_path';
      message: string;
    };

export type SetCwdControlResult =
  | { kind: 'response'; response: SetCwdControlResponse }
  | { kind: 'invalid'; message: string };

export type SetCwdControlHost = {
  isBusy: () => boolean;
  toolPermissionContext: ToolPermissionContext;
  enqueueMoveNotice: (modelMessage: string) => void;
};

const UNSAFE_PATH_REJECT_MESSAGE =
  'The target path contains invisible or non-printing characters (control, formatting, zero-width, or non-standard space characters such as the narrow no-break space macOS puts in screenshot folder names), so it cannot safely cross the trust boundary. The path is deliberately not echoed back.';

/**
 * densable fCb — handle set_cwd control request.
 * Trust prompt is delegated to the host via needs_trust; attestation echo pins
 * trusted_directory to the needs_trust directory string.
 */
export async function handleSetCwdControlRequest(
  request: SetCwdControlRequest,
  host: SetCwdControlHost,
): Promise<SetCwdControlResult> {
  if (host.isBusy()) {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'busy',
        message:
          'A turn is in progress — the working directory can only change while the session is idle. Wait for the turn to finish (or interrupt it), then retry.',
      },
    };
  }
  if (typeof request.path !== 'string' || request.path.trim() === '') {
    return {
      kind: 'invalid',
      message: 'set_cwd: invalid request — path must be a non-empty string',
    };
  }
  const trustAccepted = request.trust_accepted === true;
  if (trustAccepted && typeof request.trusted_directory !== 'string') {
    return {
      kind: 'invalid',
      message:
        'set_cwd: invalid request — trust_accepted requires trusted_directory (echo the directory from the needs_trust response)',
    };
  }

  const n = await resolveCdTarget(request.path.trim(), host.toolPermissionContext);
  const o = 'directory' in n ? n.directory : n.path;

  // densable: cVo after dVo for wire path (defense-in-depth; dVo already gates)
  if (hasUnsafePathChars(o)) {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'unsafe_path',
        message: UNSAFE_PATH_REJECT_MESSAGE,
      },
    };
  }
  if (n.result === 'not_found') {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'not_found',
        message: `Couldn't find a directory at ${n.path}.`,
      },
    };
  }
  if (n.result === 'not_a_directory') {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'not_a_directory',
        message: `${n.path} is not a directory.`,
      },
    };
  }
  if (n.result === 'blocked_by_rule') {
    // densable pVo(..., {terminalAffordances:!1}) + C7p wire-safe substitute
    const ruleMsg = cdRuleRefusalMessage(n.directory, n.check, s => s, { terminalAffordances: false });
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'blocked_by_rule',
        message: safeWireMessage(
          ruleMsg,
          'A Cd permission rule blocks this directory. The rule text contains control or invisible characters, so it is not echoed here — check the Cd(...) entries in your settings.',
        ),
      },
    };
  }
  if (n.result === 'unsafe_path') {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'unsafe_path',
        message: UNSAFE_PATH_REJECT_MESSAGE,
      },
    };
  }
  if (n.result === 'same') {
    // densable: same → ok with transcript_relocated:true, changed:false
    return {
      kind: 'response',
      response: {
        status: 'ok',
        cwd: n.directory,
        changed: false,
        transcript_relocated: true,
      },
    };
  }

  const directory = n.directory;
  if (!isDirectoryTrusted(directory)) {
    const { trustRoot, showRepoRootNote } = resolveTrustRootNote(directory, findCanonicalGitRoot, findGitRoot);
    const rootForWire = showRepoRootNote && !hasUnsafePathChars(trustRoot) ? trustRoot : undefined;
    if (!trustAccepted) {
      return {
        kind: 'response',
        response:
          rootForWire != null
            ? {
                status: 'needs_trust',
                directory,
                trust_root: rootForWire,
              }
            : { status: 'needs_trust', directory },
      };
    }
    if (request.trusted_directory !== directory) {
      return {
        kind: 'response',
        response:
          rootForWire != null
            ? {
                status: 'needs_trust',
                directory,
                trust_root: rootForWire,
              }
            : { status: 'needs_trust', directory },
      };
    }
    // densable Omt — latch trust before relocate
    acceptTrustForDirectory(directory);
  }

  // Re-check busy after async validation (densable second gate)
  if (host.isBusy()) {
    return {
      kind: 'response',
      response: {
        status: 'rejected',
        reason: 'busy',
        message: 'A turn started while the request was being validated. Retry when the session is idle.',
      },
    };
  }

  const { modelMessage, transcriptRelocated } = await relocateSessionCwd(directory, 'set_cwd');
  try {
    host.enqueueMoveNotice(modelMessage);
  } catch (e) {
    logForDebugging(`set_cwd: enqueueing the move notice failed (continuing): ${e}`, { level: 'error' });
  }
  const now = getCwd();
  return {
    kind: 'response',
    response: {
      status: 'ok',
      cwd: hasUnsafePathChars(now) ? directory : now,
      changed: true,
      transcript_relocated: transcriptRelocated,
    },
  };
}

/** Build a densable-style queue entry for set_cwd move notice. */
export function buildSetCwdMoveNoticeCommand(modelMessage: string): {
  value: string;
  mode: 'prompt';
  uuid: ReturnType<typeof randomUUID>;
  isMeta: true;
  skipSlashCommands: true;
} {
  return {
    value: modelMessage,
    mode: 'prompt',
    uuid: randomUUID(),
    isMeta: true,
    skipSlashCommands: true,
  };
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const n = (args ?? '').trim();
  if (!n) {
    onDone('Usage: /cd <path>', { display: 'system' });
    return null;
  }

  const appState = context.getAppState();
  const resolved = await resolveCdTarget(n, appState.toolPermissionContext);
  switch (resolved.result) {
    case 'not_found':
      onDone(`Couldn't find a directory at ${resolved.path}.`, {
        display: 'system',
      });
      return null;
    case 'not_a_directory':
      onDone(`${resolved.path} is not a directory. Did you mean ${resolved.parent}?`, {
        display: 'system',
      });
      return null;
    case 'same':
      onDone(`Already in ${resolved.directory}.`, { display: 'system' });
      return null;
    case 'unsafe_path':
      onDone(UNSAFE_PATH_REJECT_MESSAGE, { display: 'system' });
      return null;
    case 'blocked_by_rule':
      onDone(cdRuleRefusalMessage(resolved.directory, resolved.check), {
        display: 'system',
      });
      return null;
    case 'ok':
      break;
  }

  const directory = resolved.directory;
  const doMove = async () => {
    try {
      const { modelMessage } = await relocateSessionCwd(directory, 'cd_command');
      onDone(`Moved to ${directory}`, {
        display: 'system',
        metaMessages: [modelMessage],
      });
    } catch (e) {
      logForDebugging(`/cd relocate failed: ${e}`, { level: 'error' });
      onDone(
        `Couldn't move to ${directory} — the directory may no longer exist, or the session couldn't be moved. Staying in ${getCwd()}.`,
        { display: 'system' },
      );
    }
  };

  if (isDirectoryTrusted(directory)) {
    await doMove();
    return null;
  }

  const { trustRoot, showRepoRootNote } = resolveTrustRootNote(directory, findCanonicalGitRoot, findGitRoot);

  return (
    <CdTrustPrompt
      directory={directory}
      trustRoot={showRepoRootNote ? trustRoot : undefined}
      onConfirm={() => {
        acceptTrustForDirectory(directory);
        void doMove();
      }}
      onCancel={() => {
        onDone(`Staying in ${getCwd()}`, { display: 'system' });
      }}
    />
  );
};

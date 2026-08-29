/**
 * densable mGw / fGw / v$m — non-interactive /auto-mode-setup runner.
 * Gold: gold-wide-Grn.txt (mGw / E$m)
 */
import { createHash } from 'crypto'
import { constants as fsConstants } from 'fs'
import { open, realpath } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { tmpdir } from 'os'
import type { LocalCommandCall } from '../../types/command.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  AUTO_MODE_SETUP_USAGE,
  expectedScopeForApplyTarget,
  isSha256Hex,
  parseAutoModeSetupHeadlessArgs,
  type ParsedAutoModeSetupArgs,
} from '../../services/autoModeSetup/headlessArgs.js'
import {
  parseAutoModeSetupProposal,
  proposeAutoModeSetup,
} from '../../services/autoModeSetup/propose.js'
import {
  AutoModeSetupWriteError,
  proposalToAutoModeWrite,
  saveAutoModeSetup,
} from '../../services/autoModeSetup/write.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { isNetworkUncPath } from '../../utils/path.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const MAX_APPLY_BYTES = 1_000_000

type HeadlessResult = Record<string, unknown>

function wrapResult(
  result: HeadlessResult,
  requestId: string | undefined,
): { type: 'text'; value: string } {
  const body = requestId === undefined ? result : { ...result, requestId }
  return { type: 'text', value: jsonStringify(body, null, 2) }
}

function logWriteFail(code: string): void {
  logEvent('tengu_auto_mode_setup_write_failed', {
    code: code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** densable v$m — path under tmpdir or Claude config dir */
async function isAllowedProposalPath(filePath: string): Promise<boolean> {
  const resolved = resolve(filePath)
  const roots = new Set<string>()
  for (const root of [tmpdir(), getClaudeConfigHomeDir()]) {
    roots.add(resolve(root))
    try {
      roots.add(await realpath(root))
    } catch {
      // ignore
    }
  }
  for (const root of roots) {
    const rel = relative(root, resolved)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      return true
    }
  }
  return false
}

/**
 * densable wHe call-site contract (body not dumped): O_NOFOLLOW + nlink===1
 * + size cap + BOM sniff. Helper stays in this file — do not export a global wHe.
 */
async function readApplyProposalFile(filePath: string): Promise<{
  content: string
  bytes: Buffer
  truncated: boolean
} | null> {
  const O_NONBLOCK = fsConstants.O_NONBLOCK ?? 0
  const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
  let fd: Awaited<ReturnType<typeof open>>
  try {
    fd = await open(filePath, fsConstants.O_RDONLY | O_NONBLOCK | O_NOFOLLOW)
  } catch {
    return null
  }
  try {
    const st = await fd.stat()
    if (!st.isFile() || st.nlink !== 1) {
      return null
    }
    if (st.size > MAX_APPLY_BYTES) {
      return { content: '', bytes: Buffer.alloc(0), truncated: true }
    }
    const bytes = Buffer.alloc(st.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await fd.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      )
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const contentBytes =
      offset === bytes.length ? bytes : bytes.subarray(0, offset)
    let encoding: BufferEncoding = 'utf8'
    if (
      contentBytes.length >= 2 &&
      contentBytes[0] === 0xff &&
      contentBytes[1] === 0xfe
    ) {
      encoding = 'utf16le'
    }
    return {
      content: contentBytes.toString(encoding),
      bytes: contentBytes,
      truncated: false,
    }
  } catch {
    return null
  } finally {
    await fd.close().catch(() => {})
  }
}

async function runParsed(
  parsed: ParsedAutoModeSetupArgs,
  context: Parameters<LocalCommandCall>[1],
): Promise<HeadlessResult> {
  if (parsed.mode === 'usage') {
    if (parsed.logCode !== undefined) {
      logWriteFail(parsed.logCode)
    }
    return {
      ok: false,
      code: 'usage',
      reason: parsed.message,
      usage: AUTO_MODE_SETUP_USAGE,
    }
  }

  // densable mGw: hash-arg checks only on apply-file, then gn(t), then propose.
  if (parsed.mode === 'apply-file') {
    if (parsed.expectedSha256 === undefined) {
      logWriteFail('missing_hash_arg')
      return {
        ok: false,
        code: 'missing_hash_arg',
        reason:
          '--expect-sha256 is required: pass the 64-character hex sha256 of the proposal file’s exact bytes, before --apply-file. Every non-interactive apply is hash-bound.',
      }
    }
    if (!isSha256Hex(parsed.expectedSha256)) {
      logWriteFail('bad_hash_arg')
      return {
        ok: false,
        code: 'bad_hash_arg',
        reason:
          '--expect-sha256 must be the 64-character hex sha256 digest of the proposal file’s exact bytes.',
      }
    }
  }

  const permissionContext = context.getAppState().toolPermissionContext

  if (parsed.mode === 'propose') {
    const result = await proposeAutoModeSetup(
      parsed.answers,
      permissionContext,
      context.abortController.signal,
    )
    if (!result.ok) {
      return { ok: false, code: result.code, reason: result.reason }
    }
    return { ok: true, proposal: result.proposal }
  }

  // Gold mGw uses e.expectedSha256.toLowerCase() here — already required above.
  const expectedSha256 = parsed.expectedSha256!

  if (
    !isAbsolute(parsed.path) ||
    isNetworkUncPath(parsed.path) ||
    !(await isAllowedProposalPath(parsed.path))
  ) {
    logWriteFail('bad_path')
    return {
      ok: false,
      code: 'bad_path',
      reason:
        'Pass an absolute path under the system temp directory or the Claude config directory — --apply-file only reads proposal files the reviewing host wrote there.',
    }
  }

  if (matchingRuleForInput(parsed.path, permissionContext, 'read', 'deny')) {
    logWriteFail('read_denied')
    return {
      ok: false,
      code: 'read_denied',
      reason:
        'That path is covered by a permissions.deny read rule. Write the proposal somewhere the session can read.',
    }
  }

  const read = await readApplyProposalFile(parsed.path)
  if (read === null) {
    logWriteFail('read_failed')
    return {
      ok: false,
      code: 'read_failed',
      reason:
        'Couldn’t read the proposal file. Check the path and that it is a regular file.',
    }
  }
  if (read.truncated) {
    logWriteFail('too_large')
    return {
      ok: false,
      code: 'too_large',
      reason:
        'The proposal file is over the 1 MB cap — a real proposal is a few KB. Regenerate it with --propose.',
    }
  }

  const expected = expectedSha256.toLowerCase()
  const actual = createHash('sha256').update(read.bytes).digest('hex')
  if (actual !== expected) {
    logWriteFail('hash_mismatch')
    return {
      ok: false,
      code: 'hash_mismatch',
      expectedSha256: expected,
      reason:
        'The proposal file’s bytes do not match the reviewed digest — the file changed after it was approved. Nothing was written; regenerate the proposal, re-review, and retry.',
    }
  }

  const parsedProposal = parseAutoModeSetupProposal(read.content)
  if (!parsedProposal.ok) {
    logWriteFail(parsedProposal.code)
    return {
      ok: false,
      code: parsedProposal.code,
      reason:
        parsedProposal.code === 'parse_failed'
          ? 'That file doesn’t contain a proposal this command can read. Regenerate it with --propose and pass that output.'
          : parsedProposal.reason.replace(
              /Re-run to try again\.?$/,
              'Regenerate the proposal with --propose.',
            ),
    }
  }

  if (parsed.target !== undefined) {
    const expectedScope = expectedScopeForApplyTarget(parsed.target)
    if (parsedProposal.proposal.scope !== expectedScope) {
      logWriteFail('scope_mismatch')
      return {
        ok: false,
        code: 'scope_mismatch',
        reason:
          parsedProposal.proposal.scope === undefined
            ? `This proposal was generated before save scope was recorded, so --apply-target ${parsed.target} can’t confirm it matches. Regenerate the proposal with --propose, answering scope=${expectedScope}.`
            : `This proposal was generated for a different save scope (${parsedProposal.proposal.scope}) than --apply-target ${parsed.target} expects (${expectedScope}). Regenerate the proposal with --propose, answering scope=${expectedScope}.`,
      }
    }
  }

  try {
    const saved = await saveAutoModeSetup({
      mode: parsedProposal.proposal.mode,
      autoMode: proposalToAutoModeWrite(parsedProposal.proposal),
      removeFromPermissionsAllow:
        parsedProposal.proposal.remove_from_permissions_allow,
    })
    return {
      ok: true,
      ...saved,
      ...(parsed.target !== undefined && { target: parsed.target }),
      ...(parsedProposal.droppedUnsafeAllowCount > 0 && {
        droppedUnsafeAllowCount: parsedProposal.droppedUnsafeAllowCount,
      }),
    }
  } catch (err) {
    return {
      ok: false,
      code: err instanceof AutoModeSetupWriteError ? err.code : 'write_failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

/** densable fGw / E$m */
export const call: LocalCommandCall = async (args, context) => {
  const parsed = parseAutoModeSetupHeadlessArgs(args)
  const result = await runParsed(parsed, context)
  return wrapResult(result, parsed.requestId)
}

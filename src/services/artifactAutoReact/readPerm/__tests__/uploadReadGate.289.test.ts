/**
 * densable 2.1.289 Gqe / hn / xKe — upload Read trial + attachment carve-out.
 */
import { createHash } from 'crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  linkSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileReadTool } from '../../../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.js'
import { getEmptyToolPermissionContext } from '../../../../Tool.js'
import { resetArtifactAutoReactStoreForTests } from '../../store.js'
import {
  Gqe,
  hn,
  readAdmittedUploadBytes,
  readPinnedUploadBytes,
  resolveUploadSource,
  xKe,
} from '../uploadReadGate.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  delete process.env.CLAUDE_STAGE_FILE_ROOT
  delete process.env.CLAUDE_CODE_EVAL_CONFINED
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  delete process.env.CLAUDE_CODE_REMOTE
})

describe('Gqe / hn (densable 2.1.289)', () => {
  test('Read deny is the refused result', () => {
    const file = join(process.cwd(), 'package.json')
    const perms = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { session: ['Read(package.json)'] },
    }
    const source = resolveUploadSource(file)
    const gate = Gqe(
      FileReadTool,
      { file_path: file },
      file,
      source,
      perms,
      undefined,
    )
    expect(gate.refused?.behavior).toBe('deny')
    expect(gate.refused?.message).toContain('Permission to read')
  })

  test('hn upgrades a workingDir ask when the file is a stage attachment', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-stage-'))
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    const file = join(root, 'shot.png')
    writeFileSync(file, 'x')
    const out = hn(
      {
        behavior: 'ask',
        message: 'outside',
        decisionReason: {
          type: 'workingDir',
          reason: 'Path is outside allowed working directories',
        },
      },
      file,
      { kind: 'resolved', real: file },
      getEmptyToolPermissionContext(),
      undefined,
    )
    expect(out.read.behavior).toBe('allow')
    expect(out.read.decisionReason).toMatchObject({
      type: 'other',
      reason: expect.stringContaining('chat attachments'),
    })
    expect(out.pin?.real).toBeDefined()
  })

  test('hn does not treat a stage symlink to an outside file as an attachment', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-stage-'))
    const outside = join(tmpdir(), `artifact-out-${Date.now()}.bin`)
    writeFileSync(outside, 'secret')
    const link = join(root, 'shot.png')
    symlinkSync(outside, link)
    process.env.CLAUDE_STAGE_FILE_ROOT = root
    const out = hn(
      {
        behavior: 'ask',
        message: 'outside',
        decisionReason: {
          type: 'workingDir',
          reason: 'Path is outside allowed working directories',
        },
      },
      link,
      { kind: 'resolved', real: outside },
      getEmptyToolPermissionContext(),
      undefined,
    )
    expect(out.read.behavior).toBe('ask')
    expect(out.read.decisionReason?.type).toBe('workingDir')
  })

  test('xKe marks a hard link, not a symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-link-'))
    const target = join(root, 'real.bin')
    const link = join(root, 'alias.bin')
    const sym = join(root, 'sym.bin')
    writeFileSync(target, 'x')
    linkSync(target, link)
    symlinkSync(target, sym)
    expect(xKe(link).linked).toBe(true)
    expect(xKe(sym).linked).toBeUndefined()
    expect(xKe(target).identity).toMatch(/^\d+:\d+:\d+:\d+$/)
  })

  test('mlt refuses a symlink swapped onto the approved path', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-pin-'))
    const approved = join(root, 'approved.png')
    const other = join(root, 'other.png')
    const link = join(root, 'slot.png')
    writeFileSync(approved, 'approved-bytes')
    writeFileSync(other, 'other-bytes')
    symlinkSync(approved, link)
    const source = resolveUploadSource(link)
    if (source.kind !== 'resolved') throw new Error('expected a resolved pin')
    const pin = xKe(source.real)
    unlinkSync(link)
    symlinkSync(other, link)
    const read = readPinnedUploadBytes({
      spelled: link,
      pin,
      byteLimit: 1024 * 1024,
      readVerdict: () => 'allow',
    })
    expect(read.kind).toBe('error')
    if (read.kind === 'error') {
      expect(read.reason).toBe('changed')
      expect(read.message).toContain('no longer names the file')
    }
  })

  test('mlt returns the approved bytes while the pin still matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-pin-ok-'))
    const approved = join(root, 'approved.png')
    const link = join(root, 'slot.png')
    writeFileSync(approved, 'approved-bytes')
    symlinkSync(approved, link)
    const source = resolveUploadSource(link)
    if (source.kind !== 'resolved') throw new Error('expected a resolved pin')
    const read = readPinnedUploadBytes({
      spelled: link,
      pin: xKe(source.real),
      byteLimit: 1024 * 1024,
      readVerdict: () => 'allow',
    })
    expect(read).toMatchObject({ kind: 'ok', real: source.real })
    if (read.kind === 'ok') {
      expect(read.bytes.toString()).toBe('approved-bytes')
    }
  })

  test('xTr rejects bytes whose sha256 is not the approved digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-digest-'))
    const file = join(root, 'approved.png')
    writeFileSync(file, 'approved-bytes')
    const read = readPinnedUploadBytes({
      spelled: file,
      pin: { ...xKe(file), digest: '0'.repeat(64) },
      byteLimit: 1024 * 1024,
      readVerdict: () => 'allow',
    })
    expect(read.kind).toBe('error')
    if (read.kind === 'error') expect(read.reason).toBe('changed')
  })

  test('a missing path is read_denied when an ancestor spelling is denied', () => {
    const spelled = join(tmpdir(), 'no-such-upload-289.png')
    const read = readPinnedUploadBytes({
      spelled,
      byteLimit: 1024,
      readVerdict: () => 'deny',
    })
    expect(read.kind).toBe('error')
    if (read.kind === 'error') expect(read.reason).toBe('read_denied')
  })

  test('iQt accepts only the admitted sha256 of a regular file', () => {
    const root = mkdtempSync(join(tmpdir(), 'artifact-admit-'))
    const file = join(root, 'approved.png')
    writeFileSync(file, 'approved-bytes')
    const sha = createHash('sha256').update('approved-bytes').digest('hex')
    const ok = readAdmittedUploadBytes(file, sha)
    expect(ok.kind).toBe('ok')
    if (ok.kind === 'ok') expect(ok.bytes.toString()).toBe('approved-bytes')
    expect(readAdmittedUploadBytes(file, 'ab'.repeat(32)).kind).toBe(
      'unverified',
    )
  })
})

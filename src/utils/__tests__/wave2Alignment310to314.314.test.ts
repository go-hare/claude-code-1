import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  fetchPublishedCatalog,
  isPublishedCatalogEnvOff,
  MODEL_CATALOG_DEFAULT_URL,
  MODEL_CATALOG_SIGNING_CONTEXT,
  resolvePublishedCatalogSource,
  verifyPublishedCatalogSignature,
} from '../../cli/clientDataUrl.js'
import { resolveAttacherHyperlinks } from '../../daemon/bgWorker.js'
import {
  canPromptForRemoteControlTrust,
  rootOptionsRefusedMessage,
} from '../../entrypoints/remoteControlFlags.js'
import {
  filterUnseenSecurityWarnings,
  getGlobalConfig,
  markSecurityWarningsSeen,
  saveGlobalConfig,
} from '../config.js'
import {
  getDroppedCrossCertificatesCount,
  getLastSyncedDefaultCACertListForTesting,
  hasUnmatchedDroppedCrossCertificate,
  noteServerServedCertificates,
  setDroppedCrossCertificatesStateForTesting,
  syncDefaultCACertificates,
} from '../mtls.js'
import {
  neutralizeRefusalFallbackForFork,
  pickResumeRestoreModel,
  type ResumeTranscriptEntry,
} from '../refusalFallback.js'
import {
  getResumeHeadPath,
  getSessionMessagesCache,
  NeedsWholeTranscript,
  parseResumeHead,
  PreservedResumeRows,
  removeTranscriptMessageIfPersisted,
  RESUME_HEAD_WINDOW_BYTES,
  resumeHeadSha256,
  serializeResumeHead,
  vouchResumeHeadProbe,
} from '../sessionStorage.js'
import { SettingsSchema } from '../settings/types.js'
import { getSessionId } from '../../bootstrap/state.js'
import { validateUuid } from '../uuid.js'

const VALID_CERT_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy',
  '-----END CERTIFICATE-----',
].join('\n')

describe('Wave 2 2.1.325 alignment (#1205, #1231, #1251, #1252, #1267, #1292, #1295, #1354, #1363, #1367, #1368, #1392, #1432)', () => {
  let tempDir: string | undefined

  afterEach(() => {
    setDroppedCrossCertificatesStateForTesting({})
    getSessionMessagesCache().clear()
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('#1205 & #1231: removeTranscriptMessageIfPersisted skips unpersisted UUIDs without touching disk', async () => {
    const sid = validateUuid(getSessionId())!
    const missingUuid =
      '00000000-0000-4000-8000-000000000099' as `${string}-${string}-${string}-${string}-${string}`
    getSessionMessagesCache().set(sid, Promise.resolve(new Set()))
    await expect(
      removeTranscriptMessageIfPersisted(missingUuid),
    ).resolves.toBeUndefined()
  })

  test('#1251 & #1252: Cowork cloud ignores agent setting & branch resets task list state', () => {
    const mainSrc = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')
    expect(mainSrc).toContain(
      "process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork'",
    )
    expect(mainSrc).toContain(
      "process.env.CLAUDE_CODE_ENTRYPOINT === 'remote_cowork_trigger'",
    )

    const branchSrc = readFileSync(
      join(process.cwd(), 'src/commands/branch/branch.ts'),
      'utf8',
    )
    expect(branchSrc).toContain('resetTaskListState()')
  })

  test('#1267: resolveAttacherHyperlinks prefers attacherCaps().hyperlinks over FORCE_HYPERLINK', () => {
    expect(
      resolveAttacherHyperlinks(
        { hyperlinks: false },
        { FORCE_HYPERLINK: '1' },
      ),
    ).toBe(false)
    expect(
      resolveAttacherHyperlinks({ hyperlinks: true }, { FORCE_HYPERLINK: '0' }),
    ).toBe(true)
    expect(resolveAttacherHyperlinks(null, { FORCE_HYPERLINK: '1' })).toBe(true)
    expect(resolveAttacherHyperlinks(null, { FORCE_HYPERLINK: '0' })).toBe(
      false,
    )
    expect(resolveAttacherHyperlinks(undefined, {})).toBeUndefined()
  })

  test('#1292: filterUnseenSecurityWarnings & markSecurityWarningsSeen dedupe and cap at 256', () => {
    const orig = getGlobalConfig().seenSecurityWarnings
    try {
      saveGlobalConfig(prev => ({ ...prev, seenSecurityWarnings: undefined }))
      const warnings = [
        { seenKey: 'warn-a', text: 'A' },
        { seenKey: 'warn-b', text: 'B' },
        { text: 'always' },
      ]
      expect(filterUnseenSecurityWarnings(warnings).map(w => w.text)).toEqual([
        'A',
        'B',
        'always',
      ])
      markSecurityWarningsSeen(['warn-a', 'warn-a'])
      expect(filterUnseenSecurityWarnings(warnings).map(w => w.text)).toEqual([
        'B',
        'always',
      ])
      const many = Array.from({ length: 270 }, (_, i) => `bulk-${i}`)
      markSecurityWarningsSeen(many)
      const stored = getGlobalConfig().seenSecurityWarnings ?? []
      expect(stored.length).toBe(256)
      expect(stored.at(-1)).toBe('bulk-269')
    } finally {
      saveGlobalConfig(prev => ({ ...prev, seenSecurityWarnings: orig }))
    }
  })

  test('#1295: CLAUDE_CODE_MODEL_CATALOG source resolution, file fetch, and signature verification', async () => {
    expect(isPublishedCatalogEnvOff({ CLAUDE_CODE_MODEL_CATALOG: 'off' })).toBe(
      true,
    )
    expect(isPublishedCatalogEnvOff({ CLAUDE_CODE_MODEL_CATALOG: '1' })).toBe(
      false,
    )

    const defaultRes = resolvePublishedCatalogSource({ env: {} })
    expect(defaultRes.ok).toBe(true)
    if (defaultRes.ok) {
      expect(defaultRes.source.kind).toBe('hosted')
      expect(defaultRes.source.url).toBe(MODEL_CATALOG_DEFAULT_URL)
      expect(defaultRes.source.trust.kind).toBe('compiled_roots')
    }

    const loopbackRes = resolvePublishedCatalogSource({
      env: { CLAUDE_CODE_MODEL_CATALOG_URL: 'https://127.0.0.1/catalog.json' },
    })
    expect(loopbackRes).toEqual({ ok: false, reason: 'invalid_url' })

    tempDir = mkdtempSync(join(tmpdir(), 'model-cat-'))
    const docPath = join(tempDir, 'catalog.json')
    const docBytes = Buffer.from('{"version":1,"entries":[]}', 'utf8')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    })
    const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
    const spkiB64 = Buffer.from(spkiDer).toString('base64')
    const publicKeySha256 = createHash('sha256').update(spkiDer).digest('hex')
    const sigPayload = Buffer.concat([
      Buffer.from(MODEL_CATALOG_SIGNING_CONTEXT, 'utf8'),
      docBytes,
    ])
    const signature = sign('sha512', sigPayload, privateKey).toString('base64')
    writeFileSync(docPath, docBytes)
    writeFileSync(
      `${docPath}.raw-sig.json`,
      JSON.stringify({
        schema: 1,
        algorithm: 'RSASSA-PKCS1-v1_5-SHA512',
        publicKeySha256,
        signature,
      }),
    )

    const fileUrl = pathToFileURL(docPath).toString()
    const fileRes = resolvePublishedCatalogSource({
      env: { CLAUDE_CODE_MODEL_CATALOG_URL: fileUrl },
    })
    expect(fileRes.ok).toBe(true)
    if (fileRes.ok) {
      expect(fileRes.source.kind).toBe('file')
      const fetched = await fetchPublishedCatalog(fileRes.source)
      expect(fetched.status).toBe('ok')
      if (fetched.status === 'ok') {
        expect(fetched.hasSidecar).toBe(true)
        const verified = await verifyPublishedCatalogSignature({
          documentBytes: fetched.documentBytes,
          sidecar: fetched.sidecar,
          roots: [{ id: 'test-root', spkiBase64: spkiB64 }],
        })
        expect(verified).toEqual({ ok: true, rootId: 'test-root' })
      }
    }
  })

  test('#1354: SettingsSchema accepts permissions.blockWritesOutsideWorkingDirectories', () => {
    const parsed = SettingsSchema().safeParse({
      permissions: {
        blockWritesOutsideWorkingDirectories: true,
      },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(
        parsed.data.permissions?.blockWritesOutsideWorkingDirectories,
      ).toBe(true)
    }
  })

  test('#1363 & #1368: syncDefaultCACertificates filters bad certs & droppedCrossCertificates state', () => {
    const badCert =
      '-----BEGIN CERTIFICATE-----\nBAD\n-----END CERTIFICATE-----'
    const calls: string[][] = []
    const ok = syncDefaultCACertificates({
      caCerts: [VALID_CERT_PEM, badCert],
      setDefaultCACertificates: certs => {
        calls.push([...certs])
        if (certs.some(c => c.includes('BAD'))) {
          throw new Error('bad cert')
        }
      },
    })
    expect(ok).toBe(true)
    expect(getLastSyncedDefaultCACertListForTesting()).toEqual([VALID_CERT_PEM])
    expect(calls.length).toBeGreaterThanOrEqual(2)

    expect(getDroppedCrossCertificatesCount()).toBe(0)
    expect(hasUnmatchedDroppedCrossCertificate()).toBe(false)
    expect(noteServerServedCertificates([] as X509Certificate[])).toBe(false)
  })

  test('#1367: rootOptionsRefusedMessage mentions --settings & canPromptForRemoteControlTrust checks CI', async () => {
    const msg = rootOptionsRefusedMessage(['--settings'])
    expect(msg).toContain(
      'Pass settings with `claude remote-control --settings <file>`.',
    )
    expect(await canPromptForRemoteControlTrust({ CI: 'true' })).toBe(false)
  })

  test('#1392: pickResumeRestoreModel recognizes inPlaceOfModel & configured model, neutralizeRefusalFallbackForFork marks entries', () => {
    const entries: ResumeTranscriptEntry[] = [
      {
        type: 'system',
        subtype: 'model_refusal_fallback',
        fallbackModel: 'claude-opus-4-6',
      },
      {
        type: 'assistant',
        inPlaceOfModel: 'my-custom-deployment',
        message: { model: 'claude-opus-4-6' },
      },
    ]
    neutralizeRefusalFallbackForFork(entries)
    expect(entries[0]!.neutralizedByFork).toBe(true)

    const picked = pickResumeRestoreModel(entries, {
      configuredModel: 'my-custom-deployment',
    })
    expect(picked).toEqual({ kind: 'ok', model: 'my-custom-deployment' })

    const declined = pickResumeRestoreModel(
      [{ type: 'assistant', message: { model: 'unknown-model-xyz' } }],
      {},
    )
    expect(declined).toEqual({
      kind: 'declined',
      model: 'unknown-model-xyz',
      reason: 'unknown_family',
    })
  })

  test('#1432: resume-head.jsonl path, serialization, checksum/bounds validation, PreservedResumeRows, and vouching', () => {
    const projectDir = '/tmp/proj'
    const sid = '11111111-2222-4333-8444-555555555555'
    const transcriptPath = `${projectDir}/sub/${sid}.jsonl`
    expect(getResumeHeadPath(transcriptPath, projectDir)).toBe(
      `${projectDir}/sub/${sid}/resume-head.jsonl`,
    )
    expect(
      getResumeHeadPath(`${projectDir}/sub/not-a-uuid.jsonl`, projectDir),
    ).toBeNull()

    const boundaryOffset = RESUME_HEAD_WINDOW_BYTES * 5 + 100
    const transcript = Buffer.alloc(boundaryOffset + 64, 0x61)
    const boundaryLength = 32
    const probe = resumeHeadSha256(
      transcript.subarray(boundaryOffset, boundaryOffset + boundaryLength),
    )

    const head = {
      boundaryOffset,
      boundaryLength,
      probe,
      generation: 1,
      rowOffsets: [0, 20],
      rowLengths: [10, 12],
    }
    const serialized = serializeResumeHead(head)
    const parsed = parseResumeHead(serialized)
    expect(parsed).toEqual(head)
    expect(vouchResumeHeadProbe(transcript, head)).toBe(true)

    // Tampered checksum -> 'checksum'
    const tampered = Buffer.from(serialized)
    tampered[tampered.length - 3] ^= 0x01
    expect(parseResumeHead(tampered)).toBe('checksum')

    // PreservedResumeRows scan + read + out-of-bounds throw
    const rowsBuf = Buffer.from('0123456789\nabcdefghijkl\n', 'utf8')
    const preserved = new PreservedResumeRows([0, 20], [10, 12], rowsBuf)
    expect(preserved.read(20, 12).toString('utf8')).toBe('abcdefghijkl')
    expect(() => preserved.read(5, 4)).toThrow(NeedsWholeTranscript)
  })
})

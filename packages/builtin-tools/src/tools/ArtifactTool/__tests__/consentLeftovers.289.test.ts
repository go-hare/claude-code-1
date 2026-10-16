;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: 'test',
}

/**
 * densable 2.1.289 Artifact leftover consent/check/call/UI — hosted subset.
 * Gold: delete-check @211246851, upload Tu/AE @211226481, resolve @210875200,
 * map artifact_delete @211325340, isDestructive @211207538.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'
import type { ToolPermissionRulesBySource } from '../../../../../../src/types/permissions.js'
import {
  ARTIFACT_DELETE_PIN,
  checkArtifactActionPermissions,
  isArtifactActionDestructive,
} from '../permissions.js'
import {
  ArtifactTool,
  formatArtifactDeleteResult,
  formatAssetDeleteResult,
} from '../ArtifactTool.js'
import {
  resetArtifactAutoReactStoreForTests,
  un,
} from '../../../../../../src/services/artifactAutoReact/index.js'
import { resetConsentStateForTests } from '../../../../../../src/services/artifactAutoReact/readPerm/consent.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetConsentStateForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_DELETE
  delete process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
  delete process.env.CLAUDE_STAGE_FILE_ROOT
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const FILE = '/tmp/asset.bin'

const HUMAN = [
  {
    type: 'user',
    origin: { kind: 'human' },
    message: { content: 'go' },
  },
]

function fakeContext(
  mode = 'default',
  toolUseId = 'tu-leftover',
  extra?: {
    deny?: ToolPermissionRulesBySource
    frameUrls?: Record<string, { url: string; title?: string }>
    messages?: unknown[]
  },
) {
  return {
    toolUseId,
    abortController: new AbortController(),
    messages: extra?.messages ?? [],
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
        ...(extra?.deny ? { alwaysDenyRules: extra.deny } : {}),
      },
      ...(extra?.frameUrls ? { frameUrls: extra.frameUrls } : {}),
    }),
    setAppState: () => {},
  } as never
}

function seedStatus(toolUseId: string, extra?: Record<string, unknown>): void {
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'owner',
    isSharedLive: false,
    role: 'owner',
    lastProbeToolUseId: toolUseId,
    lastProbeIssuedAt: Date.now(),
    ...extra,
  } as never)
}

describe('densable 2.1.289 Artifact delete leftover (Rat stamp + Jrs/mp copy)', () => {
  test('ask stamps Rat and uses gold Jrs/publishedThisSession copy', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_DELETE = '1'
    seedStatus('tu-del', { title: 'Weekly Plan' })
    const r = (await checkArtifactActionPermissions(
      { action: 'delete', url: URL },
      fakeContext('default', 'tu-del'),
    )) as {
      behavior: string
      message?: string
      localDisplayOnly?: boolean
      updatedInput?: Record<string, unknown>
    }
    expect(r.behavior).toBe('ask')
    expect(r.localDisplayOnly).toBe(true)
    expect(r.message).toBe(
      'Claude wants to permanently delete the artifact "Weekly Plan" (private to the user). Its link will stop working for everyone, its comments and version history are deleted too, and this can\'t be undone. This conversation did not publish it.',
    )
    expect(r.updatedInput?.[ARTIFACT_DELETE_PIN]).toEqual({ slug: SLUG })
    expect(r.updatedInput?.__artifactDeleteTarget).toEqual({
      url: URL,
      title: 'Weekly Plan',
      audience: 'private to the user',
      shareMode: 'owner',
      publishedThisSession: false,
    })
  })

  test('mp stamps publishedThisSession when frameUrls names the slug', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_DELETE = '1'
    seedStatus('tu-del-pub', { title: 'Weekly Plan' })
    const r = (await checkArtifactActionPermissions(
      { action: 'delete', url: URL },
      fakeContext('default', 'tu-del-pub', {
        frameUrls: { [SLUG]: { url: URL, title: 'Weekly Plan' } },
      }),
    )) as {
      message?: string
      updatedInput?: Record<string, unknown>
    }
    expect(r.updatedInput?.__artifactDeleteTarget).toMatchObject({
      publishedThisSession: true,
    })
    expect(r.message).not.toContain('This conversation did not publish it.')
  })

  test('other-org AE denies delete', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_DELETE = '1'
    seedStatus('tu-org', {
      probeFailed: true,
      probeErrorCode: 'boot_org_mismatch',
      role: undefined,
    })
    const r = (await checkArtifactActionPermissions(
      { action: 'delete', url: URL },
      fakeContext('default', 'tu-org'),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain("another of the user's organizations")
    expect(r.message).toContain('Nothing was deleted')
  })
})

describe('densable 2.1.289 upload_asset ownership (Tu/AE/gNe ALIGN)', () => {
  test('other-org AE denies upload', async () => {
    seedStatus('tu-up-org', {
      probeFailed: true,
      probeErrorCode: 'boot_org_mismatch',
      role: undefined,
    })
    const r = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      fakeContext('default', 'tu-up-org'),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('Nothing was uploaded')
  })

  test('ask stamps gNe slug + real', async () => {
    seedStatus('tu-up')
    const r = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      fakeContext('default', 'tu-up'),
    )) as {
      behavior: string
      message?: string
      updatedInput?: Record<string, unknown>
    }
    expect(r.behavior).toBe('ask')
    const pin = r.updatedInput?.__artifactAssetUploadPin as {
      slug: string
      real: string
      identity: unknown
    }
    expect(pin.slug).toBe(SLUG)
    expect(pin.real).toBe(FILE)
    expect(pin.identity === null || typeof pin.identity === 'string').toBe(true)
    expect(r.message).not.toContain('belongs to someone else')
  })

  test("YBe appends when the artifact is not the user's", async () => {
    seedStatus('tu-up-ybe', { role: 'reader' })
    const r = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: FILE },
      fakeContext('default', 'tu-up-ybe'),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('ask')
    expect(r.message).toContain(
      'This artifact belongs to someone else — approving will write into their artifact.',
    )
  })

  test('file_path XOR file_paths denies both; batch stamps gNe.batch', async () => {
    seedStatus('tu-xor')
    const both = (await checkArtifactActionPermissions(
      {
        action: 'upload_asset',
        url: URL,
        file_path: FILE,
        file_paths: [FILE],
      },
      fakeContext('default', 'tu-xor'),
    )) as { behavior: string; message?: string }
    expect(both.behavior).toBe('deny')
    expect(both.message).toContain('not both')
    seedStatus('tu-batch')
    const batch = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_paths: [FILE, '/tmp/b.png'] },
      fakeContext('default', 'tu-batch'),
    )) as {
      behavior: string
      message?: string
      updatedInput?: Record<string, unknown>
    }
    expect(batch.behavior).toBe('ask')
    expect(batch.message).toContain('2 local files')
    const pin = batch.updatedInput?.__artifactAssetUploadPin as {
      slug: string
      batch: Array<{ real: string; identity: unknown }>
    }
    expect(pin.slug).toBe(SLUG)
    expect(pin.batch.map(row => row.real)).toEqual([FILE, '/tmp/b.png'])
    for (const row of pin.batch) {
      expect(row.identity === null || typeof row.identity === 'string').toBe(
        true,
      )
    }
  })

  test('Gqe denies when Read rules block the file', async () => {
    const blocked = join(process.cwd(), 'package.json')
    seedStatus('tu-gqe')
    const r = (await checkArtifactActionPermissions(
      { action: 'upload_asset', url: URL, file_path: blocked },
      fakeContext('default', 'tu-gqe', {
        deny: { session: ['Read(package.json)'] },
      }),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain('Permission to read')
    expect(r.message).toContain('has been denied')
  })

  test('call upload uses gold pin/read error names', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ArtifactTool.ts'),
      'utf8',
    )
    expect(src).toContain('asset_upload_read_denied')
    expect(src).toContain('Reflect.get(input, gNe)')
    expect(src).toContain('pin.slug !== parsed.slug')
    expect(src).toContain('pin?.batch !== undefined')
  })
})

describe('densable 2.1.289 resolve/reply/watch leftovers', () => {
  test('resolve allows without ask (gold @210875200)', async () => {
    seedStatus('tu-res')
    const r = (await checkArtifactActionPermissions(
      { action: 'resolve', url: URL, thread_id: SLUG },
      fakeContext('default', 'tu-res'),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('allow')
    expect(r.message).toBeUndefined()
  })

  test('resolve still denies in plan', async () => {
    const r = (await checkArtifactActionPermissions(
      { action: 'resolve', url: URL, thread_id: SLUG },
      fakeContext('plan', 'tu-res-plan'),
    )) as { behavior: string }
    expect(r.behavior).toBe('deny')
  })

  test('reply still asks; watch ask is localDisplayOnly', async () => {
    seedStatus('tu-reply')
    const reply = (await checkArtifactActionPermissions(
      { action: 'reply', url: URL, thread_id: SLUG, text: 'hi' },
      fakeContext('default', 'tu-reply'),
    )) as { behavior: string }
    expect(reply.behavior).toBe('ask')
    seedStatus('tu-watch')
    const watch = (await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext('default', 'tu-watch'),
    )) as { behavior: string; localDisplayOnly?: boolean }
    expect(watch.behavior).toBe('ask')
    expect(watch.localDisplayOnly).toBe(true)
  })

  test('hosted Ijn denies reply when caps were not read', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_CODE_ENVIRONMENT_KIND
    seedStatus('tu-ijn-reply')
    const r = (await checkArtifactActionPermissions(
      { action: 'reply', url: URL, thread_id: SLUG, text: 'hi' },
      fakeContext('default', 'tu-ijn-reply'),
    )) as { behavior: string; message?: string }
    expect(r.behavior).toBe('deny')
    expect(r.message).toContain(
      'could not read whether this page keeps its own comment threads',
    )
  })

  test('hosted Ijn allows reply after lastCapsReadAt lands', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    seedStatus('tu-ijn-ok', { lastCapsReadAt: Date.now() })
    const r = (await checkArtifactActionPermissions(
      { action: 'reply', url: URL, thread_id: SLUG, text: 'hi' },
      fakeContext('default', 'tu-ijn-ok'),
    )) as { behavior: string }
    expect(r.behavior).toBe('ask')
  })

  test('hosted Ijn skips reader role; resolve denies without caps', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    seedStatus('tu-ijn-reader', { role: 'reader' })
    const reader = (await checkArtifactActionPermissions(
      { action: 'reply', url: URL, thread_id: SLUG, text: 'hi' },
      fakeContext('default', 'tu-ijn-reader'),
    )) as { behavior: string }
    expect(reader.behavior).toBe('ask')
    seedStatus('tu-ijn-res')
    const resolve = (await checkArtifactActionPermissions(
      { action: 'resolve', url: URL, thread_id: SLUG },
      fakeContext('default', 'tu-ijn-res'),
    )) as { behavior: string; message?: string }
    expect(resolve.behavior).toBe('deny')
    expect(resolve.message).toContain('nothing was posted or resolved')
  })

  test('reply Izr allows a private owned write on a human five-class turn', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_FIVE_CLASS_ASKS = '1'
    seedStatus('tu-izr')
    const r = (await checkArtifactActionPermissions(
      { action: 'reply', url: URL, thread_id: SLUG, text: 'hi' },
      fakeContext('default', 'tu-izr', { messages: HUMAN }),
    )) as { behavior: string; updatedInput?: Record<string, unknown> }
    expect(r.behavior).toBe('allow')
  })
})

describe('densable 2.1.289 Artifact isDestructive + map/UI delete strings', () => {
  test('isDestructive is delete and delete_asset only', () => {
    expect(isArtifactActionDestructive({ action: 'delete' })).toBe(true)
    expect(isArtifactActionDestructive({ action: 'delete_asset' })).toBe(true)
    expect(isArtifactActionDestructive({ action: 'upload_asset' })).toBe(false)
    expect(ArtifactTool.isDestructive?.({ action: 'delete' } as never)).toBe(
      true,
    )
  })

  test('description lock gold delete copy', async () => {
    expect(await ArtifactTool.description({ action: 'delete' } as never)).toBe(
      'Permanently delete a published artifact the user owns (irreversible); every delete asks the user.',
    )
  })

  test('mapToolResult artifact_delete uses gold sentence', () => {
    const mapped = ArtifactTool.mapToolResultToToolResultBlockParam(
      {
        id: '',
        url: '',
        expiresAt: '',
        artifact_delete: { url: URL, deleted: true },
      },
      'tu-map',
    )
    expect(mapped.content).toContain(`Artifact deleted: ${URL}`)
    expect(mapped.content).toContain('cannot be restored')
    expect(String(mapped.content)).not.toContain('Artifact uploaded')
    expect(
      formatArtifactDeleteResult({
        url: URL,
        deleted: true,
        already_gone: true,
      }),
    ).toContain('was already deleted')
    expect(formatAssetDeleteResult({ id: 'ab', deleted: true })).toContain(
      '_blob/ab',
    )
  })
})

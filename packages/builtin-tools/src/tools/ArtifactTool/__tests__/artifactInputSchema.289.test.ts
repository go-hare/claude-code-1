/**
 * densable 2.1.289 Artifact `tT()` — one flat model-facing schema; delete pin
 * is gold Tat (`__artifactDeletePin`) stamped at checkPermissions, not on tT().
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../../../../src/Tool.js'
import { inputSchema } from '../artifactInputSchemas.js'
import {
  ARTIFACT_DELETE_PIN,
  checkArtifactActionPermissions,
} from '../permissions.js'
import { zodToJsonSchema } from '../../../../../../src/utils/zodToJsonSchema.js'
import {
  resetArtifactAutoReactStoreForTests,
  un,
} from '../../../../../../src/services/artifactAutoReact/index.js'

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_DELETE
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const TOOL_USE_ID = 'tu-delete-pin'

const FORBIDDEN_SCHEMA_STRINGS = [
  '__artifactAssetTargetPin',
  '__artifactConsentAskCanReachUser',
  '__deleteConfirm',
  '__artifactDeletePin',
] as const

const UNOFFICIAL_HOSTED_INVENTIONS = [
  'list_types',
  'describe_type',
  'copy_from',
  'read_db',
  'write_db',
  'type_url',
  'capabilities',
] as const

function jsonOfInputSchema(): string {
  return JSON.stringify(zodToJsonSchema(inputSchema()))
}

function fakeContext(mode = 'default') {
  return {
    toolUseId: TOOL_USE_ID,
    abortController: new AbortController(),
    messages: [],
    getAppState: () => ({
      toolPermissionContext: {
        ...getEmptyToolPermissionContext(),
        mode,
      },
    }),
    setAppState: () => {},
  } as never
}

function setOwnerRole(): void {
  un().shareStatus.bySlug.set(SLUG, {
    mode: 'owner',
    isSharedLive: false,
    role: 'owner',
    lastProbeToolUseId: TOOL_USE_ID,
    lastProbeIssuedAt: Date.now(),
  } as never)
}

describe('densable 2.1.289 Artifact tT() model-facing schema', () => {
  test('zodToJsonSchema is one object and omits permission stamps', () => {
    const json = jsonOfInputSchema()
    const schema = zodToJsonSchema(inputSchema())
    expect(schema.type).toBe('object')
    expect(schema.anyOf).toBeUndefined()
    expect(schema.oneOf).toBeUndefined()
    for (const needle of FORBIDDEN_SCHEMA_STRINGS) {
      expect(json).not.toContain(needle)
    }
  })

  test('hosted actions only — no official-only inventions', () => {
    const json = jsonOfInputSchema()
    for (const needle of UNOFFICIAL_HOSTED_INVENTIONS) {
      expect(json).not.toContain(needle)
    }
    expect(json).not.toContain('__artifact')
    expect(json).toContain('file_paths')
  })

  test('keeps gold read_file path/paths describes', () => {
    const schema = zodToJsonSchema(inputSchema())
    const props = schema.properties as Record<string, { description?: string }>
    expect(props.path?.description).toBe(
      'read_file only: the file\'s published path inside the artifact, exactly as list_files printed it; "index.html" is the page itself.',
    )
    expect(props.paths?.description).toContain(
      'read_file: several published paths in place of `path`, up to',
    )
  })

  test('parses tip upload and hosted delete without a pin field', () => {
    expect(inputSchema().safeParse({ file_path: '/tmp/a.html' }).success).toBe(
      true,
    )
    expect(
      inputSchema().safeParse({ action: 'delete', url: URL }).success,
    ).toBe(true)
    expect(inputSchema().safeParse({ action: 'list' }).success).toBe(true)
    expect(
      inputSchema().safeParse({
        action: 'quickstart',
        intent: 'slides',
      }).success,
    ).toBe(true)
    expect(
      inputSchema().safeParse({
        action: 'upload_asset',
        url: URL,
        file_paths: ['/tmp/a.png', '/tmp/b.pdf'],
      }).success,
    ).toBe(true)
  })
})

describe('densable 2.1.289 Artifact delete pin (Tat)', () => {
  test('checkPermissions stamps __artifactDeletePin, not __deleteConfirm', async () => {
    process.env.CLAUDE_CODE_ARTIFACT_DELETE = '1'
    setOwnerRole()
    const r = (await checkArtifactActionPermissions(
      { action: 'delete', url: URL },
      fakeContext(),
    )) as {
      behavior: string
      message?: string
      localDisplayOnly?: boolean
      updatedInput?: Record<string, unknown>
    }
    expect(r.behavior).toBe('ask')
    expect(r.updatedInput?.[ARTIFACT_DELETE_PIN]).toEqual({ slug: SLUG })
    expect(r.updatedInput?.__deleteConfirm).toBeUndefined()
    expect(r.updatedInput?.__artifactDeleteTarget).toMatchObject({
      url: URL,
      audience: 'private to the user',
      shareMode: 'owner',
      publishedThisSession: false,
    })
    expect(ARTIFACT_DELETE_PIN).toBe('__artifactDeletePin')
    expect(r.message).toContain('Its link will stop working for everyone')
    expect(r.localDisplayOnly).toBe(true)
  })

  test('call delete reads gold pin via Reflect.get, not __deleteConfirm', () => {
    const src = readFileSync(
      join(import.meta.dir, '../ArtifactTool.ts'),
      'utf8',
    )
    expect(src).toContain('Reflect.get(input, ARTIFACT_DELETE_PIN)')
    expect(src).not.toContain('__deleteConfirm')
    expect(src).toContain("from './permissions.js'")
  })
})

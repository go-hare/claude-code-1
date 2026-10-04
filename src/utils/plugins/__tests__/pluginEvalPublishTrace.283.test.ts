import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { OFFICIAL_ARTIFACT_TOOL_NAME } from '../../artifactUrl.js'
import { foldEvalStubPublishes } from '../pluginEval/evalArtifactsFence.js'
import {
  EVAL_STUB_ARTIFACT_URL_PREFIX,
  artifactPublishToolUseIds,
  collectEvalArtifactPublishes,
  corroboratedStubSlugs,
  parseEvalStubArtifactUrl,
} from '../pluginEval/evalPublishTrace.js'
import type { EvalSandbox } from '../pluginEval/types.js'
import { PluginEvalPathError } from '../pluginEval/pathVet.js'

const SLUG = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PROD_URL = `https://claude.ai/code/artifact/${SLUG}`
const STUB_URL = `${EVAL_STUB_ARTIFACT_URL_PREFIX}${SLUG}`

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

function sandboxAt(root: string): EvalSandbox {
  return {
    root,
    cwd: join(root, 'cwd'),
    configDir: join(root, 'config'),
    home: join(root, 'home'),
    outDir: join(root, 'out'),
    tmpDir: join(root, 'tmp'),
    operatorConfigDir: join(root, 'op'),
    cleanup: async () => {},
  }
}

function publishTrace(
  opts: { action?: string; error?: boolean; url?: string } = {},
): unknown[] {
  const action = opts.action
  return [
    {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: OFFICIAL_ARTIFACT_TOOL_NAME,
            input: action === undefined ? {} : { action },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            is_error: opts.error,
          },
        ],
      },
      tool_use_result: opts.url === undefined ? undefined : { url: opts.url },
    },
  ]
}

describe('plugin eval mp/gp/nf densable 2.1.283', () => {
  test('mp collects unique Artifact publish URLs; non-publish and errors skip', () => {
    expect(artifactPublishToolUseIds(publishTrace())).toEqual(new Set(['tu_1']))
    expect(
      collectEvalArtifactPublishes(publishTrace({ url: PROD_URL })),
    ).toEqual([{ url: PROD_URL, slug: SLUG, env: 'prod' }])
    expect(
      collectEvalArtifactPublishes(
        publishTrace({ action: 'read', url: PROD_URL }),
      ),
    ).toEqual([])
    expect(
      collectEvalArtifactPublishes(
        publishTrace({ error: true, url: PROD_URL }),
      ),
    ).toEqual([])
  })

  test('gp / _$e seeds stub slugs from eval-stub://artifact/<uuid>', () => {
    expect(parseEvalStubArtifactUrl(STUB_URL)).toEqual({ slug: SLUG })
    expect(parseEvalStubArtifactUrl(PROD_URL)).toBeNull()
    expect(corroboratedStubSlugs(publishTrace({ url: STUB_URL }))).toEqual(
      new Set([SLUG]),
    )
    expect(corroboratedStubSlugs(publishTrace({ url: PROD_URL }))).toEqual(
      new Set(),
    )
  })

  test('nf ENOENT + empty corroborated is []; nonempty throws gold copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-nf-'))
    tempDirs.push(root)
    const sb = sandboxAt(root)
    await mkdir(sb.outDir, { recursive: true })
    await expect(foldEvalStubPublishes(sb, new Set())).resolves.toEqual([])
    await expect(
      foldEvalStubPublishes(sb, new Set([SLUG])),
    ).rejects.toMatchObject({
      code: 'eval: stub publish staging dir missing',
      message: expect.stringContaining(
        'gone although the run published (1 corroborated)',
      ),
    })
  })

  test('nf replaced staging dir discards and throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-nf-rep-'))
    tempDirs.push(root)
    const sb = sandboxAt(root)
    await mkdir(sb.outDir, { recursive: true })
    await writeFile(join(sb.outDir, 'stub-publishes'), 'not-a-dir')
    await expect(foldEvalStubPublishes(sb, new Set())).rejects.toMatchObject({
      code: 'eval: stub publish staging dir replaced',
      message: expect.stringContaining(
        'was replaced by something that is not a directory',
      ),
    })
  })

  test('nf indexes corroborated slug dirs and drops leftover entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-nf-ok-'))
    tempDirs.push(root)
    const sb = sandboxAt(root)
    const stub = join(sb.outDir, 'stub-publishes')
    const payload = join(stub, SLUG)
    await mkdir(payload, { recursive: true })
    await mkdir(join(stub, 'leftover-noise'), { recursive: true })
    await writeFile(
      join(payload, 'manifest.json'),
      JSON.stringify({
        slug: SLUG,
        url: STUB_URL,
        publishedAtMs: 2,
      }),
    )
    const folded = await foldEvalStubPublishes(sb, new Set([SLUG]))
    expect(folded).toEqual([
      {
        url: STUB_URL,
        slug: SLUG,
        env: 'stub',
        payloadDir: payload,
      },
    ])
    await expect(
      rm(join(stub, 'leftover-noise'), { recursive: true }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('nf missing corroborated slug throws payload missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-eval-nf-miss-'))
    tempDirs.push(root)
    const sb = sandboxAt(root)
    await mkdir(join(sb.outDir, 'stub-publishes'), { recursive: true })
    await expect(
      foldEvalStubPublishes(sb, new Set([SLUG])),
    ).rejects.toBeInstanceOf(PluginEvalPathError)
    await expect(
      foldEvalStubPublishes(sb, new Set([SLUG])),
    ).rejects.toMatchObject({
      code: 'eval: stub publish payload missing',
    })
  })
})

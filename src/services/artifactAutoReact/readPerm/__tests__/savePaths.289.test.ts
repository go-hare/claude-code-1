/**
 * densable Ia / Ro / Ol / vU / l7 / sS / iS / nye / Av / Rv / m4 / y_ (2.1.289)
 * — read_file / read_asset save-destination permission layer.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
} from 'src/Tool.js'
import * as realFilesystem from 'src/utils/permissions/filesystem.js'
import { snapshotModuleExports } from '../../../../../tests/mocks/settings.js'

const filesystemSnap = snapshotModuleExports(realFilesystem)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'save-paths-289-')))
const scratchpad = join(root, 'session', 'scratchpad')
const work = join(root, 'work')
const outside = join(root, 'outside')
mkdirSync(scratchpad, { recursive: true })
mkdirSync(work, { recursive: true })
mkdirSync(outside, { recursive: true })
let scratchOn = true

mock.module('src/utils/permissions/filesystem.js', () => ({
  ...filesystemSnap,
  isScratchpadEnabled: () => scratchOn,
  getScratchpadDir: () => scratchpad,
}))

const {
  allSpellingsInScratchpadCarveOut,
  askSeverityRank,
  checkSaveDestinationWritePermission,
  isInScratchpadCarveOut,
  isSavePathInWorkingDirectories,
  packStashedSpellings,
  permissionSpellingsFor,
  prepareGuardedWrite,
  savePathSpellings,
  scratchpadComparison,
  stashWritePermission,
  takeApprovedSaveSpellings,
  takeStashedWritePermission,
  unpackStashedSpellings,
  WRITE_PERMISSION_STASH_EVICTED,
} = await import('src/services/artifactAutoReact/readPerm/savePaths.js')
const { checkWritePermissionForTool } = await import(
  'src/utils/permissions/filesystem.js'
)
const { getBootstrapSession } = await import('src/utils/sessionRoot.js')
const { setCwdState, setOriginalCwd, setProjectRoot } = await import(
  'src/bootstrap/state.js'
)

const suiteCwd = process.cwd()

afterAll(() => {
  mock.module('src/utils/permissions/filesystem.js', () => ({
    ...filesystemSnap,
  }))
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  scratchOn = true
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  setProjectRoot(suiteCwd)
})

afterEach(() => {
  const stash = getBootstrapSession().writePermissionStash
  stash.pathsByToolUse.clear()
  stash.evicted.clear()
  stash.poisoned = false
})

type SaveInput = { dest: string }
const saveTool = {
  name: 'Artifact',
  getPath: (input: SaveInput) => input.dest,
} as unknown as Tool

function ctx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    additionalWorkingDirectories: new Map([
      [work, { path: work, source: 'session' as const }],
    ]),
    ...overrides,
  } as ToolPermissionContext
}

function link(name: string, target: string): string {
  const path = join(root, name)
  symlinkSync(target, path)
  return path
}

const realDir = join(root, 'real')
mkdirSync(realDir, { recursive: true })
const linkedDir = link('linked', realDir)
const workLink = join(work, 'escape')
symlinkSync(outside, workLink)
const leafTarget = join(realDir, 'target.txt')
writeFileSync(leafTarget, 'x')
const leafLink = link('leaf.txt', leafTarget)

describe('Ia savePathSpellings (289)', () => {
  test('a not-yet-existing dest is its own landing', () => {
    const dest = join(work, 'new', 'a.md')
    const walked = savePathSpellings(dest)
    expect(walked).toEqual({
      unresolved: false,
      requested: dest,
      spellings: [dest],
      landing: dest,
      leafIsSymlink: false,
    })
    expect(permissionSpellingsFor(dest)).toEqual([dest])
  })

  test('a dest under a linked dir spells both sides, landing last', () => {
    const dest = join(linkedDir, 'a.md')
    const walked = savePathSpellings(dest)
    expect(walked.unresolved).toBe(false)
    expect(walked.spellings).toEqual([dest, join(realDir, 'a.md')])
    if (!walked.unresolved) expect(walked.landing).toBe(join(realDir, 'a.md'))
  })

  test('a link leaf is flagged and lands on its target', () => {
    const walked = savePathSpellings(leafLink)
    expect(walked.leafIsSymlink).toBe(true)
    expect(walked.spellings).toEqual([leafLink, leafTarget])
  })
})

describe('Ol / vU / l7 scratchpad carve-out (289)', () => {
  test('Ol is null without a scratchpad', () => {
    scratchOn = false
    expect(scratchpadComparison(join(scratchpad, 'a'))).toBeNull()
    expect(isInScratchpadCarveOut(join(scratchpad, 'a'))).toBe(false)
  })

  test('Ol folds case against the scratchpad prefix', () => {
    const cmp = scratchpadComparison(join(scratchpad, 'A.MD'))
    expect(cmp?.comparePath).toBe(join(scratchpad, 'a.md').toLowerCase())
    expect(cmp?.prefix).toBe(`${scratchpad.toLowerCase()}/`)
  })

  test('vU admits the scratchpad and plain files below it', () => {
    expect(isInScratchpadCarveOut(scratchpad)).toBe(true)
    expect(
      isInScratchpadCarveOut(join(scratchpad, 'artifact-files', 'x', 'a.md')),
    ).toBe(true)
    expect(isInScratchpadCarveOut(join(scratchpad, '.bashrc', 'a.md'))).toBe(
      true,
    )
  })

  test('vU screens git / hook / config segments and leaf rc files', () => {
    for (const rel of [
      '.git/config',
      'x/HOOKS/pre-commit',
      'node_modules/a.js',
      '.git./x',
      'a/.Bashrc',
      'a/.npmrc',
    ]) {
      expect(isInScratchpadCarveOut(join(scratchpad, rel))).toBe(false)
    }
  })

  test('vU rejects paths outside or escaping the scratchpad', () => {
    expect(isInScratchpadCarveOut(join(outside, 'a.md'))).toBe(false)
    expect(isInScratchpadCarveOut(join(scratchpad, '..', 'a.md'))).toBe(false)
  })

  test('l7 needs every spelling of every dest inside the carve-out', () => {
    const a = join(scratchpad, 'a.md')
    const b = join(scratchpad, 'b.md')
    expect(allSpellingsInScratchpadCarveOut([])).toBe(false)
    expect(allSpellingsInScratchpadCarveOut([[]])).toBe(false)
    expect(allSpellingsInScratchpadCarveOut([[a], [b]])).toBe(true)
    expect(
      allSpellingsInScratchpadCarveOut([[a], [b, join(outside, 'b.md')]]),
    ).toBe(false)
  })
})

describe('sS isSavePathInWorkingDirectories (289)', () => {
  test('inside an added working directory', () => {
    expect(isSavePathInWorkingDirectories(join(work, 'a.md'), ctx())).toBe(true)
  })

  test('outside, or through a link leading out of it', () => {
    expect(isSavePathInWorkingDirectories(join(outside, 'a.md'), ctx())).toBe(
      false,
    )
    expect(isSavePathInWorkingDirectories(join(workLink, 'a.md'), ctx())).toBe(
      false,
    )
  })
})

describe('iS checkSaveDestinationWritePermission (289)', () => {
  test('deny rule on the landing spelling denies with the gold message', () => {
    const dest = join(linkedDir, 'a.md')
    const result = checkSaveDestinationWritePermission(
      saveTool,
      { dest },
      ctx({ alwaysDenyRules: { session: [`Edit(/${realDir}/**)`] } }),
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toBe(`Permission to edit ${dest} has been denied.`)
      expect(result.decisionReason?.type).toBe('rule')
    }
  })

  test('ask rule asks with a rule reason', () => {
    const dest = join(work, 'a.md')
    const result = checkSaveDestinationWritePermission(
      saveTool,
      { dest },
      ctx({ alwaysAskRules: { session: [`Edit(/${work}/**)`] } }),
    )
    expect(result.behavior).toBe('ask')
    expect(result.decisionReason?.type).toBe('rule')
  })

  test('acceptEdits allows inside a working dir; plan asks by mode', () => {
    const dest = join(work, 'a.md')
    expect(
      checkSaveDestinationWritePermission(
        saveTool,
        { dest },
        ctx({ mode: 'acceptEdits' }),
      ).behavior,
    ).toBe('allow')
    const plan = checkSaveDestinationWritePermission(
      saveTool,
      { dest },
      ctx({ mode: 'plan' }),
    )
    expect(plan.behavior).toBe('ask')
    expect(plan.decisionReason).toEqual({ type: 'mode', mode: 'plan' })
  })

  test('an unresolved walk is refused once no rule denies', () => {
    const dest = join(work, 'a.md')
    const result = checkSaveDestinationWritePermission(
      saveTool,
      { dest },
      ctx({ mode: 'acceptEdits' }),
      {
        unresolved: true,
        requested: dest,
        spellings: [dest],
        leafIsSymlink: false,
      },
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain(
        `Refusing to write ${dest}: where it leads on disk could not be determined`,
      )
    }
  })

  test('no symlink-leaf deny: a linked out_dir base still passes', () => {
    const workLinked = join(work, 'linked-out')
    const workReal = join(work, 'real-out')
    mkdirSync(workReal, { recursive: true })
    symlinkSync(workReal, workLinked)
    const input = { dest: workLinked }
    const plain = checkWritePermissionForTool(
      saveTool,
      input,
      ctx({ mode: 'acceptEdits' }),
    )
    expect(plain.behavior).toBe('deny')
    const result = checkSaveDestinationWritePermission(
      saveTool,
      input,
      ctx({ mode: 'acceptEdits' }),
    )
    expect(result.behavior).toBe('allow')
  })

  test('a tool without getPath asks', () => {
    const result = checkSaveDestinationWritePermission(
      { name: 'Artifact' } as unknown as Tool,
      {},
      ctx(),
    )
    expect(result).toEqual({
      behavior: 'ask',
      message:
        "Claude requested permissions to use Artifact, but you haven't granted it yet.",
    })
  })
})

describe('nye askSeverityRank (289)', () => {
  test('ranks ask reasons; non-ask is -1', () => {
    expect(askSeverityRank({ behavior: 'allow', updatedInput: {} })).toBe(-1)
    expect(
      askSeverityRank({
        behavior: 'deny',
        message: 'x',
        decisionReason: { type: 'other', reason: 'x' },
      }),
    ).toBe(-1)
    expect(askSeverityRank({ behavior: 'ask', message: 'x' })).toBe(0)
    expect(
      askSeverityRank({
        behavior: 'ask',
        message: 'x',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'x',
          classifierApprovable: true,
        },
      }),
    ).toBe(1)
    expect(
      askSeverityRank({
        behavior: 'ask',
        message: 'x',
        decisionReason: { type: 'mode', mode: 'plan' },
      }),
    ).toBe(2)
    expect(
      askSeverityRank({
        behavior: 'ask',
        message: 'x',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'x',
          classifierApprovable: false,
        },
      }),
    ).toBe(3)
    expect(
      askSeverityRank({
        behavior: 'ask',
        message: 'x',
        decisionReason: {
          type: 'rule',
          rule: {
            source: 'session',
            ruleBehavior: 'ask',
            ruleValue: { toolName: 'Edit' },
          },
        },
      }),
    ).toBe(4)
  })
})

describe('Av / Rv / writePermissionStash / m4 (289)', () => {
  test('Av packs per-dest spellings that Rv unpacks', () => {
    const dests = [join(work, 'a'), join(work, 'b')]
    const packed = packStashedSpellings(dests, [['a1', 'a2'], ['b1']])
    expect(packed).toEqual([
      `${dests[0]}\0a1`,
      `${dests[0]}\0a2`,
      `${dests[1]}\0b1`,
    ])
    expect(
      unpackStashedSpellings(packed, [dests[1] ?? '', join(work, 'c')]),
    ).toEqual([['b1'], []])
  })

  test('stash is taken once and clears the toolUseId', () => {
    stashWritePermission('tu-1', '/a', ['/a', '/b'])
    stashWritePermission('tu-1', '/c', ['/c'])
    expect(takeStashedWritePermission('tu-1', '/a')).toEqual(['/a', '/b'])
    expect(takeStashedWritePermission('tu-1', '/c')).toBeUndefined()
    expect(takeStashedWritePermission(undefined, '/a')).toBeUndefined()
  })

  test('m4 falls back to a fresh Ro without a stash', () => {
    const dest = join(linkedDir, 'm4.md')
    expect(takeApprovedSaveSpellings('tu-none', dest)).toEqual(
      permissionSpellingsFor(dest),
    )
  })

  test('m4 refuses an evicted stash', () => {
    for (let i = 0; i <= 256; i++) stashWritePermission(`tu-${i}`, '/x', ['/x'])
    expect(
      takeStashedWritePermission('tu-0', '/x') ===
        WRITE_PERMISSION_STASH_EVICTED,
    ).toBe(true)
    for (let i = 0; i <= 256; i++) stashWritePermission(`tv-${i}`, '/x', ['/x'])
    expect(() => takeApprovedSaveSpellings('tv-0', '/x')).toThrow(
      'Refusing to write /x: its permission check expired before it ran (too many concurrent file operations). Retry.',
    )
  })
})

describe('y_ prepareGuardedWrite (289)', () => {
  test('creates parents and writes at the approved spelling', async () => {
    const dest = join(work, 'deep', 'er', 'a.md')
    const pin = await prepareGuardedWrite(
      dest,
      savePathSpellings(dest).spellings,
      { createParents: true },
    )
    try {
      await pin.recheckBeforeWrite()
      await writeFile(pin.ioPath, 'saved')
    } finally {
      await pin.close()
    }
    expect(readFileSync(dest, 'utf8')).toBe('saved')
  })

  test('refuses when a parent became a link after approval', async () => {
    const parent = join(work, 'swapped')
    const dest = join(parent, 'a.md')
    const spellings = savePathSpellings(dest).spellings
    symlinkSync(outside, parent)
    await expect(
      prepareGuardedWrite(dest, spellings, { createParents: true }),
    ).rejects.toThrow(
      `Refusing to write ${dest}: its parent-directory symlink resolution changed after permission was checked.`,
    )
  })
})

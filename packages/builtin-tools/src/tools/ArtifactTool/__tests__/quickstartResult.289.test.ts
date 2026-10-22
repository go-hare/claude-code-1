import { afterEach, describe, expect, test } from 'bun:test'

import { resetArtifactToolsetLatchForTests } from '../quickstartCatalog.js'
import { formatQuickstartResult, quoteTypeLine } from '../quickstartResult.js'

describe('gold 2.1.289 Artifact gy analog', () => {
  afterEach(() => {
    delete process.env.CLAUDE_CODE_ARTIFACT_TOOLSET
    resetArtifactToolsetLatchForTests()
  })

  test('unreadable when the bag is missing or intent is unknown', () => {
    const copy =
      'This record of the quickstart result is unreadable — run action "quickstart" again for the real one.'
    expect(formatQuickstartResult({})).toBe(copy)
    expect(formatQuickstartResult({ quickstart: null })).toBe(copy)
    expect(formatQuickstartResult({ quickstart: { intent: 'nope' } })).toBe(
      copy,
    )
    expect(
      formatQuickstartResult({
        quickstart: { intent: 'slides', match: 'not-an-object' },
      }),
    ).toBe(copy)
  })

  test('document without Docs connector keeps HAVE copy', () => {
    const text = formatQuickstartResult({
      quickstart: { intent: 'document', docs_connector: false },
    })
    expect(text).toContain('No first-party Claude Docs connector')
    expect(text).toContain('call quickstart again with `intent: "other"`')
    expect(text).toContain(
      'A document the user asks for as a .docx file stays with the skill for that format.',
    )
  })

  test('types_ruled note uses Artifact types not listed', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        types_ruled: true,
        types_note:
          'the permission rule Artifact(list_types) governs listing the Artifact types — make that call yourself and the rule decides',
      },
    })
    expect(text).toContain(
      '[Artifact types not listed: the permission rule Artifact(list_types) governs listing the Artifact types — make that call yourself and the rule decides.]',
    )
    expect(text).toContain(
      'If you make it as a plain page instead, load the `artifact-design` skill before writing it.',
    )
  })

  test('match HIT stands in for types and design systems', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
          tier: 'core',
        },
        design_systems: {
          type: 'Design System',
          instances: [
            {
              title: 'Acme',
              rel: 'mine',
              default: 'user',
              url: 'https://claude.ai/code/artifact/acme',
            },
          ],
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/sys-1',
          docs: [{ path: 'README.md', text: '# tokens' }],
        },
      },
    })
    expect(text).toContain(
      "This one result stands in for listing the Artifact types, listing the design systems and reading the default design system's README",
    )
    expect(text).toContain('do not make those calls as well.')
    expect(text).toContain(
      quoteTypeLine({
        title: 'Design',
        type_url: 'https://claude.ai/code/artifact/design-core',
        tier: 'core',
      }),
    )
    expect(text).toContain(
      'publish with `type_url`: https://claude.ai/code/artifact/design-core',
    )
  })

  test('types_ambiguous asks which titled type they mean', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        types_ambiguous: true,
        types: [
          { title: 'Slides', type_url: 'https://claude.ai/code/artifact/a' },
          { title: 'Slides', type_url: 'https://claude.ai/code/artifact/b' },
        ],
      },
    })
    expect(text).toContain(
      'Several published Artifact types are titled Slides — ask the user which they mean',
    )
    expect(text).toContain('https://claude.ai/code/artifact/a')
    expect(text).toContain('https://claude.ai/code/artifact/b')
  })

  test('other lists types and Dashboard type_url', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'other',
        types: [
          { title: 'Alpha', type_url: 'https://claude.ai/code/artifact/a' },
          { title: 'Beta', type_url: 'https://claude.ai/code/artifact/b' },
        ],
        types_more: true,
        dashboard_type: {
          title: 'Dashboard',
          type_url: 'https://claude.ai/code/artifact/dash-1',
        },
      },
    })
    expect(text).toContain('2 published Artifact types:')
    expect(text).toContain(
      'For a dashboard, metrics page, KPI tracker or scorecard, start from the Dashboard type: publish with `type_url`: https://claude.ai/code/artifact/dash-1',
    )
    expect(text).toContain('action "list" with `scope: "types"`')
  })

  test('start_kit.not_saved not listed first-party is kept verbatim', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        start_kit: { not_saved: 'not listed first-party' },
      },
    })
    expect(text).toContain('not listed first-party')
    expect(text).toContain('Type files were not saved: not listed first-party.')
  })

  test('start_kit.system_not_saved it publishes no files of its own', () => {
    const dir = '/tmp/claude-quickstart-start-kit/slides-1'
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        start_kit: {
          type: { dir, files: [{ path: 'SKILL.md' }] },
          system_not_saved: 'it publishes no files of its own',
        },
      },
    })
    expect(text).toContain(`Type files saved under \`${dir}\``)
    expect(text).toContain('it publishes no files of its own')
    expect(text).toContain(
      'System files were not saved: it publishes no files of its own.',
    )
  })

  test('start_kit type.dir mentions files on disk', () => {
    const dir = '/tmp/claude-quickstart-start-kit/slides-1'
    const systemDir = '/tmp/claude-quickstart-start-kit/system/sys-1'
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        start_kit: {
          type: { dir, files: [{ path: 'SKILL.md' }] },
          system: { dir: systemDir, files: [{ path: 'tokens.json' }] },
        },
      },
    })
    expect(text).toContain(`Type files saved under \`${dir}\``)
    expect(text).toContain(`System files saved under \`${systemDir}\``)
  })

  test('design_system.store tells the model to read_db token cards', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          store: true,
          docs: [{ path: 'README.md', text: '# ds' }],
        },
      },
    })
    expect(text).toContain('action "read_db"')
    expect(text).toContain('`db_op`: "get"')
    expect(text).toContain(
      '`url`: "https://claude.ai/code/artifact/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"',
    )
    expect(text).toContain('`collection`: "api"')
    expect(text).toContain('`doc_id`: "tokens.md"')
    expect(text).toContain('`collection`: "ds"')
    expect(text).toContain('`doc_id`: "tokens"')
    expect(text).not.toContain('action "read_file"')
    expect(text).not.toContain('`path`: "api/tokens.md"')
  })

  test('damson toolset swaps store cards to ArtifactData get', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TOOLSET = '1'
    resetArtifactToolsetLatchForTests()
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/sys-1',
          store: true,
          docs: [{ path: 'README.md', text: '# ds' }],
        },
      },
    })
    expect(text).toContain('the ArtifactData tool, action "get"')
    expect(text).not.toContain('action "read_db"')
    expect(text).toContain('`collection`: "api"')
  })

  test('damson toolset swaps file cards to action read', () => {
    process.env.CLAUDE_CODE_ARTIFACT_TOOLSET = '1'
    resetArtifactToolsetLatchForTests()
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/sys-1',
          docs: [{ path: 'README.md', text: '# ds' }],
        },
      },
    })
    expect(text).toContain('action "read"')
    expect(text).not.toContain('action "read_file"')
    expect(text).toContain('`path`: "api/tokens.md"')
  })

  test('design_systems_off true on slides match leaves systems out', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        design_systems_off: true,
      },
    })
    expect(text).toContain('Design systems left out, as this call asked')
    expect(text).toContain(
      'This one result stands in for listing the Artifact types — do not make that call as well.',
    )
  })

  test('design_systems_note without instances is listed as a note', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        design_systems_note:
          'this account lists no Design System type, so there are none to choose from',
      },
    })
    expect(text).toContain('Design systems not listed:')
    expect(text).toContain(
      'this account lists no Design System type, so there are none to choose from',
    )
  })

  test('huge README on match HIT is left out to keep this result small', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'slides',
        match: {
          title: 'Slides',
          type_url: 'https://claude.ai/code/artifact/slides-1',
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/sys-1',
          docs: [{ path: 'README.md', text: 'R'.repeat(70_000) }],
        },
      },
    })
    expect(text).toContain('Design system not attached')
    expect(text).toContain('keep this result small')
    expect(text).not.toContain('R'.repeat(1000))
  })

  test('Fg separator when instances listed and README fits', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_systems: {
          type: 'Design System',
          instances: [
            {
              title: 'Acme',
              rel: 'mine',
              default: 'user',
              url: 'https://claude.ai/code/artifact/acme',
            },
          ],
        },
        design_system: {
          url: 'https://claude.ai/code/artifact/sys-1',
          docs: [{ path: 'README.md', text: '# tokens' }],
        },
      },
    })
    expect(text).toContain(
      "Below: the design systems this user can open and, when attached, the default one's README.",
    )
    expect(text).toContain("(the user's default, mine)")
    expect(text).toContain('https://claude.ai/code/artifact/acme')
    expect(text).toContain('# tokens')
    expect(text).toContain('Its other cards are not attached')
    expect(text).toContain('action "read_file"')
    expect(text).toContain('`path`: "api/tokens.md"')
    expect(text).toContain(
      "This one result stands in for listing the Artifact types, listing the design systems and reading the default design system's README",
    )
  })

  test("instance mine+user default first row tags the user's default and url", () => {
    const url = 'https://claude.ai/code/artifact/acme'
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_systems: {
          type: 'Design System',
          instances: [
            { title: 'Acme', rel: 'mine', default: 'user', url },
            {
              title: 'Other',
              rel: 'mine',
              default: 'user',
              url: 'https://claude.ai/code/artifact/other',
            },
          ],
        },
      },
    })
    expect(text).toContain(`(the user's default, mine)`)
    expect(text).toContain(url)
    expect(text).toContain('- (mine) "Other"')
  })

  test('shared without audience is shared in the organization', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_systems: {
          type: 'Design System',
          instances: [
            {
              title: 'Org Kit',
              rel: 'shared',
              url: 'https://claude.ai/code/artifact/org-kit',
            },
          ],
        },
      },
    })
    expect(text).toContain('shared in the organization')
    expect(text).not.toContain('shared with the user')
  })

  test('empty instances with unavailable still emit unique English', () => {
    const text = formatQuickstartResult({
      quickstart: {
        intent: 'design',
        match: {
          title: 'Design',
          type_url: 'https://claude.ai/code/artifact/design-core',
        },
        design_systems: {
          type: 'Design System',
          instances: [],
          unavailable: true,
        },
      },
    })
    expect(text).toContain(
      "No listing of Artifacts made from the type \"Design System\" is available for this account (the type isn't in its catalog, or listing a type's Artifacts isn't enabled for it yet) — carry on without one.",
    )
    expect(text).toContain(
      "Below: the design systems this user can open and, when attached, the default one's README.",
    )
  })
})

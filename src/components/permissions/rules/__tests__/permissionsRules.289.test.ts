import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { entryKey, formatAutoModeEntryLabel } from '../AutoModeRulesTab.js'
import { getPermissionRuleDescriptionParts } from '../PermissionRuleDescription.js'

const dir = import.meta.dir

describe('PermissionRuleDescription (2.1.289)', () => {
  test('recognizes both :* and " *" as Bash prefix wildcards', () => {
    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'Bash',
        ruleContent: 'git:*',
      }),
    ).toEqual({
      prefix: 'Any Bash command starting with ',
      emphasis: 'git',
    })

    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'Bash',
        ruleContent: 'git *',
      }),
    ).toEqual({
      prefix: 'Any Bash command starting with ',
      emphasis: 'git',
    })
  })

  test('describes exact Bash commands, bare Bash, and other tools', () => {
    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'Bash',
        ruleContent: 'npm test',
      }),
    ).toEqual({
      prefix: 'The Bash command ',
      emphasis: 'npm test',
    })

    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'Bash',
      }),
    ).toEqual({
      prefix: 'Any Bash command',
    })

    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'WebFetch',
      }),
    ).toEqual({
      prefix: 'Any use of the ',
      emphasis: 'WebFetch',
      suffix: ' tool',
    })

    expect(
      getPermissionRuleDescriptionParts({
        toolName: 'WebFetch',
        ruleContent: 'domain:example.com',
      }),
    ).toBeNull()
  })
})

describe('PermissionRuleInput & WorkspaceTab & AddWorkspaceDirectory (2.1.289)', () => {
  test('PermissionRuleInput uses Dialog, ls * example, and focus={true}', () => {
    const src = readFileSync(join(dir, '../PermissionRuleInput.tsx'), 'utf8')
    expect(src).toContain('<Dialog')
    expect(src).toContain('isCancelActive={false}')
    expect(src).toContain("ruleContent: 'ls *'")
    expect(src).toContain('focus={true}')
    expect(src).toContain('<Byline>')
    expect(src).toContain(
      '<KeyboardShortcutHint shortcut="Enter" action="submit" />',
    )
    expect(src).toContain(
      '<KeyboardShortcutHint shortcut="Esc" action="cancel" />',
    )
  })

  test('AddWorkspaceDirectory tracks cursorOffset, noPad suggestions, onAlreadyAccessible, and Tab-only completion', () => {
    const src = readFileSync(join(dir, '../AddWorkspaceDirectory.tsx'), 'utf8')
    expect(src).toContain('const [cursorOffset, setCursorOffset] = useState(0)')
    expect(src).toContain('disableCursorMovementForUpDownKeys={true}')
    expect(src).toContain('noPad={true}')
    expect(src).toContain('marginTop={1}')
    expect(src).toContain('onAlreadyAccessible')
    expect(src).not.toContain("if (e.key === 'return')")
  })

  test('WorkspaceTab passes hidePromptWhileDisabled={true} to Select', () => {
    const src = readFileSync(join(dir, '../WorkspaceTab.tsx'), 'utf8')
    expect(src).toContain('hidePromptWhileDisabled={true}')
  })
})

describe('RecentDenialsTab & PermissionRuleList & AutoModeRulesTab (2.1.289)', () => {
  test('RecentDenialsTab focuses header when empty, guards r shortcut, and respects withheld/reason', () => {
    const src = readFileSync(join(dir, '../RecentDenialsTab.tsx'), 'utf8')
    expect(src).toContain('onHeaderFocusChange?.(true)')
    expect(src).toContain('description: reason, dimDescription: true')
    expect(src).toContain('withheld')
    expect(src).toContain('if (headerFocused) return')
    expect(src).toContain('if (e.ctrl || e.meta || e.shift) return')
  })

  test('PermissionRuleList treats flagSettings/command as read-only, removes approved denials, and wires onPaste', () => {
    const src = readFileSync(join(dir, '../PermissionRuleList.tsx'), 'utf8')
    expect(src).toContain(
      "rule.source === 'flagSettings' || rule.source === 'command'",
    )
    expect(src).toContain("'the --settings flag' : 'a slash command'")
    expect(src).toContain('This rule comes from a read-only source (')
    expect(src).toContain('removeDenial(denial)')
    expect(src).toContain('metaMessages:')
    expect(src).toContain('onPaste={handlePaste}')
  })

  test('AutoModeRulesTab wires useTabHeaderFocus, SearchBox, and multi-source/legacy rules', () => {
    const src = readFileSync(join(dir, '../AutoModeRulesTab.tsx'), 'utf8')
    expect(src).toContain('useTabHeaderFocus')
    expect(src).toContain('<SearchBox')
    expect(src).toContain('hidePromptWhileDisabled={true}')
    expect(src).toContain('pointerWhileDisabled={!isSearchMode}')
    expect(src).toContain('onUpFromFirstItem={focusHeader}')

    expect(
      formatAutoModeEntryLabel({
        section: 'allow',
        text: 'Allow staging deploys',
        index: 0,
        source: 'userSettings',
      }),
    ).toBe('Soft allow: Allow staging deploys')

    expect(
      formatAutoModeEntryLabel({
        section: 'soft_deny',
        text: 'Block prod drops',
        index: 1,
        source: 'flagSettings',
      }),
    ).toBe('Soft deny · flag: Block prod drops')

    expect(
      formatAutoModeEntryLabel({
        section: 'hard_deny',
        text: 'Never exfiltrate secrets',
        index: 2,
        source: 'policySettings',
      }),
    ).toBe('Hard deny · org: Never exfiltrate secrets')

    expect(
      formatAutoModeEntryLabel({
        section: 'soft_deny',
        text: 'Legacy deny rule',
        index: 0,
        source: 'userSettings',
        legacy: true,
      }),
    ).toBe('Soft deny · legacy: Legacy deny rule')

    expect(
      entryKey({
        section: 'soft_deny',
        text: 'Legacy deny rule',
        index: 3,
        source: 'userSettings',
        legacy: true,
      }),
    ).toBe('soft_deny:userSettings:legacy-3')
  })
})

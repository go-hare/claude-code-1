import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('2.1.290 #140 PromptInputFooterSuggestions pointer', () => {
  test('renders figures.pointer (❯) for selected items when not screen reader', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'PromptInputFooterSuggestions.tsx'), 'utf8');
    expect(src).toContain('useContext(AccessibilityContext)');
    expect(src).toContain("isScreenReader && !isEmoji ? '' : isSelected ? `${figures.pointer} ` : '  '");
    expect(src).toContain('lineContent = `${pointer}${icon} ${displayText}');
  });
});

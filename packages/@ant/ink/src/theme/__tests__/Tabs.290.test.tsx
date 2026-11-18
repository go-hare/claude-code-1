import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('2.1.290 #38 Tabs blurHeader(target?) + useFocusReclaim callers', () => {
  test('Tabs.tsx blurHeader accepts optional target and focuses it when provided', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'Tabs.tsx'), 'utf8');
    expect(src).toContain('blurHeader: (target?: DOMElement | null) => void;');
    expect(src).toContain('if (target) {');
    expect(src).toContain('focusManager?.focus(target);');
  });

  test('PermissionRuleList and AutoModeRulesTab pass containerRef.current to blurHeader', () => {
    const root = join(import.meta.dir, '../../../../../../src/components/permissions/rules');
    const ruleListSrc = readFileSync(join(root, 'PermissionRuleList.tsx'), 'utf8');
    const autoModeSrc = readFileSync(join(root, 'AutoModeRulesTab.tsx'), 'utf8');
    expect(ruleListSrc).toContain('blurHeader(containerRef.current)');
    expect(autoModeSrc).toContain('blurHeader(containerRef.current)');
  });
});

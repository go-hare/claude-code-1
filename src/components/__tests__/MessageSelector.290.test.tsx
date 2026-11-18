import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('2.1.290 #100 MessageSelector memoized UserMessageOption + time-sliced metadata', () => {
  test('UserMessageOption is memoized and loadFileHistoryMetadata uses AbortController + SLICE_MS', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'MessageSelector.tsx'), 'utf8');
    expect(src).toContain('const UserMessageOption = memo(function UserMessageOption(');
    expect(src).toContain('const controller = new AbortController();');
    expect(src).toContain('let deadline = performance.now() + SLICE_MS;');
    expect(src).toContain('if (performance.now() >= deadline)');
    expect(src).toContain('controller.abort();');
  });
});

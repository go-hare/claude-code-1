import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const searchBoxSrc = readFileSync(join(import.meta.dir, '../SearchBox.tsx'), 'utf8');
const useSearchInputSrc = readFileSync(join(import.meta.dir, '../../hooks/useSearchInput.ts'), 'utf8');

describe('SearchBox & useSearchInput 2.1.289 alignment', () => {
  test('SearchBox does not paint duplicate cursor when nativeCursor is active and highlights are passed', () => {
    expect(searchBoxSrc).toContain('!(nativeCursor && !mask && !fullRepaint && cursorChar === undefined)');
    expect(searchBoxSrc).not.toContain('highlights === undefined');
  });

  test('useSearchInput exposes external buffer sync and memoized willInsertNewline', () => {
    expect(useSearchInputSrc).toContain('export type SearchInputBuffer');
    expect(useSearchInputSrc).toContain('buffer.setQueryAndCursor');
    expect(useSearchInputSrc).toContain('willInsertNewline');
  });
});

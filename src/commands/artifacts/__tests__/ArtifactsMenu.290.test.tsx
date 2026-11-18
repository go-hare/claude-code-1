import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('2.1.290 #147 ArtifactsMenu exits on Enter when opening browser', () => {
  test('key.return calls openBrowser(target.url) and onExit()', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'ArtifactsMenu.tsx'), 'utf8');
    expect(src).toContain('void openBrowser(target.url);');
    expect(src).toContain('onExit();');
    const returnBlock = src.slice(src.indexOf('if (key.return)'), src.indexOf("if (input === 'c')"));
    expect(returnBlock).toContain('openBrowser(target.url)');
    expect(returnBlock).toContain('onExit()');
  });
});

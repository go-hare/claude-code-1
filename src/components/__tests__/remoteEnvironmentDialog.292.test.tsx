import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('RemoteEnvironmentDialog #222 default focus and check mark', () => {
  const srcPath = path.resolve(import.meta.dir, '../RemoteEnvironmentDialog.tsx');
  const src = fs.readFileSync(srcPath, 'utf8');

  test('derives defaultEnvironmentId only when selectedEnvironmentSource is non-null', () => {
    expect(src).toContain(
      'const defaultEnvironmentId = selectedEnvironmentSource ? selectedEnvironment.environment_id : undefined;',
    );
    expect(src).toContain("'None of these is your default'");
  });

  test('passes defaultFocusIndex matching defaultEnvironmentId to ItemList', () => {
    expect(src).toContain(
      'defaultFocusIndex={environments.findIndex(env => env.environment_id === defaultEnvironmentId)}',
    );
  });

  test('only renders success check icon when env matches defaultEnvironmentId', () => {
    expect(src).toContain('env.environment_id === defaultEnvironmentId ? (');
  });
});

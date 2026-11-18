import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('2.1.290 #117 Onboarding vXs existing sign-in check', () => {
  test('Onboarding.tsx defines hasExistingOnboardingSignIn and skips oauth step when signed in', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'Onboarding.tsx'), 'utf8');
    expect(src).toContain('export function hasExistingOnboardingSignIn()');
    expect(src).toContain("if (steps[nextIndex]?.id === 'oauth')");
    expect(src).toContain('skippedOAuth = hasExistingOnboardingSignIn()');
    expect(src).toContain("if (skippedOAuth && steps[i]?.id === 'oauth') continue;");
  });
});

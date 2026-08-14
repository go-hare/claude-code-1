/**
 * densable 2.1.232 #6 — GitLab token family redaction prefixes.
 */
import { describe, expect, test } from 'bun:test'
import { scanForSecrets } from '../secretScanner.js'

describe('densable 2.1.232 GitLab token families', () => {
  const cases: Array<{ id: string; sample: string }> = [
    { id: 'gitlab-pat', sample: 'glpat-abcdefghijklmnopqrst' },
    { id: 'gitlab-deploy-token', sample: 'gldt-abcdefghijklmnopqrst' },
    {
      id: 'gitlab-runner-authentication-token',
      sample: 'glrt-abcdefghijklmnopqrst',
    },
    { id: 'gitlab-oauth-app-secret', sample: 'gloas-abcdefghijklmnopqrst' },
    {
      id: 'gitlab-pipeline-trigger-token',
      sample: 'glptt-abcdefghijklmnopqrst',
    },
    {
      id: 'gitlab-kubernetes-agent-token',
      sample: 'glagent-abcdefghijklmnopqrst',
    },
    { id: 'gitlab-incoming-mail-token', sample: 'glimt-abcdefghijklmnopqrst' },
    { id: 'gitlab-scim-oauth-token', sample: 'glsoat-abcdefghijklmnopqrst' },
    { id: 'gitlab-ci-build-token', sample: 'glcbt-abcdefghijklmnopqrst' },
    { id: 'gitlab-feed-token', sample: 'glft-abcdefghijklmnopqrst' },
    {
      id: 'gitlab-feature-flag-client-token',
      sample: 'glffct-abcdefghijklmnopqrst',
    },
  ]

  for (const { id, sample } of cases) {
    test(`matches ${id}`, () => {
      const hits = scanForSecrets(`token=${sample} trailing`)
      expect(hits.map(h => h.ruleId)).toContain(id)
    })
  }
})

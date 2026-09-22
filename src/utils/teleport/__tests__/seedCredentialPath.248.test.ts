/**
 * densable 2.1.248 #30 — leftover `or`/`ar`/`rr`/`Ke` (local seed only).
 * Changelog prod.env / tfvars / id_rsa.swo / key.pem.tmp are consequences
 * of those callees, not SEA name literals.
 */
import { describe, expect, test } from 'bun:test'
import { isSeedCredentialPath } from '../seedCredentialPath.js'

describe('densable 2.1.248 #30 seedCredentialPath or/ar/Ke', () => {
  test('prod.env / *.tfvars / swap-tmp copies stay leftover; .ts does not', () => {
    expect(isSeedCredentialPath('prod.env')).toBe(true)
    expect(isSeedCredentialPath('foo.tfvars')).toBe(true)
    expect(isSeedCredentialPath('terraform.tfvars')).toBe(true)
    expect(isSeedCredentialPath('.env.example')).toBe(false)
    expect(isSeedCredentialPath('id_rsa.swo')).toBe(true)
    expect(isSeedCredentialPath('key.pem.tmp')).toBe(true)
    expect(isSeedCredentialPath('foo.ts')).toBe(false)
  })
})

/**
 * densable 2.1.251 #60 enterprise opus default — product-cut.
 * The resolver no longer has an enterprise arm.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('enterprise default opus product-cut (2.1.251 #60)', () => {
  test('enterpriseDefaultModel.ts is gone', () => {
    expect(
      existsSync(join(import.meta.dir, '../enterpriseDefaultModel.ts')),
    ).toBe(false)
  })

  test('the resolver does not call the enterprise arm', () => {
    const modelSrc = readFileSync(join(import.meta.dir, '../model.ts'), 'utf8')
    expect(modelSrc).not.toContain('isEnterpriseOpusDefault()')
    expect(modelSrc).not.toContain('enterpriseDefaultModel')
    expect(modelSrc).not.toContain('seat-based')
    const setting = modelSrc.slice(
      modelSrc.indexOf('function getDefaultMainLoopModelSetting'),
      modelSrc.indexOf('function getDefaultMainLoopModel():'),
    )
    expect(setting).not.toContain('isEnterpriseOpusDefault()')
  })
})

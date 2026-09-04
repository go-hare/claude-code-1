import { afterEach, describe, expect, test } from 'bun:test'
import { AUTO_MODE_CLASSIFIER_BETA_HEADER } from '../../../constants/betas.js'
import {
  autoModeClassifierExtraBetas,
  clearClassifierBetaLatchForTests,
  dropRejectedAutoModeClassifierBeta,
} from '../classifierBetaLatch.js'
import type { SideQueryOptions } from '../../sideQuery.js'

afterEach(() => {
  clearClassifierBetaLatchForTests()
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  delete process.env.CLAUDE_CODE_HIPAA
  delete process.env.CLAUDE_CODE_HIPAA_COMPLIANCE
})

function opts(extraBetas?: string[]): SideQueryOptions {
  return {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'x' }],
    querySource: 'auto_mode',
    extraBetas,
  }
}

describe('densable 2.1.243 #14 p$s / bzr', () => {
  test('p$s is inert because official ASe/$O is null', () => {
    const err = Object.assign(new Error('bad beta'), { status: 400 })
    expect(
      dropRejectedAutoModeClassifierBeta(
        err,
        opts([AUTO_MODE_CLASSIFIER_BETA_HEADER]),
      ),
    ).toBeNull()
  })

  test('bzr is empty when experimental betas are disabled', () => {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
    expect(autoModeClassifierExtraBetas('firstParty')).toEqual([])
  })

  test('bzr is empty on non-firstParty', () => {
    expect(autoModeClassifierExtraBetas('bedrock')).toEqual([])
    expect(autoModeClassifierExtraBetas('foundry')).toEqual([])
  })

  test('bzr attaches VO header on firstParty + hh + td', () => {
    delete process.env.ANTHROPIC_BASE_URL
    delete process.env.CLAUDE_CODE_HIPAA
    delete process.env.CLAUDE_CODE_HIPAA_COMPLIANCE
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    expect(autoModeClassifierExtraBetas('firstParty')).toEqual([
      AUTO_MODE_CLASSIFIER_BETA_HEADER,
    ])
  })
})

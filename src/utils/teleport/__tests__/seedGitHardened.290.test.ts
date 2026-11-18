import { describe, expect, test } from 'bun:test'
import '../seedGitLayout.js'
import { SEED_GIT_HARDENED_C } from '../seedGitHardened.js'

describe('seedGitHardened v2.1.290 (#35 core.safecrlf=false)', () => {
  test('SEED_GIT_HARDENED_C includes core.safecrlf=false and pack/replace hardening flags', () => {
    expect(SEED_GIT_HARDENED_C).toEqual([
      '-c',
      'submodule.recurse=false',
      '-c',
      'core.safecrlf=false',
      '-c',
      'core.commitGraph=false',
      '-c',
      'core.multiPackIndex=false',
      '-c',
      'pack.useBitmaps=false',
      '-c',
      'pack.readReverseIndex=false',
      '-c',
      'core.useReplaceRefs=false',
    ])
  })
})

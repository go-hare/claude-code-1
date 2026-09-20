/**
 * densable 2.1.247 #29 — FilePathLink uses FE / d(a) instead of raw
 * pathToFileURL. Gold: gold-29-d-full.txt, gold-29-helper-*.txt
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { toSafeFileUrl } from '../../utils/markdownFileUrl.js'
import { isLinkableAbsolutePath } from '../FilePathLink.js'

function filePathLinkUrl(filePath: string): string | null {
  if (!isLinkableAbsolutePath(filePath)) return null
  return toSafeFileUrl(filePath)
}

describe('densable 2.1.247 #29 FilePathLink FE gate', () => {
  test('safe absolute local path is a file URL', () => {
    const p = join(process.cwd(), 'README.md')
    expect(filePathLinkUrl(p)).toBe(pathToFileURL(p).href)
  })

  test('network UNC is not a hyperlink', () => {
    expect(filePathLinkUrl('//server/share/f')).toBeNull()
    expect(filePathLinkUrl('\\\\server\\share\\f')).toBeNull()
  })

  test('control char path is not a hyperlink', () => {
    expect(filePathLinkUrl(join(process.cwd(), 'x\x01y'))).toBeNull()
  })

  test('relative path stays plain (Ucs) before FE', () => {
    expect(isLinkableAbsolutePath('src/index.ts')).toBe(false)
    expect(filePathLinkUrl('src/index.ts')).toBeNull()
  })
})

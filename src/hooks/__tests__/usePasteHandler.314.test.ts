import { describe, expect, test } from 'bun:test'
import { splitPastedLinesForImages } from '../usePasteHandler.js'

describe('#1253 splitPastedLinesForImages S0t guard', () => {
  test('does not split prose lines containing a slash path into image paths', () => {
    const { lines, imagePaths } = splitPastedLinesForImages(
      'please check /tmp/example.png for details',
    )
    expect(lines).toEqual(['please check /tmp/example.png for details'])
    expect(imagePaths).toEqual([])
  })

  test('splits space-separated image paths when all tokens are valid paths', () => {
    const { lines, imagePaths } = splitPastedLinesForImages(
      '/tmp/first.png /tmp/second.jpg',
    )
    expect(lines).toEqual(['/tmp/first.png', '/tmp/second.jpg'])
    expect(imagePaths).toEqual(['/tmp/first.png', '/tmp/second.jpg'])
  })

  test('splits quoted paths with spaces when all tokens are valid quoted paths', () => {
    const { lines, imagePaths } = splitPastedLinesForImages(
      "'/tmp/my screen.png' '/tmp/other.webp'",
    )
    expect(lines).toEqual(["'/tmp/my screen.png'", "'/tmp/other.webp'"])
    expect(imagePaths).toEqual(["'/tmp/my screen.png'", "'/tmp/other.webp'"])
  })
})

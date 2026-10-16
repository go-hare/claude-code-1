import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', 'TaskCreateTool.ts'), 'utf-8')

describe('densable 2.1.289 TaskCreate pr concurrency', () => {
  test('isConcurrencySafe is false (gold return!1)', () => {
    expect(src).toMatch(/isConcurrencySafe\(\)\s*\{\s*return false/)
    expect(src).not.toMatch(/isConcurrencySafe\(\)\s*\{\s*return true/)
  })
})

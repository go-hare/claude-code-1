/**
 * Local DX: flatten Zod invalid_union so Artifact-style anyOf dumps
 * become a missing-required message instead of a 20-arm JSON blob.
 * Official oW6 does not do this — leftover, not a 251 gold arm.
 */
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { formatZodValidationError } from '../toolErrors.js'

const artifactLike = z.union([
  z.strictObject({
    file_path: z.string(),
    ttl: z.union([z.literal(7), z.literal(30)]).default(7),
  }),
  z.strictObject({
    action: z.literal('list'),
    limit: z.number().int().optional(),
  }),
  z.strictObject({
    action: z.literal('read'),
    url: z.string(),
  }),
])

describe('formatZodValidationError union flatten', () => {
  test('empty object on upload|action union reports missing file_path, not invalid_union dump', () => {
    const parsed = artifactLike.safeParse({})
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const msg = formatZodValidationError('Artifact', parsed.error)
    expect(msg).toContain('file_path')
    expect(msg).toContain('missing')
    expect(msg).not.toContain('invalid_union')
    expect(msg.length).toBeLessThan(400)
  })

  test('action=read without url reports missing url', () => {
    const parsed = artifactLike.safeParse({ action: 'read' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const msg = formatZodValidationError('Artifact', parsed.error)
    expect(msg).toContain('url')
    expect(msg).not.toContain('invalid_union')
  })

  test('plain object still reports a missing required field', () => {
    const schema = z.strictObject({ name: z.string() })
    const parsed = schema.safeParse({})
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const msg = formatZodValidationError('Demo', parsed.error)
    expect(msg).toContain('The required parameter `name` is missing')
  })
})

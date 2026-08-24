/**
 * densable 2.1.234 #18 / #40 — `/permissions` is immediate local-jsx.
 *
 * SEA DWS: {type:"local-jsx",name:"permissions",aliases:["allowed-tools"],
 *   description:"Manage allow and deny tool permission rules",immediate:!0}
 *
 * immediate:!0 enables mid-turn open (#40) and, with REPL localJSXCommandRef,
 * prevents `!` bash finally { setToolJSX(null) } from dismissing the panel (#18).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('/permissions densable 2.1.234 immediate', () => {
  test('index exports immediate local-jsx Command (SEA DWS 1:1)', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.name).toBe('permissions')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.aliases).toContain('allowed-tools')
    expect(cmd.description).toBe('Manage allow and deny tool permission rules')
    expect(cmd.immediate).toBe(true)
    expect(typeof cmd.load).toBe('function')
  })

  test('processBashCommand finally still uses bare setToolJSX(null)', () => {
    // densable keeps bare null clear; protection is localJSXCommandRef, not a
    // new finish≠dismiss API. Regress if someone invents clearLocalJSX here.
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../utils/processUserInput/processBashCommand.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('setToolJSX(null)')
    expect(src).not.toMatch(/finally\s*\{[^}]*clearLocalJSX/s)
  })

  test('REPL setToolJSX preserves localJSX against bare null', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../screens/REPL.tsx'),
      'utf8',
    )
    expect(src).toContain('localJSXCommandRef')
    expect(src).toContain('clearLocalJSX')
    expect(src).toContain('isLocalJSXCommand')
  })
})

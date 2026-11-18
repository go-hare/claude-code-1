import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { classifyPluginDirCollection } from '../pluginLoader.js'
import { pruneSyncedTrash } from '../syncedPluginSyncFs.js'

describe('#1265 --plugin-dir with empty .mcp.json at top', () => {
  test('treats folder with 0-byte .mcp.json as a collection of child plugins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plugin-dir-empty-mcp-'))
    try {
      writeFileSync(join(root, '.mcp.json'), '')
      mkdirSync(join(root, 'child-a', '.claude-plugin'), { recursive: true })
      writeFileSync(
        join(root, 'child-a', '.claude-plugin', 'plugin.json'),
        '{"name":"child-a"}',
      )

      const classified = await classifyPluginDirCollection(root)
      expect(classified.kind).toBe('collection')
      if (classified.kind === 'collection') {
        expect(classified.children).toEqual(['child-a'])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('treats folder with non-empty .mcp.json as a single plugin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'plugin-dir-nonempty-mcp-'))
    try {
      writeFileSync(join(root, '.mcp.json'), '{"mcpServers":{}}')
      const classified = await classifyPluginDirCollection(root)
      expect(classified).toEqual({ kind: 'plugin', marker: '.mcp.json' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('#1419 synced .trash bounded to ~1024 entries', () => {
  test('pruneSyncedTrash evicts oldest entries beyond maxEntries', async () => {
    const trashRoot = mkdtempSync(join(tmpdir(), 'synced-trash-prune-'))
    try {
      const oldTs = Date.now() - 10 * 24 * 60 * 60 * 1000
      for (let i = 0; i < 6; i++) {
        const key = i.toString(16).padStart(32, '0')
        const dirName = `${oldTs + i}-1234-${key}-x`
        mkdirSync(join(trashRoot, dirName))
      }
      const res = await pruneSyncedTrash(trashRoot, undefined, 3)
      expect(res.removed).toBe(3)
      expect(res.errors).toBe(0)
    } finally {
      rmSync(trashRoot, { recursive: true, force: true })
    }
  })
})

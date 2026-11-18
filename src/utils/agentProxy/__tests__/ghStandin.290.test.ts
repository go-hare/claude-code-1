import { describe, expect, test } from 'bun:test'
import {
  buildGhApiFields,
  buildGhStandinNoteTag,
  fieldsMapToObject,
  fieldsMapToQueryPairs,
  formatGhStandinNote,
  parseGhStandinArgs,
} from '../ghStandin.js'

describe('v2.1.290 #161: built-in gh api stand-in', () => {
  test('buildGhStandinNoteTag & formatGhStandinNote', () => {
    const tag = buildGhStandinNoteTag({ enterprise: true, noJq: true })
    expect(tag).toBe('builtin-api+enterprise+no-jq')
    const note = formatGhStandinNote(tag)
    expect(note).toContain('`gh api <REST endpoint>` works against github.com')
    expect(note).toContain('--jq` is unavailable')
    expect(formatGhStandinNote('other')).toBeUndefined()
  })

  test('parseGhStandinArgs parses gh api endpoint and flags', () => {
    const parsed = parseGhStandinArgs([
      'api',
      '-X',
      'POST',
      '-f',
      'title=Hello',
      '-F',
      'draft=true',
      'repos/{owner}/{repo}/pulls',
    ])
    expect(parsed.kind).toBe('api')
    if (parsed.kind === 'api') {
      expect(parsed.options.method).toBe('POST')
      expect(parsed.options.rawFields).toEqual(['title=Hello'])
      expect(parsed.options.typedFields).toEqual(['draft=true'])
      expect(parsed.options.endpoint).toBe('repos/{owner}/{repo}/pulls')
    }

    const paginatedGet = parseGhStandinArgs([
      'api',
      '--paginate',
      'repos/{owner}/{repo}/pulls',
    ])
    expect(paginatedGet.kind).toBe('api')
    if (paginatedGet.kind === 'api') {
      expect(paginatedGet.options.paginate).toBe(true)
    }

    const invalidPaginatedPost = parseGhStandinArgs([
      'api',
      '-X',
      'POST',
      '--paginate',
      'repos/{owner}/{repo}/pulls',
    ])
    expect(invalidPaginatedPost.kind).toBe('refuse')
  })

  test('parseGhStandinArgs refuses non-api gh commands', () => {
    const res = parseGhStandinArgs(['pr', 'view', '123'])
    expect(res.kind).toBe('refuse')
    if (res.kind === 'refuse') {
      expect(res.message).toContain('`gh api <REST endpoint>` works here')
    }
  })

  test('buildGhApiFields builds nested objects and arrays', async () => {
    const map = await buildGhApiFields(
      ['title=Hi', 'labels[]=bug', 'labels[]=p1'],
      ['draft=true', 'count=42', 'meta[active]=false'],
    )
    expect(fieldsMapToObject(map)).toEqual({
      title: 'Hi',
      labels: ['bug', 'p1'],
      draft: true,
      count: 42,
      meta: { active: false },
    })
    expect(fieldsMapToQueryPairs(map)).toContainEqual(['labels[]', 'bug'])
    expect(fieldsMapToQueryPairs(map)).toContainEqual(['meta[active]', 'false'])
  })
})

import { describe, expect, test } from 'bun:test'
import { createAgentId } from 'src/utils/uuid.js'
import {
  isReservedSpawnAgentName,
  normalizeSpawnAgentName,
} from '../constants.js'

describe('densable 2.1.289 uO spawn name reserve', () => {
  test('Dr NFKC lower spaces-to-hyphen', () => {
    expect(normalizeSpawnAgentName('  Team Lead  ')).toBe('team-lead')
    expect(normalizeSpawnAgentName('USER')).toBe('user')
  })

  test('uO refuses main team-lead user system any spelling', () => {
    expect(isReservedSpawnAgentName('main')).toBe(true)
    expect(isReservedSpawnAgentName('team-lead')).toBe(true)
    expect(isReservedSpawnAgentName('USER')).toBe(true)
    expect(isReservedSpawnAgentName('System')).toBe(true)
    expect(isReservedSpawnAgentName('researcher')).toBe(false)
  })

  test('uO refuses agent-id shape (OA)', () => {
    expect(isReservedSpawnAgentName(createAgentId())).toBe(true)
    expect(isReservedSpawnAgentName(createAgentId('compact'))).toBe(true)
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import {
  _getEventLoopStallStatsForTesting,
  _stopEventLoopStallDetectorForTesting,
  sampleCpuAndPageFaults,
  sampleRss,
  startEventLoopStallDetector,
} from '../eventLoopStallDetector.js'

afterEach(() => {
  _stopEventLoopStallDetectorForTesting()
})

describe('eventLoopStallDetector densable 2.1.217', () => {
  test('sampleCpuAndPageFaults returns numbers or null', () => {
    const s = sampleCpuAndPageFaults()
    if (s) {
      expect(typeof s.cpuTimeMs).toBe('number')
      expect(typeof s.majorPageFaults).toBe('number')
    }
  })

  test('sampleRss returns mb numbers or null', () => {
    const s = sampleRss()
    if (s) {
      expect(typeof s.rss_mb).toBe('number')
      expect(typeof s.heap_used_mb).toBe('number')
      expect(typeof s.ext_mb).toBe('number')
    }
  })

  test('startEventLoopStallDetector is idempotent and unrefed', () => {
    startEventLoopStallDetector()
    startEventLoopStallDetector()
    const stats = _getEventLoopStallStatsForTesting()
    expect(stats.running).toBe(true)
    expect(stats.totalStalls).toBe(0)
  })
})

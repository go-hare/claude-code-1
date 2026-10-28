/**
 * densable 2.1.289 Ke classifier latches (nte / C5t / UPn / Yio / tao / Qio / jPn).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  areThreadsHeldForServerClassifier,
  clearAutoModeUnavailableResponses,
  clearServerClassifierFallbackChoice,
  countAutoModeUnavailableResponsesInARow,
  getAutoModeUnavailableResponse,
  getAutoModeUnavailableStopNotice,
  getObservedGateway,
  getServerClassifierFallbackChoice,
  isThirdPartyServerClassifierRefused,
  markThirdPartyServerClassifierRefused,
  markThreadsHeldForServerClassifier,
  noteAutoModeUnavailableResponse,
  noteObservedGateway,
  resetRequestLatches,
  setAutoModeUnavailableStopNotice,
  setServerClassifierFallbackChoice,
  takeServerClassifierFallbackAnnouncement,
} from '../../bootstrap/state.js'

afterEach(() => {
  resetRequestLatches()
})

describe('RequestLatches server-classifier 289', () => {
  test('markThirdPartyServerClassifierRefused is one-way true; reset returns false', () => {
    expect(isThirdPartyServerClassifierRefused()).toBe(false)
    markThirdPartyServerClassifierRefused()
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
    markThirdPartyServerClassifierRefused()
    expect(isThirdPartyServerClassifierRefused()).toBe(true)
    resetRequestLatches()
    expect(isThirdPartyServerClassifierRefused()).toBe(false)
  })

  test('markThreadsHeldForServerClassifier is one-way; reset clears it', () => {
    expect(areThreadsHeldForServerClassifier()).toBe(false)
    markThreadsHeldForServerClassifier()
    expect(areThreadsHeldForServerClassifier()).toBe(true)
    resetRequestLatches()
    expect(areThreadsHeldForServerClassifier()).toBe(false)
  })

  test('autoModeUnavailableResponsesInARow counts only matching runKey', () => {
    const waited = Promise.resolve(true)
    noteAutoModeUnavailableResponse('a', {
      runKey: 'main',
      position: 1,
      waited,
    })
    noteAutoModeUnavailableResponse('b', {
      runKey: 'main',
      position: 2,
      waited,
    })
    noteAutoModeUnavailableResponse('c', {
      runKey: 'agent-1',
      position: 1,
      waited,
    })
    expect(countAutoModeUnavailableResponsesInARow('main')).toBe(2)
    expect(countAutoModeUnavailableResponsesInARow('agent-1')).toBe(1)
    expect(countAutoModeUnavailableResponsesInARow('other')).toBe(0)
  })

  test('note then get by request key; clear deletes only that runKey', () => {
    const req = { key: 'req-1' }
    const waited = Promise.resolve(true)
    noteAutoModeUnavailableResponse(req, {
      runKey: 'main',
      position: 3,
      waited,
    })
    noteAutoModeUnavailableResponse('other', {
      runKey: 'agent-1',
      position: 1,
      waited,
    })
    expect(getAutoModeUnavailableResponse(req)).toEqual({
      runKey: 'main',
      position: 3,
      waited,
    })
    clearAutoModeUnavailableResponses('main')
    expect(getAutoModeUnavailableResponse(req)).toBeUndefined()
    expect(getAutoModeUnavailableResponse('other')?.runKey).toBe('agent-1')
  })

  test('set/get AutoModeUnavailableStopNotice; reset sets undefined', () => {
    expect(getAutoModeUnavailableStopNotice()).toBeUndefined()
    setAutoModeUnavailableStopNotice('stopped')
    expect(getAutoModeUnavailableStopNotice()).toBe('stopped')
    resetRequestLatches()
    expect(getAutoModeUnavailableStopNotice()).toBeUndefined()
  })

  test('takeServerClassifierFallbackAnnouncement is false until refused, then true once', () => {
    expect(takeServerClassifierFallbackAnnouncement()).toBe(false)
    markThirdPartyServerClassifierRefused()
    expect(takeServerClassifierFallbackAnnouncement()).toBe(true)
    expect(takeServerClassifierFallbackAnnouncement()).toBe(false)
    expect(takeServerClassifierFallbackAnnouncement()).toBe(false)
  })

  test('noteObservedGateway first write wins', () => {
    expect(getObservedGateway()).toBeUndefined()
    noteObservedGateway('litellm')
    noteObservedGateway('kong')
    expect(getObservedGateway()).toBe('litellm')
    resetRequestLatches()
    expect(getObservedGateway()).toBeUndefined()
  })

  test('serverClassifierFallbackChoice get/set/clear; reset clears', async () => {
    expect(getServerClassifierFallbackChoice()).toBeUndefined()
    const choice = Promise.resolve('continue' as const)
    setServerClassifierFallbackChoice(choice)
    expect(getServerClassifierFallbackChoice()).toBe(choice)
    expect(await getServerClassifierFallbackChoice()).toBe('continue')
    clearServerClassifierFallbackChoice()
    expect(getServerClassifierFallbackChoice()).toBeUndefined()
    setServerClassifierFallbackChoice(Promise.resolve('interrupt'))
    resetRequestLatches()
    expect(getServerClassifierFallbackChoice()).toBeUndefined()
  })
})

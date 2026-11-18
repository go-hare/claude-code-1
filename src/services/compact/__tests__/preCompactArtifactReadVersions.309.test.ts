import { describe, expect, test } from 'bun:test'
import {
  attachPreCompactArtifactReadVersions,
  collectPreCompactArtifactReadVersions,
} from '../compact.js'
import { createCompactBoundaryMessage } from '../../../utils/messages.js'
import { asAgentId } from '../../../types/ids.js'

describe('2.1.309 #1153 preCompactArtifactReadVersions in compactMetadata', () => {
  test('collects main-observed artifactReadVersions in reverse order capped at 256', () => {
    const versions: Record<string, string> = {
      a: 'v1',
      b: 'v2',
      subOnly: 'v3',
      mainAndSub: 'v4',
    }
    const collected = collectPreCompactArtifactReadVersions({
      artifactReadVersions: versions,
      artifactReadObservers: {
        subOnly: { subagent: 'x' },
        mainAndSub: { main: '', subagent: 'x' },
      },
    })
    expect(collected).toEqual([
      { slug: 'mainAndSub', ver: 'v4' },
      { slug: 'b', ver: 'v2' },
      { slug: 'a', ver: 'v1' },
    ])
  })

  test('attachPreCompactArtifactReadVersions writes only for main agent (agentId === undefined)', () => {
    const boundaryMain = createCompactBoundaryMessage('auto', 1000)
    attachPreCompactArtifactReadVersions(boundaryMain, undefined, {
      artifactReadVersions: { doc: 'v5' },
    })
    expect(boundaryMain.compactMetadata.preCompactArtifactReadVersions).toEqual(
      [{ slug: 'doc', ver: 'v5' }],
    )

    const boundarySub = createCompactBoundaryMessage('auto', 1000)
    attachPreCompactArtifactReadVersions(boundarySub, asAgentId('subagent-1'), {
      artifactReadVersions: { doc: 'v5' },
    })
    expect(
      boundarySub.compactMetadata.preCompactArtifactReadVersions,
    ).toBeUndefined()
  })
})

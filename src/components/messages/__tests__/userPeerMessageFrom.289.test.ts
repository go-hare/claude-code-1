import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isInSessionPeerOrObserverOrigin,
  isPeerInboundExpandClickable,
  looksLikeAgentMessageEnvelope,
  peerOrObserverDisplayName,
  shouldPaintAgentInboundRow,
} from '../../../utils/messages.js'
import {
  agentMessageBodyFits,
  agentMessageOverflow,
  frameHandbackReport,
  indentHandbackReport,
  parseAgentMessageFromAttr,
  stripAgentMessageEnvelope,
  stripHandbackReportFrame,
  SUBAGENT_HANDBACK_REPORT_MARKER,
} from '../../../utils/crossSessionMessage.js'

describe('densable 2.1.289 Fg/zX Message from @agent', () => {
  test('uM: peer+senderTaskId or observer; bare peer false', () => {
    expect(
      isInSessionPeerOrObserverOrigin({
        kind: 'peer',
        senderTaskId: 'a-1',
      }),
    ).toBe(true)
    expect(
      isInSessionPeerOrObserverOrigin({ kind: 'peer', senderTaskId: 1 }),
    ).toBe(true)
    expect(isInSessionPeerOrObserverOrigin({ kind: 'peer' })).toBe(false)
    expect(isInSessionPeerOrObserverOrigin({ kind: 'observer' })).toBe(true)
    expect(isInSessionPeerOrObserverOrigin({ kind: 'channel' })).toBe(false)
    expect(isInSessionPeerOrObserverOrigin(undefined)).toBe(false)
  })

  test('BCn: peer.name || from', () => {
    expect(
      peerOrObserverDisplayName({
        kind: 'peer',
        name: 'general-purpose',
        from: 'agent-id',
      }),
    ).toBe('general-purpose')
    expect(peerOrObserverDisplayName({ kind: 'peer', from: 'agent-id' })).toBe(
      'agent-id',
    )
    expect(
      peerOrObserverDisplayName({ kind: 'observer', from: 'observer:explore' }),
    ).toBe('observer:explore')
  })

  test('jg strips agent-message envelope', () => {
    expect(
      stripAgentMessageEnvelope(
        '<agent-message from="general-purpose">\nworker done\n</agent-message>',
      ),
    ).toBe('worker done')
  })

  test('Message.tsx paints Wr on queued_command + uM(origin)', () => {
    const src = readFileSync(join(import.meta.dir, '../../Message.tsx'), 'utf8')
    expect(src).toContain("att.type === 'queued_command'")
    expect(src).toContain('shouldPaintAgentInboundRow(att.origin, promptText)')
    expect(src).toContain('peerOrObserverDisplayName(att.origin)')
    expect(src).toContain('fallbackLabel="agent"')
    expect(src).toContain("originKind === 'peer'")
    expect(src).not.toContain('export function uM(')
    expect(src).not.toContain('export function BCn(')
    expect(src).not.toContain('export function Wr(')
  })

  test('async agent allowlist keeps SendMessage so Explore can enqueue Wr', async () => {
    const { ASYNC_AGENT_ALLOWED_TOOLS } = await import(
      '../../../constants/tools.js'
    )
    const { SEND_MESSAGE_TOOL_NAME } = await import(
      '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
    )
    const { SUBAGENT_HANDBACK_TOOL_NAME } = await import(
      '@claude-code/builtin-tools/tools/SubagentHandbackTool/constants.js'
    )
    expect(ASYNC_AGENT_ALLOWED_TOOLS.has(SEND_MESSAGE_TOOL_NAME)).toBe(true)
    expect(ASYNC_AGENT_ALLOWED_TOOLS.has(SUBAGENT_HANDBACK_TOOL_NAME)).toBe(
      true,
    )
  })

  test('Image 34 producer is SubagentHandback, not Explore SendMessage-to-main', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('handbackOptIn: !isForkPath')
    expect(src).toContain('handbackTool: SubagentHandbackTool')
    expect(src).not.toContain('export function qw')
  })

  test('SendMessage has no alwaysLoad (gold 2.1.289 cut)', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts',
      ),
      'utf8',
    )
    expect(src).not.toContain('alwaysLoad: true')
    expect(src).not.toContain('alwaysLoad: isAgentSwarmsEnabled()')
    expect(src).toContain('skipAttachments: true')
    expect(src).toContain("als?.agentType === 'subagent'")
  })

  test('UserTextMessage routes Wr via shouldPaintAgentInboundRow, not typeof senderTaskId', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserTextMessage.tsx'),
      'utf8',
    )
    expect(src).toContain('shouldPaintAgentInboundRow(origin, param.text)')
    expect(src).toContain('peerOrObserverDisplayName(origin)')
    expect(src).not.toContain('<agent-message')
    expect(src).toContain('fallbackLabel="agent"')
    expect(src).not.toContain("typeof origin.senderTaskId === 'string'")
  })

  test('first-frame fme envelope paints Wr without origin (no expand-then-collapse)', () => {
    const envelope =
      '<agent-message from="general-purpose">\n[Subagent hand-back] report\n</agent-message>'
    expect(looksLikeAgentMessageEnvelope(envelope)).toBe(true)
    expect(looksLikeAgentMessageEnvelope('hello')).toBe(false)
    expect(shouldPaintAgentInboundRow(undefined, envelope)).toBe(true)
    expect(shouldPaintAgentInboundRow({ kind: 'peer' }, envelope)).toBe(true)
    expect(shouldPaintAgentInboundRow(undefined, 'hello')).toBe(false)
    expect(
      isPeerInboundExpandClickable({
        type: 'attachment',
        attachment: { type: 'queued_command', prompt: envelope },
      }),
    ).toBe(true)
    expect(
      isPeerInboundExpandClickable({
        type: 'user',
        message: { content: [{ type: 'text', text: envelope }] },
      }),
    ).toBe(true)
  })

  test('collapsed agent copy is Message from @ without body preview', () => {
    const src = readFileSync(
      join(import.meta.dir, '../UserCrossSessionMessage.tsx'),
      'utf8',
    )
    const fg = readFileSync(
      join(import.meta.dir, '../AgentInboundMessage.tsx'),
      'utf8',
    )
    const zX = readFileSync(
      join(import.meta.dir, '../CollapsedPeerMessage.tsx'),
      'utf8',
    )
    const wg = readFileSync(
      join(import.meta.dir, '../AgentInboundOverflow.tsx'),
      'utf8',
    )
    expect(src).toContain("fallbackLabel === 'agent'")
    expect(src).toContain('isAgentFallback')
    expect(src).toContain('stripAgentMessageEnvelope')
    expect(src).toContain('sanitizeCrossSessionDisplayName')
    expect(src).toContain('parseAgentMessageFromAttr')
    expect(src).toContain('const qmExpanded = isTranscriptMode || verbose')
    expect(src).toContain('<AgentInboundMessage')
    expect(src).toContain('<CollapsedPeerMessage')
    expect(src).toContain('stripHandbackReportFrame')
    expect(src).toContain('PluginUserMessageSite')
    expect(src).not.toContain('inboundLike')
    expect(src).not.toContain('export function Wr(')
    expect(src).not.toContain('export function Fg(')
    expect(src).not.toContain('export function zX(')
    expect(fg).toContain('Message from {name}')
    expect(fg).toContain('<AgentInboundOverflow')
    expect(fg).not.toContain('export function Fg(')
    expect(zX).toContain("{' from @'}")
    expect(zX).toContain('formatPeerCollapseLabel')
    expect(zX).toContain('action="expand"')
    expect(zX).toContain('parens')
    expect(zX).not.toContain('export function zX(')
    expect(wg).toContain('agentMessageOverflow')
    expect(wg).not.toContain('export function Wg(')
  })

  test('Message.tsx forwards origin onto Wr for irr uncapped', () => {
    const src = readFileSync(join(import.meta.dir, '../../Message.tsx'), 'utf8')
    expect(src).toContain('origin={att.origin}')
  })

  test('jg strips envelope even with system-reminder wrap', () => {
    expect(
      stripAgentMessageEnvelope(
        '<system-reminder>\n<agent-message from="general-purpose">\nworker done\n</agent-message>\n</system-reminder>',
      ),
    ).toBe('worker done')
    expect(
      parseAgentMessageFromAttr(
        '<agent-message from="general-purpose">\nx\n</agent-message>',
      ),
    ).toBe('general-purpose')
  })

  test('tx: queued_command + uM is click-to-expand; bare prompt is not', () => {
    expect(
      isPeerInboundExpandClickable({
        type: 'attachment',
        attachment: {
          type: 'queued_command',
          prompt:
            '<agent-message from="Explore">\nExplore sub-agent test OK\n</agent-message>',
          origin: { kind: 'peer', senderTaskId: 'a-1', name: 'Explore' },
        },
      }),
    ).toBe(true)
    expect(
      isPeerInboundExpandClickable({
        type: 'user',
        origin: { kind: 'peer', senderTaskId: 'a-1' },
        message: {
          content: [
            {
              type: 'text',
              text: '<agent-message from="Explore">\nok\n</agent-message>',
            },
          ],
        },
      }),
    ).toBe(true)
    expect(
      isPeerInboundExpandClickable({
        type: 'attachment',
        attachment: { type: 'queued_command', prompt: 'human drain' },
      }),
    ).toBe(false)
    const src = readFileSync(
      join(import.meta.dir, '../../Messages.tsx'),
      'utf8',
    )
    expect(src).toContain('isPeerInboundExpandClickable')
    expect(src).not.toContain('export function tx(')
  })

  test('ua: short Image 34 body fits; long body overflows', () => {
    expect(agentMessageBodyFits('Explore sub-agent test OK', 80)).toBe(true)
    expect(agentMessageBodyFits('a\nb\nc\nd\ne', 80)).toBe(true)
    expect(agentMessageBodyFits('a\nb\nc\nd\ne\nf', 80)).toBe(false)
    expect(agentMessageOverflow('Explore sub-agent test OK', 80)).toBe(null)
    const overflow = agentMessageOverflow('a\nb\nc\nd\ne\nf', 80)
    expect(overflow).not.toBe(null)
    expect(overflow?.hiddenLines).toBeGreaterThan(0)
  })

  test('Jx peels djt handback frame; identity without marker', () => {
    expect(stripHandbackReportFrame('plain report')).toBe('plain report')
    const framed = `${SUBAGENT_HANDBACK_REPORT_MARKER}\n  line one\n  line two`
    expect(stripHandbackReportFrame(framed)).toBe('line one\nline two')
  })

  test('y7n frames report and Jx peels it round-trip', () => {
    expect(indentHandbackReport('a\nb')).toBe('  a\n  b')
    const framed = frameHandbackReport('line one\nline two')
    expect(framed.startsWith(`${SUBAGENT_HANDBACK_REPORT_MARKER}\n`)).toBe(true)
    expect(framed).toContain('\n  line one\n  line two')
    expect(stripHandbackReportFrame(framed)).toBe('line one\nline two')
  })

  test('Jx: notes above djt stay unindented; report after marker remains framed', () => {
    const note = indentHandbackReport(
      "SECURITY WARNING: auto mode blocked this subagent's report. Reason: x. The report follows; review the subagent's actions carefully before acting on it.",
    )
    const framed = frameHandbackReport('dump line')
    const joined = `${note}\n${framed}`
    // gold Jx: lw(notes) + blank + still-indented report (after marker)
    expect(stripHandbackReportFrame(joined)).toBe(
      `${note.slice(2)}\n\n  dump line`,
    )
  })
})

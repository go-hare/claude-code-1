import * as React from 'react';
import { BaseText, Box, Text, useTerminalSize } from '@anthropic/ink';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import {
  type EffortValue,
  getDisplayedEffortLevel,
  getEffortEnvOverride,
  getUltracodeEffortForModel,
} from '../../utils/effort.js';
import {
  type PanelPosition,
  CANCEL_MESSAGE,
  computeConfirmOutcome,
  getInitialCursor,
  getPanelPositionsForModel,
  moveLeft,
  moveRight,
} from './effortPanelState.js';
import { executeEffort } from '../../commands/effort/effort.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { useSetAppState } from '../../state/AppState.js';
import { useRippleFrame } from './useRippleFrame.js';
import {
  TRANSPARENT,
  RIPPLE_LAVENDER,
  RIPPLE_TEXT_ON_BG,
  type Overlay,
  type Segment,
  applyOverlaysToCells,
  cellsToSegments,
  computeRippleCells,
  fadeCells,
} from './rippleAnimation.js';

/**
 * 每档最小宽度（足够装下 'ultracode' 9 字符 + 居中留白）。
 * 当终端窄时使用此值，保证最低可读性。
 */
const MIN_SEGMENT = 12;

// densable help row (plain + ripple). densable 2.1.233 #15 — keep full hint
// visible (do not truncate mid-sentence for narrow panels).
const HELP_TEXT = '←/→ to adjust · Enter to confirm · Esc to cancel';

// 淡入淡出每帧步长：60ms 间隔下 5 帧达到目标 ≈ 300ms 动画时长。
const FADE_STEP = 0.2;

// 波纹震源 y 坐标（相对波纹区域坐标系，y=0 是档位名行）。
const RIPPLE_SOURCE_Y = 0;

/**
 * densable ultracode sublabel: "{wire} + workflows".
 * Wire follows catalog top tier (opus → xhigh, grok → high).
 */
function ultracodeSublabel(model: string): string {
  const wire = getUltracodeEffortForModel(model) ?? 'high';
  return `${wire} + workflows`;
}

/**
 * 根据终端宽度计算每档实际宽度（SEGMENT）。
 *
 * 规则：
 * - 留出 paddingX={1} 的左右各 1 列 → 可用宽度 = columns - 2
 * - 若可用宽度 <= MIN_SEGMENT * positionCount，用 MIN_SEGMENT（保持当前窄布局）
 * - 否则铺满：floor(可用宽度 / positionCount)
 *
 * 即"窄则不变，宽则铺满"。最小宽度保证 'ultracode' 9 字符能正常显示。
 */
function computeSegment(terminalColumns: number, positionCount: number): number {
  const available = terminalColumns - 2; // paddingX={1} 两侧
  const count = Math.max(1, positionCount);
  const minNeeded = MIN_SEGMENT * count;
  if (available <= minNeeded) return MIN_SEGMENT;
  return Math.floor(available / count);
}

/**
 * 计算波纹震源 x 坐标（ultracode 段内 'ultracode' 标签的中心列）。
 *
 * 'ultracode' 是 9 字符，在 SEGMENT 列内居中：
 *   offset = floor((SEGMENT - 9) / 2)
 *   labelCenter = SEGMENT * (n-1) + offset + 4
 */
function computeRippleSourceX(segment: number, positionCount: number): number {
  const LABEL_LEN = 9; // 'ultracode'
  const offset = Math.max(0, Math.floor((segment - LABEL_LEN) / 2));
  const labelCenter = Math.floor(LABEL_LEN / 2); // 4
  return segment * Math.max(0, positionCount - 1) + offset + labelCenter;
}

/**
 * 计算某段 idx 内居中文字的起始列。
 * 动态 segment：textLen 字符在 segment 列内居中。
 */
function segmentTextStartX(idx: number, textLen: number, segment: number): number {
  return segment * idx + Math.max(0, Math.floor((segment - textLen) / 2));
}

type Props = {
  appStateEffort: EffortValue | undefined;
  onDone: (message: string) => void;
};

export function EffortPanel({ appStateEffort, onDone }: Props): React.ReactNode {
  const setAppState = useSetAppState();
  const model = useMainLoopModel();
  const { columns } = useTerminalSize();

  // densable: only offer model-supported effort levels (+ ultracode slot).
  const positions = React.useMemo(() => getPanelPositionsForModel(model), [model]);
  const positionCount = positions.length;
  const sublabel = React.useMemo(() => ultracodeSublabel(model), [model]);

  // 自适应宽度：根据终端列数计算每档宽度。
  // 终端变化（resize）时 columns 改变 → 重新计算 → 重渲染。
  const segment = React.useMemo(() => computeSegment(columns, positionCount), [columns, positionCount]);
  const panelWidth = segment * positionCount;
  const rippleSourceX = React.useMemo(() => computeRippleSourceX(segment, positionCount), [segment, positionCount]);

  const envOverride = getEffortEnvOverride();
  const displayed = getDisplayedEffortLevel(model, appStateEffort);
  const initialCursor = getInitialCursor({
    envOverride,
    appStateEffort,
    displayed,
    positions,
  });

  const [cursor, setCursor] = React.useState<PanelPosition>(initialCursor);
  const [done, setDone] = React.useState(false);

  // If model changes mid-panel (rare), keep cursor on the filtered ladder.
  React.useEffect(() => {
    setCursor(c => (positions.includes(c) ? c : initialCursor));
  }, [positions, initialCursor]);

  const isOnUltracode = cursor === 'ultracode';
  const [fade, setFade] = React.useState(0);
  // 仍在波纹模式：cursor 在 ultracode，或退出动画未结束（fade > 0）
  const showingRipple = isOnUltracode || fade > 0.001;
  const [rippleRef, time] = useRippleFrame(showingRipple);

  // 淡入淡出驱动：每 tick（time 推进）朝目标步进 FADE_STEP。
  // 退出动画完成后 fade 归零，showingRipple 变 false，时钟停止订阅。
  React.useEffect(() => {
    if (!showingRipple) return;
    const target = isOnUltracode ? 1 : 0;
    setFade(prev => {
      if (prev === target) return prev;
      const next = target > prev ? prev + FADE_STEP : prev - FADE_STEP;
      return target > prev ? Math.min(target, next) : Math.max(target, next);
    });
  }, [time, isOnUltracode, showingRipple]);

  const handleConfirm = React.useCallback(() => {
    if (done) return;
    setDone(true);
    // Pass model so ultracode / unsupported levels follow catalog ladder.
    const outcome = computeConfirmOutcome(cursor, arg => executeEffort(arg, model));
    if (outcome.kind === 'apply' && outcome.effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: outcome.effortUpdate!.value,
        ultracode: outcome.effortUpdate!.ultracode ?? false,
      }));
    }
    onDone(outcome.message);
  }, [cursor, done, model, onDone, setAppState]);

  const handleCancel = React.useCallback(() => {
    if (done) return;
    setDone(true);
    onDone(CANCEL_MESSAGE);
  }, [done, onDone]);

  useKeybindings(
    {
      'effortPanel:decrease': () => setCursor(c => moveLeft(c, positions)),
      'effortPanel:increase': () => setCursor(c => moveRight(c, positions)),
      'effortPanel:home': () => setCursor(positions[0] ?? 'low'),
      'effortPanel:end': () => setCursor(positions[positions.length - 1] ?? 'ultracode'),
      'effortPanel:confirm': handleConfirm,
      'effortPanel:cancel': handleCancel,
    },
    { context: 'EffortPanel' },
  );

  const envActive = envOverride !== null && envOverride !== undefined;
  const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;

  // 波纹行 cells 计算：返回该行所有 cell（含 overlay 文字）
  // fade 控制背景颜色亮度（0 → 全 transparent，1 → 完整波纹）。
  // Overlay 不强制 fg 色：保留底层波纹色，RippleRow 按 densable
  // 「波上白字+紫底 / 波外淡紫字」渲染。
  const renderRippleRow = React.useCallback(
    (relY: number, overlays: Overlay[]): Segment[] => {
      const cells = computeRippleCells({
        y: relY + RIPPLE_SOURCE_Y,
        width: panelWidth,
        time,
        sourceX: rippleSourceX,
        sourceY: RIPPLE_SOURCE_Y,
      });
      const overlayed = applyOverlaysToCells(cells, overlays);
      const faded = fadeCells(overlayed, fade);
      return cellsToSegments(faded);
    },
    [time, fade, panelWidth, rippleSourceX],
  );

  return (
    <Box
      ref={rippleRef}
      flexDirection="column"
      paddingX={1}
      width={panelWidth + 2}
      // densable 2.1.233 #15 residual — screen-reader list of effort levels
      accessibility={{ role: 'list', label: 'Effort levels' }}
    >
      <Text bold color="suggestion">
        Effort
      </Text>
      {envActive && <Text color="warning">{`⚠ CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session`}</Text>}
      {showingRipple ? (
        <RippleContent
          renderRow={renderRippleRow}
          cursor={cursor}
          segment={segment}
          panelWidth={panelWidth}
          positions={positions}
          sublabel={sublabel}
        />
      ) : (
        <>
          <PlainContent
            cursor={cursor}
            segment={segment}
            panelWidth={panelWidth}
            positions={positions}
            sublabel={sublabel}
          />
          <Box marginTop={1} width={panelWidth} flexShrink={0}>
            <Text color="subtle" wrap="wrap">
              {HELP_TEXT}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

// ---- 普通模式（无波纹）----

function PlainContent({
  cursor,
  segment,
  panelWidth,
  positions,
  sublabel,
}: {
  cursor: PanelPosition;
  segment: number;
  panelWidth: number;
  positions: readonly PanelPosition[];
  sublabel: string;
}): React.ReactNode {
  return (
    <>
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Text color="suggestion">Faster</Text>
        <Text color="suggestion">Smarter</Text>
      </Box>
      <Text color="subtle">{'─'.repeat(panelWidth)}</Text>
      <Box flexDirection="row">
        {positions.map(p => (
          <Box key={`cursor-${p}`} width={segment} justifyContent="center">
            <Text bold color={cursor === p ? 'suggestion' : 'subtle'}>
              {cursor === p ? '▲' : ' '}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        {positions.map((p, i) => (
          <Box
            key={`label-${p}`}
            width={segment}
            justifyContent="center"
            accessibility={{
              role: 'listitem',
              label: `${i + 1}. ${p}${cursor === p ? ', selected' : ''}`,
            }}
          >
            <Text bold={cursor === p} color={cursor === p ? 'suggestion' : 'subtle'}>
              {p}
            </Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Box width={segment * Math.max(0, positions.length - 1)} />
        <Box width={segment} justifyContent="center">
          <Text color="subtle">{sublabel}</Text>
        </Box>
      </Box>
    </>
  );
}

// ---- 波纹模式（cursor === 'ultracode'）----
//
// densable Phr/DZs 紫阶波前：
// - 空格段：backgroundColor = 波纹紫（transparent 跳过）
// - 文字在波上：白字 + 紫底
// - 文字在波外：淡紫字无底
// Overlay 不写 color，保留底层波纹色供 RippleRow 判定。

type RippleContentProps = {
  renderRow: (relY: number, overlays: Overlay[]) => Segment[];
  cursor: PanelPosition;
  segment: number;
  panelWidth: number;
  positions: readonly PanelPosition[];
  sublabel: string;
};

function RippleContent({
  renderRow,
  cursor,
  segment,
  panelWidth,
  positions,
  sublabel,
}: RippleContentProps): React.ReactNode {
  // 光标索引跟随 cursor（退出动画期间 cursor 已移到别处，
  // 让 ▲ overlay 跟着移走，ultracode 段恢复普通背景色）。
  const cursorIdx = Math.max(0, positions.indexOf(cursor));
  // 副标签固定在 ultracode 段下方，不跟随光标移动。
  const ultracodeIdx = Math.max(0, positions.length - 1);

  // densable: overlays inherit ripple cell color (no forced blue/hue).
  const fasterOverlay: Overlay = { text: 'Faster', x: 0 };
  const smarterOverlay: Overlay = {
    text: 'Smarter',
    x: panelWidth - 'Smarter'.length,
  };
  const separatorOverlay: Overlay = {
    text: '─'.repeat(panelWidth),
    x: 0,
  };
  const cursorOverlay: Overlay = {
    text: '▲',
    x: segmentTextStartX(cursorIdx, 1, segment),
  };
  const labelOverlays: Overlay[] = positions.map((p, idx) => ({
    text: p,
    x: segmentTextStartX(idx, p.length, segment),
  }));
  const sublabelOverlay: Overlay = {
    text: sublabel,
    x: segmentTextStartX(ultracodeIdx, sublabel.length, segment),
  };

  // 各行 y 坐标（相对震源 RIPPLE_SOURCE_Y = 档位名行）
  //   y=-4: 顶部纯波纹行（视觉一致，无 overlay）
  //   y=-3: Faster/Smarter
  //   y=-2: 分隔线
  //   y=-1: ▲
  //   y=0:  档位名（震源）
  //   y=1:  副标签
  //   y=2:  底部纯波纹行（视觉一致，无 overlay）
  //
  // 快捷键行：plain Text，不参与波纹渲染（无背景动画），紧贴底部波纹行。
  return (
    <>
      <RippleRow segments={renderRow(-4, [])} />
      <RippleRow segments={renderRow(-3, [fasterOverlay, smarterOverlay])} />
      <RippleRow segments={renderRow(-2, [separatorOverlay])} />
      <RippleRow segments={renderRow(-1, [cursorOverlay])} />
      <RippleRow segments={renderRow(0, labelOverlays)} />
      <RippleRow segments={renderRow(1, [sublabelOverlay])} />
      <RippleRow segments={renderRow(2, [])} />
      <Text color={RIPPLE_LAVENDER as `#${string}`}>{HELP_TEXT}</Text>
    </>
  );
}

/**
 * 渲染一行波纹 segments（densable 白字紫底 / 波外淡紫）。
 *
 * 每个 segment 可能含空格 + 文字混合（如 "  Faster  "）：
 * - 空格部分用 backgroundColor 染色块（波纹紫）
 * - 文字在波上：白字 + 紫底
 * - 文字在波外（transparent）：淡紫字无底
 */
function RippleRow({ segments }: { segments: Segment[] }): React.ReactNode {
  const tokens: Array<{ text: string; kind: 'space' | 'text'; color: string }> = [];
  for (const seg of segments) {
    // 拆分 seg.text 为空格段和非空格段
    let buf = '';
    let bufIsSpace: boolean | null = null;
    const flush = (): void => {
      if (buf === '' || bufIsSpace === null) return;
      tokens.push({
        text: buf,
        kind: bufIsSpace ? 'space' : 'text',
        color: seg.color,
      });
      buf = '';
      bufIsSpace = null;
    };
    for (const ch of seg.text) {
      const isSpace = ch === ' ';
      if (bufIsSpace === null) {
        buf = ch;
        bufIsSpace = isSpace;
      } else if (isSpace === bufIsSpace) {
        buf += ch;
      } else {
        flush();
        buf = ch;
        bufIsSpace = isSpace;
      }
    }
    flush();
  }

  return (
    <Box flexDirection="row">
      {tokens.map((tok, i) => {
        if (tok.kind === 'space') {
          if (tok.color === TRANSPARENT) {
            return <BaseText key={i}>{tok.text}</BaseText>;
          }
          return (
            <BaseText key={i} backgroundColor={tok.color as `#${string}`}>
              {tok.text}
            </BaseText>
          );
        }
        // densable text: on-wave white+purple bg; off-wave lavender.
        if (tok.color === TRANSPARENT) {
          return (
            <Text key={i} color={RIPPLE_LAVENDER as `#${string}`} bold>
              {tok.text}
            </Text>
          );
        }
        return (
          <BaseText key={i} color={RIPPLE_TEXT_ON_BG as `#${string}`} backgroundColor={tok.color as `#${string}`} bold>
            {tok.text}
          </BaseText>
        );
      })}
    </Box>
  );
}

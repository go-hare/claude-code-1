import { Box, Text, useApp, type DOMElement } from '@anthropic/ink';
import {
  cloneElement,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { subscribeRenderInvalidation } from '../../utils/render/invalidateAllRenders.js';
import {
  evaluateUiRender,
  getLastUiRenderPlugin,
  hasMatchingFunctionHook,
  getPanesTerminalSize,
  subscribePanes,
  subscribeRasterFrames,
} from '../../utils/plugins/functionHooksModules.js';
import { logForDebugging } from '../../utils/debug.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { useNotifications } from '../../context/notifications.js';
import { getBootstrapSession, RootSessionSlot } from '../../utils/sessionRoot.js';
import { cleanPromptHintText, resolvePromptHintText } from '../PromptInput/PromptInputFooterSuggestions.js';
import {
  hasPluginDrawing,
  isEngineFallback,
  isG2eComponent,
  noteHeldRows,
  siteIsOff,
  useHeldSiteRows,
  useSiteMeasure,
} from '../../utils/plugins/pluginSiteHold.js';
import { StaticRenderContext } from '../../utils/staticRender.js';
import {
  extractDrawnPlugin,
  focusablesOfDrawing,
  isRecord,
  renderVersion,
  reportDrawWhileDrawn,
  snapshot,
} from './drawingHelpers.js';
import { PaneErrorBoundary } from './sessionStores.js';
import { DrawingNode, PluginSiteFieldsOwned, useRenderDrawing } from './drawingElements.js';

/**
 * Render an already-evaluated plugin `ui.render` tree with an `engine` slot
 * (`{ type: "engine", ref: 0 }`) and live `ui.blit` frame subscription.
 */
export function PluginRenderedTree({
  node,
  plugin,
  requestId,
  component,
  engine,
}: {
  node: unknown;
  plugin?: string;
  requestId?: string;
  component: string;
  engine?: ReactNode;
}): ReactNode {
  useSyncExternalStore(subscribeRasterFrames, snapshot, snapshot);
  const [resetKey, setResetKey] = useState(0);
  const [failedNode, setFailedNode] = useState<unknown>(undefined);
  const focusables = useMemo(() => focusablesOfDrawing(node), [node]);
  const owner = useMemo(
    () => extractDrawnPlugin(node, component, requestId) ?? (plugin || getLastUiRenderPlugin()),
    [node, component, requestId, plugin],
  );
  if (!hasPluginDrawing(node) || node === failedNode) return engine ?? null;
  const hasInteractiveFields = focusables.some(row => row.tag === 'Input' || row.tag === 'Select');
  const renderedBody = (
    <DrawingNode node={node} plugin={owner} requestId={requestId} index={0} engine={engine} component={component} />
  );
  return (
    <PaneErrorBoundary
      resetKey={resetKey}
      fallback={engine ?? null}
      onError={error => {
        logForDebugging(`ui.render (${component} ${requestId ?? ''}): draw failed: ${error.message}`, {
          level: 'error',
        });
        setFailedNode(() => node);
        setResetKey(n => n + 1);
      }}
    >
      {hasInteractiveFields ? (
        <PluginSiteFieldsOwned requestId={requestId} focusables={focusables}>
          {renderedBody}
        </PluginSiteFieldsOwned>
      ) : (
        renderedBody
      )}
    </PaneErrorBoundary>
  );
}

/**
 * densable 2.1.289 `Meo` — validate that an AskUserQuestion rewrite only
 * relabels question text/header (same count, same multiSelect, same option
 * labels/previews, unique question texts).
 */
export function askUserQuestionRewriteProblem(
  rewritten: readonly unknown[],
  original: readonly unknown[],
): string | undefined {
  if (rewritten.length !== original.length) {
    return `change how many questions there are (${original.length} asked, ${rewritten.length} drawn)`;
  }
  for (const [index, asked] of original.entries()) {
    const drawn = rewritten[index];
    if (drawn === undefined) return `leave question ${index + 1} out`;
    if (!isRecord(asked) || !isRecord(drawn)) return 'leave question schema invalid';
    if ((drawn.multiSelect ?? false) !== (asked.multiSelect ?? false)) {
      return `change whether question ${index + 1} is multi-select`;
    }
    const askedOpts = Array.isArray(asked.options) ? asked.options : [];
    const drawnOpts = Array.isArray(drawn.options) ? drawn.options : [];
    const askedLabels = askedOpts.map(o => (isRecord(o) ? o.label : undefined));
    const drawnLabels = drawnOpts.map(o => (isRecord(o) ? o.label : undefined));
    if (JSON.stringify(drawnLabels) !== JSON.stringify(askedLabels)) {
      return `change question ${index + 1}'s options (asked ${JSON.stringify(askedLabels)}, drawn ${JSON.stringify(drawnLabels)})`;
    }
    const askedPreviews = askedOpts.map(o => (isRecord(o) ? o.preview : undefined));
    const drawnPreviews = drawnOpts.map(o => (isRecord(o) ? o.preview : undefined));
    if (JSON.stringify(drawnPreviews) !== JSON.stringify(askedPreviews)) {
      return `change question ${index + 1}'s previews`;
    }
    const drawnText = drawn.question;
    const sameQuestion = (row: unknown, rowIndex: number): boolean =>
      rowIndex !== index && isRecord(row) && row.question === drawnText;
    const quoted = JSON.stringify(drawnText);
    if (rewritten.some(sameQuestion)) {
      return `give two questions one text (${quoted})`;
    }
    if (original.some(sameQuestion)) {
      return `give question ${index + 1} another question's text (${quoted})`;
    }
  }
  return undefined;
}

/**
 * densable 2.1.289 `YXe` — validate rewritten AskUserQuestion questions; fall
 * back to `original` with a warning log on schema/shape mismatch.
 */
export function validateAskUserQuestionRewrite(rewritten: unknown, original: readonly unknown[]): readonly unknown[] {
  if (rewritten === undefined || rewritten === original || JSON.stringify(rewritten) === JSON.stringify(original)) {
    return original;
  }
  if (
    !Array.isArray(rewritten) ||
    !rewritten.every(
      item =>
        isRecord(item) &&
        typeof item.question === 'string' &&
        item.question.length > 0 &&
        Array.isArray(item.options) &&
        item.options.every(opt => isRecord(opt) && typeof opt.label === 'string'),
    )
  ) {
    logForDebugging(
      `ui.render (AskUserQuestion): rewritten questions do not match the tool's input schema; drawing the original`,
      { level: 'warn' },
    );
    return original;
  }
  const problem = askUserQuestionRewriteProblem(rewritten, original);
  if (problem !== undefined) {
    logForDebugging(
      `ui.render (AskUserQuestion): a rewrite may relabel the questions but not ${problem}; drawing the original`,
      { level: 'warn' },
    );
    return original;
  }
  return rewritten;
}

/**
 * densable 2.1.289 `zXe` — map submitted answer/annotation keys from rewritten
 * question texts back to the original question texts.
 */
export type AskUserQuestionSubmission = {
  behavior?: string;
  updatedInput?: {
    answers?: Record<string, string>;
    annotations?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function restoreAskUserQuestionResult<T extends AskUserQuestionSubmission>(
  result: T,
  drawnQuestions: readonly unknown[],
  askedQuestions: readonly unknown[],
): T {
  if (result.behavior !== 'allow' || drawnQuestions === askedQuestions || result.updatedInput === undefined) {
    return result;
  }
  const remapRecord = <V,>(
    record: Record<string, V> | undefined,
    transform: (value: V, index: number) => V,
  ): Record<string, V> | undefined => {
    if (record === undefined) return undefined;
    const out: Record<string, V> = {};
    for (const [key, val] of Object.entries(record)) {
      const idx = drawnQuestions.findIndex(q => isRecord(q) && q.question === key);
      const orig = idx === -1 ? undefined : askedQuestions[idx];
      const origKey = isRecord(orig) && typeof orig.question === 'string' ? orig.question : key;
      out[origKey] = orig === undefined ? val : transform(val, idx);
    }
    return out;
  };
  const updatedInput = result.updatedInput;
  const answers = remapRecord(updatedInput.answers, (val, idx) => {
    const drawnQ = drawnQuestions[idx];
    const askedQ = askedQuestions[idx];
    const drawnOpts = isRecord(drawnQ) && Array.isArray(drawnQ.options) ? drawnQ.options : [];
    const askedOpts = isRecord(askedQ) && Array.isArray(askedQ.options) ? askedQ.options : [];
    const optIdx = drawnOpts.findIndex(o => isRecord(o) && o.label === val);
    if (optIdx === -1) return val;
    const origOpt = askedOpts[optIdx];
    return isRecord(origOpt) && typeof origOpt.label === 'string' ? origOpt.label : val;
  });
  const annotations = remapRecord(updatedInput.annotations, val => val);
  return {
    ...result,
    updatedInput: {
      ...updatedInput,
      ...(answers !== undefined && { answers }),
      ...(annotations !== undefined && { annotations }),
    },
  };
}

function remapAskedKeysToDrawn<V>(
  record: Record<string, V> | undefined,
  askedQuestions: readonly unknown[],
  drawnQuestions: readonly unknown[],
): Record<string, V> | undefined {
  if (record === undefined || drawnQuestions === askedQuestions) return record;
  const out: Record<string, V> = {};
  for (const [key, val] of Object.entries(record)) {
    const idx = askedQuestions.findIndex(q => isRecord(q) && q.question === key);
    const drawn = idx === -1 ? undefined : drawnQuestions[idx];
    const drawnKey = isRecord(drawn) && typeof drawn.question === 'string' ? drawn.question : key;
    out[drawnKey] = val;
  }
  return out;
}

function mapDrawnQuestionKeyToAsked(
  questionKey: string,
  drawnQuestions: readonly unknown[],
  askedQuestions: readonly unknown[],
): string {
  const idx = drawnQuestions.findIndex(q => isRecord(q) && q.question === questionKey);
  if (idx === -1) return questionKey;
  const orig = askedQuestions[idx];
  return isRecord(orig) && typeof orig.question === 'string' ? orig.question : questionKey;
}

function rewriteAskUserQuestionEngineChild(
  node: ReactNode,
  askedQuestions: readonly unknown[],
  drawnQuestions: readonly unknown[],
): ReactNode {
  if (drawnQuestions === askedQuestions || !isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const patches: Record<string, unknown> = {};
  if ('questions' in props && Array.isArray(props.questions)) {
    patches.questions = drawnQuestions;
    const idx = typeof props.currentQuestionIndex === 'number' ? props.currentQuestionIndex : 0;
    const drawnQ = drawnQuestions[idx];
    const askedQ = askedQuestions[idx];
    if ('question' in props && drawnQ !== undefined) {
      patches.question = drawnQ;
      if (
        isRecord(drawnQ) &&
        isRecord(askedQ) &&
        typeof drawnQ.question === 'string' &&
        drawnQ.question !== askedQ.question
      ) {
        patches.displayQuestion = drawnQ.question;
      }
    }
    if (isRecord(props.answers)) {
      patches.answers = remapAskedKeysToDrawn(props.answers as Record<string, unknown>, askedQuestions, drawnQuestions);
    }
    if (isRecord(props.questionStates)) {
      patches.questionStates = remapAskedKeysToDrawn(
        props.questionStates as Record<string, unknown>,
        askedQuestions,
        drawnQuestions,
      );
    }
    if (typeof props.onAnswer === 'function') {
      const origOnAnswer = props.onAnswer as (
        questionText: string,
        label: string | string[],
        textInput?: string,
        shouldAdvance?: boolean,
      ) => void;
      patches.onAnswer = (
        questionText: string,
        label: string | string[],
        textInput?: string,
        shouldAdvance?: boolean,
      ) => {
        origOnAnswer(
          mapDrawnQuestionKeyToAsked(questionText, drawnQuestions, askedQuestions),
          label,
          textInput,
          shouldAdvance,
        );
      };
    }
    if (typeof props.onUpdateQuestionState === 'function') {
      const origOnUpdate = props.onUpdateQuestionState as (
        questionText: string,
        updates: unknown,
        isTextInput?: boolean,
      ) => void;
      patches.onUpdateQuestionState = (questionText: string, updates: unknown, isTextInput?: boolean) => {
        origOnUpdate(mapDrawnQuestionKeyToAsked(questionText, drawnQuestions, askedQuestions), updates, isTextInput);
      };
    }
  }
  const rawChildren = props.children;
  let nextChildren = rawChildren;
  if (Array.isArray(rawChildren)) {
    nextChildren = rawChildren.map(child =>
      rewriteAskUserQuestionEngineChild(child as ReactNode, askedQuestions, drawnQuestions),
    );
  } else if (isValidElement(rawChildren)) {
    nextChildren = rewriteAskUserQuestionEngineChild(rawChildren, askedQuestions, drawnQuestions);
  }
  if (Object.keys(patches).length === 0 && nextChildren === rawChildren) {
    return node;
  }
  return cloneElement(element, patches, ...(nextChildren !== undefined ? [nextChildren as ReactNode] : []));
}

const ASK_USER_QUESTION_RICH_SURFACES = new Set(['desktop', 'vscode', 'mobile']);

/**
 * #885: SEA `C8s(surface)` — VS Code, desktop and mobile allow 48 rows + Markdown
 * above AskUserQuestion; terminal keeps 12 plain rows.
 */
export function getAskUserQuestionSurfacePolicy(surface?: string): {
  rowsMax: number;
  isMarkdownDrawn: boolean;
} {
  const isRich = surface !== undefined && ASK_USER_QUESTION_RICH_SURFACES.has(surface);
  return {
    rowsMax: isRich ? 48 : 12,
    isMarkdownDrawn: isRich,
  };
}

const ENGINE_CONFIRM_METADATA_SOURCES = new Set(['mod_hot_reload', 'plugin_authoring_hand_over_check']);

const registeredEngineConfirmRequestIdsBySession = new RootSessionSlot<Set<string>>(() => new Set<string>());

function getRegisteredEngineConfirmRequestIds(): Set<string> {
  return registeredEngineConfirmRequestIdsBySession.of(getBootstrapSession());
}

/**
 * Official 2.1.323 #2039 (`GJi` / `hUt`): mark an AskUserQuestion requestId as
 * an engine-owned confirmation question so mods cannot reword it.
 */
export function registerEngineConfirmQuestion(requestId: string): () => void {
  const ids = getRegisteredEngineConfirmRequestIds();
  ids.add(requestId);
  return () => {
    ids.delete(requestId);
  };
}

/**
 * Official 2.1.323 #2039 (`hUt` + `zJi`): true when an AskUserQuestion prompt
 * is Claude Code's own confirmation question (e.g. `confirm_*`, `mod_hot_reload`,
 * handover check, or registered confirmation id).
 */
export function isEngineConfirmationAsk(requestId: string, metadataSource?: string): boolean {
  if (requestId.startsWith('confirm_')) return true;
  if (metadataSource !== undefined && ENGINE_CONFIRM_METADATA_SOURCES.has(metadataSource)) {
    return true;
  }
  return getRegisteredEngineConfirmRequestIds().has(requestId);
}

/**
 * densable 2.1.289 `AskUserQuestion` `ui.render` site (`cc-plugin-mods-guide`
 * Clawd cooking `Raster` header + `{ type: "engine", ref: 0 }` slot).
 * Synchronous pass-through with zero wrapper layout when no hook matches.
 */
export function PluginAskUserQuestionSite({
  requestId,
  toolName,
  questions,
  metadataSource,
  children,
}: {
  requestId: string;
  toolName: string;
  questions: readonly unknown[];
  metadataSource?: string;
  children: ReactNode;
}): ReactNode {
  useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  const isEngineConfirm = isEngineConfirmationAsk(requestId, metadataSource);
  const askProps = useMemo(
    () => ({
      tool: toolName,
      questions,
      ...(metadataSource !== undefined && { metadataSource }),
    }),
    [toolName, questions, metadataSource],
  );
  const hasHook = hasMatchingFunctionHook('ui.render', {
    surface: 'terminal',
    component: 'AskUserQuestion',
    requestId,
    props: askProps,
  });
  // Official 2.1.323 #2039: engine confirmation questions are drawn as asked;
  // do not allow non-engine mods to intercept or reword them.
  if (isEngineConfirm || !hasHook) {
    return children;
  }
  return (
    <PluginAskUserQuestionActiveSite
      requestId={requestId}
      questions={questions}
      askProps={askProps}
      isEngineConfirm={isEngineConfirm}
    >
      {children}
    </PluginAskUserQuestionActiveSite>
  );
}

function PluginAskUserQuestionActiveSite({
  requestId,
  questions,
  askProps,
  isEngineConfirm = false,
  children,
}: {
  requestId: string;
  questions: readonly unknown[];
  askProps: Record<string, unknown>;
  isEngineConfirm?: boolean;
  children: ReactNode;
}): ReactNode {
  const { addNotification } = useNotifications();
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const renderInput = useMemo(
    () => ({
      surface: 'terminal',
      component: 'AskUserQuestion',
      requestId,
      viewport: { columns, rows, isFullscreen },
      props: askProps,
    }),
    [requestId, columns, rows, isFullscreen, askProps],
  );
  const inputKey = useMemo(
    () => `${requestId}\0${columns}\0${rows}\0${String(isFullscreen)}\0${JSON.stringify(askProps)}`,
    [requestId, columns, rows, isFullscreen, askProps],
  );
  const { drawn, drawnPlugin, engineProps, markThrown } = useRenderDrawing(renderInput, inputKey);
  const ownerPlugin = useMemo(
    () => extractDrawnPlugin(drawn, 'AskUserQuestion', requestId) ?? drawnPlugin,
    [drawn, drawnPlugin, requestId],
  );
  const rewrittenQuestions = useMemo(() => {
    if (isEngineConfirm) {
      if (engineProps?.questions !== undefined) {
        logForDebugging(
          'ui.render (AskUserQuestion): an engine confirmation is drawn as asked; ignoring a rewrite of it',
          { level: 'warn' },
        );
      }
      return questions;
    }
    return validateAskUserQuestionRewrite(engineProps?.questions, questions);
  }, [isEngineConfirm, engineProps?.questions, questions]);
  const engineElement = useMemo(
    () => rewriteAskUserQuestionEngineChild(children, questions, rewrittenQuestions),
    [children, questions, rewrittenQuestions],
  );
  const [resetKey, setResetKey] = useState(0);
  const askPolicy = getAskUserQuestionSurfacePolicy('terminal');
  if (!hasPluginDrawing(drawn)) {
    return engineElement;
  }
  return (
    <PaneErrorBoundary
      resetKey={resetKey}
      fallback={engineElement}
      onError={error => {
        markThrown();
        reportDrawWhileDrawn('AskUserQuestion', [ownerPlugin], error, addNotification);
        setResetKey(n => n + 1);
      }}
    >
      <Box flexDirection="column" maxHeight={askPolicy.rowsMax} overflow="hidden">
        <DrawingNode
          node={drawn}
          plugin={ownerPlugin}
          requestId={requestId}
          index={0}
          engine={engineElement}
          component="AskUserQuestion"
        />
      </Box>
    </PaneErrorBoundary>
  );
}

type SettledPromptHint = {
  isDraft: boolean;
  isWorking: boolean;
  hint: string;
  tail: string;
  pluginTree?: unknown;
  pluginName?: string;
};

/**
 * densable 2.1.289 `PromptHint` (`PromptHintPart` / `PromptHintSite`) `ui.render`
 * site (`cc-plugin-responsive-mode` draft-while-working `tail` / `hint`, plus
 * `diff` viewport reader). Renders `null` synchronously when no hook matches.
 */
export function PluginPromptHintSite({
  isDraft,
  isWorking,
  isInteractive,
  onSuppressDefaultHint,
  onTail,
}: {
  isDraft: boolean;
  isWorking: boolean;
  isInteractive: boolean;
  onSuppressDefaultHint?: (suppress: boolean) => void;
  onTail?: (tail: string) => void;
}): ReactNode {
  const ver = useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  const hasHook = !isInteractive && hasMatchingFunctionHook('ui.render', { component: 'PromptHint' });
  if (!hasHook) {
    return null;
  }
  return (
    <PluginPromptHintActiveSite
      isDraft={isDraft}
      isWorking={isWorking}
      renderVer={ver}
      onSuppressDefaultHint={onSuppressDefaultHint}
      onTail={onTail}
    />
  );
}

function PluginPromptHintActiveSite({
  isDraft,
  isWorking,
  renderVer,
  onSuppressDefaultHint,
  onTail,
}: {
  isDraft: boolean;
  isWorking: boolean;
  renderVer: number;
  onSuppressDefaultHint?: (suppress: boolean) => void;
  onTail?: (tail: string) => void;
}): ReactNode {
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const panesViewport = useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const effectiveColumns = panesViewport?.conversationColumns ?? columns;
  const effectiveRows = panesViewport?.rows ?? rows;
  const defaultHint = isDraft ? '' : isWorking ? 'esc to interrupt' : '? for shortcuts';
  const [settled, setSettled] = useState<SettledPromptHint | undefined>(undefined);
  const [wasStoodIn, setWasStoodIn] = useState(false);
  const evalKey = `${effectiveColumns}\0${effectiveRows}\0${String(isFullscreen)}\0${isDraft ? '1' : '0'}\0${isWorking ? '1' : '0'}\0${renderVer}\0${defaultHint}`;

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const eventPayload: Record<string, unknown> = {
      surface: 'terminal',
      component: 'PromptHint',
      requestId: 'prompt-hint',
      viewport: { columns: effectiveColumns, rows: effectiveRows, isFullscreen },
      props: {
        isDraft,
        isWorking,
        hint: defaultHint,
      },
    };
    void evaluateUiRender(eventPayload, abort.signal).then(
      answer => {
        if (cancelled || abort.signal.aborted) return;
        if (isRecord(answer) && answer.type === 'engine') {
          const props = isRecord(answer.props) ? answer.props : undefined;
          setSettled({
            isDraft: typeof props?.isDraft === 'boolean' ? props.isDraft : isDraft,
            isWorking: typeof props?.isWorking === 'boolean' ? props.isWorking : isWorking,
            hint: typeof props?.hint === 'string' ? cleanPromptHintText(props.hint) : defaultHint,
            tail: typeof props?.tail === 'string' ? cleanPromptHintText(props.tail) : '',
          });
          return;
        }
        if (hasPluginDrawing(answer)) {
          const owner =
            extractDrawnPlugin(answer, 'PromptHint', 'prompt-hint') ?? (getLastUiRenderPlugin() || undefined);
          setSettled({
            isDraft,
            isWorking,
            hint: defaultHint,
            tail: '',
            pluginTree: answer,
            pluginName: owner,
          });
          return;
        }
        if (isRecord(answer)) {
          setSettled({
            isDraft: typeof answer.isDraft === 'boolean' ? answer.isDraft : isDraft,
            isWorking: typeof answer.isWorking === 'boolean' ? answer.isWorking : isWorking,
            hint: typeof answer.hint === 'string' ? cleanPromptHintText(answer.hint) : defaultHint,
            tail: typeof answer.tail === 'string' ? cleanPromptHintText(answer.tail) : '',
          });
          return;
        }
        setSettled({ isDraft, isWorking, hint: defaultHint, tail: '' });
      },
      err => {
        logForDebugging(
          `ui.render (PromptHint prompt-hint): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!cancelled && !abort.signal.aborted) {
          setSettled({ isDraft, isWorking, hint: defaultHint, tail: '' });
        }
      },
    );
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [evalKey, effectiveColumns, effectiveRows, isFullscreen, isDraft, isWorking, defaultHint]);

  const isCurrentReading = settled !== undefined && settled.isDraft === isDraft && settled.isWorking === isWorking;
  // densable IK (@209083743): `yt = pt !== void 0 && Hx(pt, v, St)`; `Kt = pt === void 0 ? Me : yt`.
  // During holdover (`!isCurrentReading`), keep `wasStoodIn` from the prior settled reading so an
  // unrewritten idle hint (`? for shortcuts`) never flashes as a stand-in row on draft transition.
  const currentStandsIn = isCurrentReading && (settled.pluginTree !== undefined || settled.hint !== defaultHint);
  const isHeldOver = settled !== undefined && !isCurrentReading;
  const standsIn = isCurrentReading ? currentStandsIn : wasStoodIn;
  // densable Bx (@209083350): tail-only appends inline on PromptInputFooter via onTail, never a second row.
  const tailOnly =
    isCurrentReading && !currentStandsIn && settled.pluginTree === undefined && settled.hint === defaultHint
      ? settled.tail
      : '';
  const fallbackTailLine = defaultHint !== '' ? `${defaultHint} · ${tailOnly}` : ` · ${tailOnly}`;
  const standaloneTailText = onTail === undefined && tailOnly !== '' ? fallbackTailLine : '';
  const suppressesDefault = !isDraft && (standsIn || standaloneTailText !== '');

  useLayoutEffect(() => {
    if (isCurrentReading) {
      setWasStoodIn(currentStandsIn);
    }
    onSuppressDefaultHint?.(suppressesDefault);
  }, [isCurrentReading, currentStandsIn, onSuppressDefaultHint, suppressesDefault]);

  useLayoutEffect(() => {
    onTail?.(tailOnly);
  }, [onTail, tailOnly]);

  useLayoutEffect(() => {
    return () => {
      onSuppressDefaultHint?.(false);
      onTail?.('');
    };
  }, [onSuppressDefaultHint, onTail]);

  if (settled === undefined || (!standsIn && standaloneTailText === '')) return null;
  if (settled.pluginTree !== undefined) {
    return (
      <Box paddingX={2}>
        <PluginRenderedTree
          node={settled.pluginTree}
          plugin={settled.pluginName}
          requestId="prompt-hint"
          component="PromptHint"
        />
      </Box>
    );
  }
  const shownText =
    standaloneTailText !== ''
      ? standaloneTailText
      : isHeldOver
        ? settled.tail !== '' && settled.hint !== ''
          ? `${settled.hint} · ${settled.tail}`
          : settled.hint
        : resolvePromptHintText({
            isDraft,
            isWorking,
            defaultHint,
            settledIsDraft: settled.isDraft,
            settledIsWorking: settled.isWorking,
            settledHint: settled.hint,
            settledTail: settled.tail,
          });
  if (shownText === '') return null;
  return (
    <Box paddingX={2}>
      <Text dimColor wrap="truncate">
        {shownText}
      </Text>
    </Box>
  );
}

export type PluginUserMessageOrigin = {
  kind: string;
  name?: string;
  [key: string]: unknown;
};

function enginePropsFromDrawn(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = enginePropsFromDrawn(child);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  if (node.type === 'engine') {
    return isRecord(node.props) ? node.props : undefined;
  }
  if (node.children !== undefined) {
    const hit = enginePropsFromDrawn(node.children);
    if (hit !== undefined) return hit;
  }
  if (isRecord(node.props) && node.props.children !== undefined) {
    return enginePropsFromDrawn(node.props.children);
  }
  return undefined;
}

function hasUiRenderHook(component: string): boolean {
  return hasMatchingFunctionHook('ui.render', {
    surface: 'terminal',
    component,
  });
}

function parsePluginChannelOwner(server: unknown): string | undefined {
  if (typeof server !== 'string' || !server.startsWith('plugin:')) return undefined;
  const parts = server.split(':');
  return parts.length >= 3 && parts[1] ? parts[1] : undefined;
}

function deliveredByPlugin(origin?: PluginUserMessageOrigin): string | undefined {
  if (origin === undefined) return undefined;
  switch (origin.kind) {
    case 'plugin':
      return typeof origin.name === 'string' && origin.name !== '' ? origin.name : undefined;
    case 'channel':
      return parsePluginChannelOwner(origin.server);
    default:
      return undefined;
  }
}

function safeInputKeyPart(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * densable `URe` / `OM(xI("UserMessage"), engine)`: plugin tree or the
 * engine's own message (`i(m)`).
 */
export function PluginUserMessageSite({
  requestId,
  text,
  origin,
  isExpanded,
  task,
  from,
  children,
}: {
  requestId: string;
  text: string;
  origin?: PluginUserMessageOrigin;
  isExpanded?: boolean;
  task?: unknown;
  from?: unknown;
  children: ReactNode;
}): ReactNode {
  const { addNotification } = useNotifications();
  const { subscribeFrames } = useApp();
  const staticFrame = useContext(StaticRenderContext);
  useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  const terminalSize = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const panesViewport = useSyncExternalStore(subscribePanes, getPanesTerminalSize, getPanesTerminalSize);
  const conversationColumns = panesViewport?.conversationColumns ?? terminalSize.columns;
  const viewportRows = panesViewport?.rows ?? terminalSize.rows;
  const viewport = useMemo(
    () => ({
      columns: conversationColumns,
      rows: viewportRows,
      isFullscreen,
    }),
    [conversationColumns, viewportRows, isFullscreen],
  );
  const hasComponentHook = hasUiRenderHook('UserMessage');
  // densable `ar`: `ii()&&g2e&&MYe` — `ii` is fullscreen (virtual scroll).
  const measure = !staticFrame && isFullscreen && isG2eComponent('UserMessage') && hasComponentHook;
  const siteId = `UserMessage\0${requestId}`;
  const { ref: cardRef, lastRows, contentRows, onScreen } = useSiteMeasure(measure, siteId, subscribeFrames);
  const submittedBy = deliveredByPlugin(origin);
  const userInput = {
    surface: 'terminal',
    component: 'UserMessage',
    requestId,
    viewport,
    ...(submittedBy !== undefined && { submittedBy }),
    props: {
      text,
      ...(origin !== undefined && { origin }),
      ...(isExpanded !== undefined && { isExpanded }),
      ...(task !== undefined && { task }),
      ...(from !== undefined && { from }),
      ...(onScreen !== undefined && { onScreen }),
    },
  };
  const hasHook = hasComponentHook && hasMatchingFunctionHook('ui.render', userInput);
  const engineDrewRef = useRef(false);
  if (!hasHook) {
    engineDrewRef.current = true;
  }
  const canDrawFallback = engineDrewRef.current || staticFrame;
  const userInputKey = [
    requestId,
    text,
    safeInputKeyPart(origin),
    String(isExpanded ?? ''),
    safeInputKeyPart(task),
    safeInputKeyPart(from),
    safeInputKeyPart(onScreen),
    String(conversationColumns),
    String(viewportRows),
    String(isFullscreen),
    submittedBy ?? '',
  ].join('\0');
  const { drawn, drawnPlugin, markThrown } = useRenderDrawing(hasHook && !staticFrame ? userInput : null, userInputKey);
  if (isEngineFallback(drawn)) {
    engineDrewRef.current = true;
  }
  const ownerPlugin = useMemo(
    () => extractDrawnPlugin(drawn, 'UserMessage', requestId) ?? drawnPlugin,
    [drawn, drawnPlugin, requestId],
  );
  const userHeldRows = useHeldSiteRows({
    isOff: siteIsOff(hasHook, userInput),
    input: hasHook ? userInputKey : undefined,
    drawn,
    isFallback: isEngineFallback(drawn),
    lastRows,
    contentRows,
  });
  useEffect(() => {
    if (userHeldRows !== undefined) {
      noteHeldRows(siteId, onScreen, userHeldRows);
    }
  }, [userHeldRows, drawn, siteId, onScreen]);
  const [userResetKey, setUserResetKey] = useState(0);
  // densable t7t `ref:u` is stable. A fresh callback ref is a changed host prop
  // every commit → markDirty; once scrolled above the viewport the row stays
  // dirty+uncached and skews ScrollBox cull math (rows below vanish).
  const setCardRef = useCallback(
    (node: DOMElement | null) => {
      cardRef.current = node;
    },
    [cardRef],
  );
  const focusables = useMemo(() => focusablesOfDrawing(drawn), [drawn]);
  const hasInteractiveFields = focusables.some(row => row.tag === 'Input' || row.tag === 'Select');
  const pluginTree = hasHook && hasPluginDrawing(drawn);
  const drawPending = hasHook && drawn === undefined && !canDrawFallback;
  const engineProps = hasHook && drawn !== undefined ? enginePropsFromDrawn(drawn) : undefined;
  const rewrittenText = typeof engineProps?.text === 'string' ? engineProps.text : undefined;
  const engine =
    rewrittenText !== undefined && isValidElement(children)
      ? cloneElement(children as ReactElement<{ rewrittenText?: string }>, {
          rewrittenText,
        })
      : children;
  const renderedDrawing = (
    <DrawingNode
      node={drawn}
      plugin={ownerPlugin}
      requestId={requestId}
      index={0}
      engine={engine}
      component="UserMessage"
    />
  );
  const pluginNode = hasInteractiveFields ? (
    <PluginSiteFieldsOwned requestId={requestId} focusables={focusables}>
      {renderedDrawing}
    </PluginSiteFieldsOwned>
  ) : (
    renderedDrawing
  );
  return (
    <Box
      ref={setCardRef}
      flexDirection="column"
      drawPending={drawPending || undefined}
      {...(userHeldRows !== undefined && { minHeight: userHeldRows })}
    >
      {drawPending ? null : pluginTree ? (
        <PaneErrorBoundary
          resetKey={userResetKey}
          fallback={engine}
          onError={error => {
            markThrown();
            reportDrawWhileDrawn('UserMessage', [ownerPlugin], error, addNotification);
            setUserResetKey(n => n + 1);
          }}
        >
          {pluginNode}
        </PaneErrorBoundary>
      ) : (
        engine
      )}
    </Box>
  );
}

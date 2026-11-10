import { Box, Text, useApp } from '@anthropic/ink';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefCallback } from 'react';
import {
  attachImageWidgetSwap,
  attachRasterWidgetPaint,
  bumpRasterFrames,
  createRasterPalette,
  decodeRasterCells,
  noteDrawnElement,
  rasterWordsToAnsi,
  type RasterPalette,
} from '../utils/plugins/functionHooksModules.js';
import {
  createKittyRefusedLogger,
  encodeKittyTransmit,
  isKittyShmSource,
  kittyImageIdBits,
  kittyPlaceholderGrid,
  subscribeKittyGraphicsSupported,
  KITTY_SINK_REFUSED,
} from '../utils/plugins/kittyGraphics.js';
import { Jk, tD, type TerminalCapabilityReading } from '../../packages/@ant/ink/src/core/terminalCapabilities.js';

export function isKittyReferenceSource(source: unknown): boolean {
  return (
    source !== null && typeof source === 'object' && (Object.hasOwn(source, 'file') || Object.hasOwn(source, 'shm'))
  );
}

/** densable 2.1.289 `mo` — Image blit refusal diagnostics. */
export function describeImageBlitRefusal(input: {
  hasRoot: boolean;
  placeholders: TerminalCapabilityReading;
  hasId: boolean;
  isReference: boolean;
  files: ReturnType<ReturnType<typeof Jk>['imageFiles']['get']>;
}): string | undefined {
  const { hasRoot, placeholders, hasId, isReference, files } = input;
  const hasPlaceholders = placeholders.state === 'settled' && placeholders.value;
  const canReadFiles = !isReference || (files.state === 'settled' && files.value);
  const filesPending = !canReadFiles && files.state !== 'settled';
  const filesSource = files.state === 'settled' ? files.source : '';
  if (!hasRoot) return 'the Image is not drawn under a terminal root';
  if (!hasPlaceholders) {
    return `the Image draws its alt here: the terminal draws no placeholder images (${placeholders.source})`;
  }
  if (!hasId) return 'the Image draws its alt here: every 8-bit image id is in use';
  if (filesPending) {
    return 'the terminal has not yet said whether it reads files on this machine; asked now, blit again';
  }
  if (canReadFiles) return undefined;
  return `the Image draws its alt here: this terminal cannot read files on this machine (${filesSource}); a { file } or { shm } source shows nothing, bytes still draw`;
}

/** densable `ko` — waiting palette retry. */
const PALETTE_WAIT_MS = 250;
/** densable progressing retry — one animation frame. */
const PALETTE_PROGRESS_MS = 16;

type RawAnsiNode = {
  attributes?: { rawText?: string };
};

type PaintScheduler = {
  paint: (words: Uint32Array) => void;
  schedule: (words: Uint32Array, delayMs: number) => void;
  cancel: () => void;
};

/** densable `ho`. */
function createPaintScheduler(apply: (words: Uint32Array) => void): PaintScheduler {
  let last = Number.NEGATIVE_INFINITY;
  let pending: Uint32Array | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let due = Number.POSITIVE_INFINITY;

  const flush = (): void => {
    timer = null;
    due = Number.POSITIVE_INFINITY;
    if (pending !== null) {
      const words = pending;
      pending = null;
      last = Date.now();
      apply(words);
    }
  };

  const arm = (delayMs: number): void => {
    const at = Date.now() + delayMs;
    if (timer !== null && due <= at) return;
    if (timer !== null) clearTimeout(timer);
    due = at;
    timer = setTimeout(flush, delayMs);
  };

  const schedule = (words: Uint32Array, delayMs: number): void => {
    const wait = Math.max(delayMs, last + PALETTE_PROGRESS_MS - Date.now());
    pending = words;
    if (wait <= 0) {
      if (timer !== null) clearTimeout(timer);
      flush();
    } else {
      arm(wait);
    }
  };

  return {
    paint(words) {
      schedule(words, 0);
    },
    schedule,
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      due = Number.POSITIVE_INFINITY;
      pending = null;
    },
  };
}

/** densable `go` — write rawText on the ink-raw-ansi host node. */
function writeRawText(node: RawAnsiNode | null, ansi: string): void {
  if (node === null || node.attributes === undefined) return;
  if (node.attributes.rawText === ansi) return;
  node.attributes.rawText = ansi;
}

function scheduleIfIncomplete(scheduler: PaintScheduler | null, palette: RasterPalette, words: Uint32Array): void {
  const standing = palette.standing();
  if (standing === 'complete' || scheduler === null) return;
  scheduler.schedule(words, standing === 'progressing' ? PALETTE_PROGRESS_MS : PALETTE_WAIT_MS);
}

export type PluginRasterProps = {
  plugin: string;
  requestId: string;
  elementKey: string;
  columns: number;
  rows: number;
  cells?: string;
};

/**
 * densable Raster `wo` / `To` / `ho` / `go`.
 * `ILo` = attachRasterWidgetPaint(..., R.paint).
 * blit → paint(words) → Joo → this node's rawText.
 */
export function PluginRaster(props: PluginRasterProps): ReactNode {
  const { plugin, requestId, elementKey, columns, rows, cells } = props;
  const palette = useMemo(() => createRasterPalette(), []);
  const initialWords = useMemo(() => {
    if (cells === undefined) return new Uint32Array();
    const decoded = decodeRasterCells(cells, columns, rows);
    return 'words' in decoded ? decoded.words : new Uint32Array();
  }, [cells, columns, rows]);
  const rawRef = useRef<RawAnsiNode | null>(null);
  const schedulerRef = useRef<PaintScheduler | null>(null);
  const [paintedAnsi, setPaintedAnsi] = useState<string | undefined>(undefined);
  const prevInitialRef = useRef<{ words: Uint32Array; palette: RasterPalette }>({
    words: initialWords,
    palette,
  });
  let currentPaintedAnsi = paintedAnsi;
  if (prevInitialRef.current.words !== initialWords || prevInitialRef.current.palette !== palette) {
    prevInitialRef.current = { words: initialWords, palette };
    currentPaintedAnsi = undefined;
  }

  const bindRaw: RefCallback<unknown> = node => {
    rawRef.current = (node as RawAnsiNode | null) ?? null;
  };

  useLayoutEffect(() => {
    const size = { columns, rows };
    const scheduler = createPaintScheduler(words => {
      const ansi = rasterWordsToAnsi(words, size.columns, size.rows, palette);
      writeRawText(rawRef.current, ansi);
      setPaintedAnsi(ansi);
      scheduleIfIncomplete(schedulerRef.current, palette, words);
      bumpRasterFrames();
    });
    schedulerRef.current = scheduler;
    const detach = attachRasterWidgetPaint(plugin, requestId, elementKey, words => {
      scheduler.paint(words);
    });
    noteDrawnElement(plugin, requestId, elementKey);
    bumpRasterFrames();
    return () => {
      detach();
      scheduler.cancel();
      schedulerRef.current = null;
      bumpRasterFrames();
    };
  }, [plugin, elementKey, columns, rows, requestId, palette]);

  useLayoutEffect(() => {
    schedulerRef.current?.cancel();
    setPaintedAnsi(undefined);
    scheduleIfIncomplete(schedulerRef.current, palette, initialWords);
  }, [initialWords, palette]);

  const initialAnsi = useMemo(
    () => rasterWordsToAnsi(initialWords, columns, rows, palette),
    [initialWords, columns, rows, palette],
  );
  const ansi = currentPaintedAnsi ?? initialAnsi;
  return (
    <Box flexShrink={0} width={columns} height={rows} overflow="hidden" elementKey={elementKey} elementPlugin={plugin}>
      <ink-raw-ansi ref={bindRaw} rawText={ansi} rawWidth={columns} rawHeight={rows} />
    </Box>
  );
}

export type PluginImageProps = {
  plugin: string;
  requestId: string;
  elementKey: string;
  source?: unknown;
  columns: number;
  rows: number;
  alt?: string;
};

/**
 * densable `ko` / `To` / `xo` / `co`: kitty id → `Qmo` placeholders in ink-raw-ansi;
 * no sink / no id → dim alt. Widget swap transmits (`Zmo`/`Qt`); host `umt` already ran.
 */
export function PluginImage(props: PluginImageProps): ReactNode {
  const { plugin, requestId, elementKey, source: initialSource, columns, rows, alt = 'image' } = props;
  const { terminalImages } = useApp();
  const [allocated, setAllocated] = useState<{ id: number; images: NonNullable<typeof terminalImages> } | undefined>(
    undefined,
  );
  const [kittyId, setKittyId] = useState<number | undefined>(undefined);
  const [kittyProbe, setKittyProbe] = useState(0);
  const transmittedRef = useRef<{
    sourceKey: string | undefined;
    source: unknown;
    box: string | undefined;
  }>({ sourceKey: undefined, source: undefined, box: undefined });
  const imageColumns = columns;
  const imageRows = rows;
  const placeholder = useMemo(() => {
    if (kittyId === undefined) return undefined;
    try {
      return kittyPlaceholderGrid(kittyId, imageColumns, imageRows);
    } catch {
      return undefined;
    }
  }, [kittyId, imageColumns, imageRows]);
  const placeholderFailed = kittyId !== undefined && placeholder === undefined;

  useEffect(() => {
    return subscribeKittyGraphicsSupported(() => {
      setKittyProbe(n => n + 1);
    });
  }, []);

  useLayoutEffect(() => {
    // densable `ko`: allocate(k, xo) on `HC().terminalImages` when yo() has bits.
    const bits = kittyImageIdBits();
    const id =
      terminalImages === null || bits === undefined
        ? undefined
        : terminalImages.allocate(bits, createKittyRefusedLogger({ plugin, requestId, key: elementKey }));
    setAllocated(id !== undefined && terminalImages !== null ? { id, images: terminalImages } : undefined);
    const detach = attachImageWidgetSwap(plugin, requestId, elementKey, source => {
      const refusal = describeImageBlitRefusal({
        hasRoot: terminalImages !== null,
        placeholders: tD().get('kittyGraphics'),
        hasId: id !== undefined,
        isReference: isKittyReferenceSource(source),
        files: Jk().imageFiles.get(),
      });
      if (refusal !== undefined || id === undefined || terminalImages === null) {
        return refusal;
      }
      const consumed = isKittyShmSource(source);
      if (consumed && terminalImages.isBackedUp(id)) {
        return 'the surface has not written its last frames (paused or busy); the object was not sent, unlink it and blit again later';
      }
      // densable `Qt({source,columns,rows})` + `{resend:!HUr}`.
      const ok = terminalImages.transmit(id, imageId => encodeKittyTransmit(imageId, source, columns, rows), {
        resend: !consumed,
      });
      if (!ok) return KITTY_SINK_REFUSED;
      transmittedRef.current = {
        ...transmittedRef.current,
        source,
        box: `${columns}x${rows}`,
      };
      setKittyId(id);
      bumpRasterFrames();
      return undefined;
    });
    noteDrawnElement(plugin, requestId, elementKey);
    bumpRasterFrames();
    return () => {
      detach();
      if (id !== undefined) terminalImages?.free(id);
      transmittedRef.current = { sourceKey: undefined, source: undefined, box: undefined };
      setAllocated(undefined);
      setKittyId(undefined);
      bumpRasterFrames();
    };
  }, [plugin, requestId, elementKey, columns, rows, terminalImages, kittyProbe]);

  useLayoutEffect(() => {
    if (allocated === undefined) return;
    const isRef = isKittyReferenceSource(initialSource);
    const filesReading = Jk().imageFiles.get();
    const canReadFiles = !isRef || (filesReading.state === 'settled' && filesReading.value);
    if (!canReadFiles) {
      transmittedRef.current = { sourceKey: undefined, source: undefined, box: undefined };
      setKittyId(undefined);
      return;
    }
    let sourceKey: string | undefined;
    if (initialSource !== undefined) {
      try {
        sourceKey = JSON.stringify(initialSource);
      } catch {
        sourceKey = undefined;
      }
    }
    const box = `${columns}x${rows}`;
    const sourceChanged = sourceKey !== transmittedRef.current.sourceKey;
    const activeSource = sourceChanged ? initialSource : (transmittedRef.current.source ?? initialSource);
    if (activeSource === undefined) {
      if (sourceChanged) {
        transmittedRef.current = { sourceKey: undefined, source: undefined, box: undefined };
        setKittyId(undefined);
      }
      return;
    }
    const activeConsumed = isKittyShmSource(activeSource);
    if (!sourceChanged && (box === transmittedRef.current.box || activeConsumed)) return;
    try {
      const ok = allocated.images.transmit(
        allocated.id,
        imageId => encodeKittyTransmit(imageId, activeSource, columns, rows),
        { resend: !activeConsumed },
      );
      transmittedRef.current = { sourceKey, source: activeSource, box };
      setKittyId(ok ? allocated.id : undefined);
      bumpRasterFrames();
    } catch {
      transmittedRef.current = { sourceKey, source: activeSource, box };
      setKittyId(undefined);
    }
  }, [allocated, initialSource, columns, rows]);

  // densable `To`: no id → dim alt Text; else sized overflow box + ink-raw-ansi placeholders.
  if (kittyId === undefined || placeholderFailed || placeholder === undefined) {
    return <Text dimColor>{alt}</Text>;
  }
  return (
    <Box
      flexShrink={0}
      width={imageColumns}
      height={imageRows}
      overflow="hidden"
      elementKey={elementKey}
      elementPlugin={plugin}
    >
      <ink-raw-ansi rawText={placeholder} rawWidth={imageColumns} rawHeight={imageRows} />
    </Box>
  );
}

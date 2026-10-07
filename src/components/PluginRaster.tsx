import { Box, Text } from '@anthropic/ink';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefCallback } from 'react';
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
  allocateKittyImageId,
  freeKittyImageId,
  isKittyGraphicsTerminal,
  kittyPlaceholderGrid,
  KITTY_SINK_REFUSED,
  transmitKittyImage,
} from '../utils/plugins/kittyGraphics.js';

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

  const bindRaw: RefCallback<unknown> = node => {
    rawRef.current = (node as RawAnsiNode | null) ?? null;
  };

  useEffect(() => {
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

  const ansi = paintedAnsi ?? rasterWordsToAnsi(initialWords, columns, rows, palette);
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
  columns: number;
  rows: number;
  alt?: string;
};

/**
 * densable `xo` / `co`: kitty id → `Pqr` placeholders in ink-raw-ansi;
 * no sink / no id → dim alt. Widget swap transmits (`Iqr`); host `umt` already ran.
 */
export function PluginImage(props: PluginImageProps): ReactNode {
  const { plugin, requestId, elementKey, columns, rows, alt = 'image' } = props;
  const [kittyId, setKittyId] = useState<number | undefined>(undefined);
  const placeholder = useMemo(
    () => (kittyId === undefined ? '' : kittyPlaceholderGrid(kittyId, columns, rows)),
    [kittyId, columns, rows],
  );

  useEffect(() => {
    // densable `co`: allocate only when a kitty sink exists (`fo` width analog).
    const sink = isKittyGraphicsTerminal();
    const id = sink ? allocateKittyImageId() : undefined;
    setKittyId(id);
    const detach = attachImageWidgetSwap(plugin, requestId, elementKey, source => {
      // No kitty sink: gold `xo` dims alt; blit still succeeds (umt already ran).
      if (!sink) return undefined;
      if (id === undefined) {
        return 'the Image draws its alt here: every 8-bit image id is in use';
      }
      if (!transmitKittyImage(id, source, columns, rows)) return KITTY_SINK_REFUSED;
      return undefined;
    });
    noteDrawnElement(plugin, requestId, elementKey);
    bumpRasterFrames();
    return () => {
      detach();
      if (id !== undefined) freeKittyImageId(id);
      setKittyId(undefined);
      bumpRasterFrames();
    };
  }, [plugin, requestId, elementKey, columns, rows]);

  // densable `xo`: no id → dim alt; else sized overflow box + ink-raw-ansi placeholders.
  if (kittyId === undefined) {
    return (
      <Box
        flexShrink={0}
        width={columns}
        height={rows}
        overflow="hidden"
        elementKey={elementKey}
        elementPlugin={plugin}
      >
        <Text dimColor>{alt}</Text>
      </Box>
    );
  }
  return (
    <Box flexShrink={0} width={columns} height={rows} overflow="hidden" elementKey={elementKey} elementPlugin={plugin}>
      <ink-raw-ansi rawText={placeholder} rawWidth={columns} rawHeight={rows} />
    </Box>
  );
}

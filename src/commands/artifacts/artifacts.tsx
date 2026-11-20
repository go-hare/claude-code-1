import * as React from 'react';
import type { LocalJSXCommandOnDone } from 'src/types/command.js';
import type { ToolUseContext } from 'src/Tool.js';
import { ArtifactsMenu } from './ArtifactsMenu.js';
import { type ArtifactInfo, type ArtifactPageResponse, extractArtifacts, fetchPaginatedArtifacts } from './scanner.js';

type PaginatedArtifactRow = ArtifactInfo & { id: string };

export type ArtifactsMenuLoaderProps = {
  initialArtifacts: ArtifactInfo[];
  onExit: () => void;
  fetchPage?: (
    pageToken: string | undefined,
    signal?: AbortSignal,
  ) => Promise<ArtifactPageResponse<PaginatedArtifactRow>>;
};

/**
 * Official 2.1.327 (#422): load artifacts via `fetchPaginatedArtifacts` and
 * forward `loading`, `incomplete`, and `loadError` to `<ArtifactsMenu>` so
 * partial/failed pagination never silently renders "No artifacts yet".
 */
export function ArtifactsMenuLoader({
  initialArtifacts,
  onExit,
  fetchPage,
}: ArtifactsMenuLoaderProps): React.ReactElement {
  const [artifacts, setArtifacts] = React.useState<ArtifactInfo[]>(initialArtifacts);
  const [loading, setLoading] = React.useState<boolean>(Boolean(fetchPage));
  const [incomplete, setIncomplete] = React.useState<boolean>(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const pageFetcher =
      fetchPage ??
      (async (): Promise<ArtifactPageResponse<PaginatedArtifactRow>> => ({
        served: true,
        rows: initialArtifacts.map(item => ({ ...item, id: item.toolUseId })),
      }));

    if (fetchPage) {
      setLoading(true);
    }
    void fetchPaginatedArtifacts<PaginatedArtifactRow>({
      fetchPage: pageFetcher,
      signal: controller.signal,
      onProgress: rows => {
        if (!active) return;
        setArtifacts(rows);
      },
    })
      .then(result => {
        if (!active) return;
        setArtifacts(result.items);
        setIncomplete(result.incomplete);
        setLoadError(result.incomplete && result.items.length === 0 ? (result.lastError ?? null) : null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setIncomplete(true);
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [fetchPage, initialArtifacts]);

  return (
    <ArtifactsMenu
      artifacts={artifacts}
      onExit={onExit}
      loading={loading}
      incomplete={incomplete}
      loadError={loadError}
    />
  );
}

export async function call(onDone: LocalJSXCommandOnDone, context: ToolUseContext): Promise<React.ReactNode> {
  const messages = context.messages ?? [];
  const artifacts = extractArtifacts(messages);
  return <ArtifactsMenuLoader initialArtifacts={artifacts} onExit={onDone} />;
}

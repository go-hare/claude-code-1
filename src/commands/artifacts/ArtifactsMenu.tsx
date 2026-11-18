import * as React from 'react';
import { Box, Text, setClipboard, useInput } from '@anthropic/ink';
import { Select } from '../../components/CustomSelect/select.js';
import type { ArtifactInfo } from './scanner.js';
import { openBrowser } from 'src/utils/browser.js';

type Props = {
  artifacts: ArtifactInfo[];
  onExit: () => void;
  onDelete?: (artifact: ArtifactInfo) => void;
};

export function ArtifactsMenu({ artifacts, onExit, onDelete }: Props): React.ReactElement {
  const [items, setItems] = React.useState<ArtifactInfo[]>(artifacts);
  const [selected, setSelected] = React.useState(0);
  const [confirmTarget, setConfirmTarget] = React.useState<ArtifactInfo | null>(null);

  React.useEffect(() => {
    setItems(artifacts);
  }, [artifacts]);

  useInput(
    (input, key) => {
      if (input === 'q' || key.escape) {
        onExit();
        return;
      }
      if (items.length === 0) return;
      if (key.upArrow) {
        setSelected(s => (s - 1 + items.length) % items.length);
        return;
      }
      if (key.downArrow) {
        setSelected(s => (s + 1) % items.length);
        return;
      }
      if (key.return) {
        const target = items[selected];
        if (target?.url) {
          void openBrowser(target.url);
          onExit();
        }
        return;
      }
      if (input === 'd') {
        const target = items[selected];
        if (target) {
          setConfirmTarget(target);
        }
        return;
      }
      if (input === 'c') {
        const target = items[selected];
        if (target?.url) {
          void setClipboard(target.url).then(raw => {
            if (raw) process.stdout.write(raw);
          });
        }
      }
    },
    { isActive: confirmTarget === null },
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>Artifacts ({items.length})</Text>
      </Box>

      {confirmTarget !== null ? (
        <Box flexDirection="column">
          <Box gap={1}>
            <Text wrap="truncate-end">
              Delete <Text bold>{confirmTarget.basename}</Text>?
            </Text>
            <Box flexShrink={0}>
              <Text>This cannot be undone.</Text>
            </Box>
          </Box>
          <Select
            options={[
              { label: 'No, keep it', value: 'keep' },
              { label: 'Yes, delete it', value: 'delete' },
            ]}
            defaultValue="keep"
            onChange={value => {
              if (value === 'delete') {
                onDelete?.(confirmTarget);
                setItems(prev => prev.filter(item => item.toolUseId !== confirmTarget.toolUseId));
                setSelected(s => Math.max(0, Math.min(s, items.length - 2)));
              }
              setConfirmTarget(null);
            }}
            onCancel={() => setConfirmTarget(null)}
          />
        </Box>
      ) : items.length === 0 ? (
        <Text color="subtle">No artifacts uploaded this session. Run /use-artifacts to learn how.</Text>
      ) : (
        <Box flexDirection="column">
          {items.map((a, idx) => (
            <ArtifactRow key={a.toolUseId} artifact={a} isSelected={idx === selected} />
          ))}
          <Box marginTop={1}>
            <Text color="subtle">{'↑/↓ select · Enter open · c copy URL · d delete · Esc exit'}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ArtifactRow({ artifact, isSelected }: { artifact: ArtifactInfo; isSelected: boolean }): React.ReactElement {
  const marker = isSelected ? '›' : ' ';
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={isSelected ? 'suggestion' : undefined}>{marker} </Text>
        <Text bold={isSelected} color={artifact.isError ? 'error' : undefined}>
          {artifact.basename}
        </Text>
        {artifact.hash ? <Text color="subtle"> ({artifact.hash})</Text> : null}
      </Box>
      {artifact.url ? (
        <Box marginLeft={2}>
          <Text color="background">{artifact.url}</Text>
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text color="error">{artifact.rawContent}</Text>
        </Box>
      )}
      {artifact.expiresAt ? (
        <Box marginLeft={2}>
          <Text color="subtle">expires: {artifact.expiresAt}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

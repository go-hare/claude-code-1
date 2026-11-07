import * as React from 'react';
import { useCallback } from 'react';
import { ConfirmSelect } from '../../../components/ConfirmSelect.js';
import { Box, Text } from '@anthropic/ink';
import type { ToolPermissionContext } from '../../../Tool.js';
import { applyPermissionUpdate } from '../../../utils/permissions/PermissionUpdate.js';
import { Dialog } from '@anthropic/ink';

type Props = {
  directoryPath: string;
  onRemove: () => void;
  onCancel: () => void;
  permissionContext: ToolPermissionContext;
  setPermissionContext: (context: ToolPermissionContext) => void;
};

export function RemoveWorkspaceDirectory({
  directoryPath,
  onRemove,
  onCancel,
  permissionContext,
  setPermissionContext,
}: Props): React.ReactNode {
  const handleRemove = useCallback(() => {
    const updatedContext = applyPermissionUpdate(permissionContext, {
      type: 'removeDirectories',
      directories: [directoryPath],
      destination: 'session',
    });

    setPermissionContext(updatedContext);
    onRemove();
  }, [directoryPath, permissionContext, setPermissionContext, onRemove]);

  return (
    <Dialog title="Remove directory from workspace?" onCancel={onCancel} color="error">
      <Box marginX={2} flexDirection="column">
        <Text bold>{directoryPath}</Text>
      </Box>
      <Text>Claude Code will no longer have access to files in this directory.</Text>
      <ConfirmSelect hideIndexes focus="cancel" onConfirm={handleRemove} onCancel={onCancel} />
    </Dialog>
  );
}

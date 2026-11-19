import { homedir } from 'os';
import { isAbsolute, relative, sep } from 'path';
import React from 'react';
import { Box, Text } from '@anthropic/ink';
import { getCwd } from '../../utils/cwd.js';

function isWithinDirectory(targetPath: string, baseDir: string, pathSep: string): boolean {
  if (!baseDir) return false;
  const trimmedBase =
    baseDir.length > 1 && (baseDir.endsWith(pathSep) || baseDir.endsWith('/')) ? baseDir.slice(0, -1) : baseDir;
  if (targetPath === trimmedBase) return true;
  if (targetPath.startsWith(trimmedBase + pathSep)) return true;
  if (pathSep !== '/' && targetPath.startsWith(trimmedBase + '/')) return true;
  return false;
}

/**
 * Official 2.1.323 `Ze` (#2061): format memory file path relative to `cwd` or `~`
 * with strict directory-boundary matching (so `/Users/alice-work` does not match
 * `/Users/alice`, and `/repo-v2` does not match `/repo`) and preserve `/` separators
 * on Windows.
 */
export function getRelativeMemoryPath(
  filePath: string,
  opts?: { homeDir?: string; cwd?: string; pathSep?: string },
): string {
  const pathSep = opts?.pathSep ?? sep;
  const homeDir = opts?.homeDir ?? homedir();
  const cwd = opts?.cwd ?? getCwd();

  const normalizedHome =
    homeDir.length > 1 && (homeDir.endsWith(pathSep) || homeDir.endsWith('/')) ? homeDir.slice(0, -1) : homeDir;
  const relativeToHome = isWithinDirectory(filePath, normalizedHome, pathSep)
    ? `~${filePath.slice(normalizedHome.length)}`
    : filePath;

  const isInsideCwd = isWithinDirectory(filePath, cwd, pathSep);
  let relativeToCwd: string | null = null;
  if (isInsideCwd) {
    const rel =
      opts?.pathSep === '\\' ? filePath.slice(cwd.replace(/[\\/]+$/, '').length + 1) : relative(cwd, filePath);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      relativeToCwd = `./${rel}`;
    }
  }

  const chosen =
    relativeToCwd === null || relativeToHome.length <= relativeToCwd.length ? relativeToHome : relativeToCwd;
  return chosen.replaceAll(pathSep, '/');
}

export function MemoryUpdateNotification({ memoryPath }: { memoryPath: string }): React.ReactNode {
  const displayPath = getRelativeMemoryPath(memoryPath);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="text">Memory updated in {displayPath} · /memory to edit</Text>
    </Box>
  );
}

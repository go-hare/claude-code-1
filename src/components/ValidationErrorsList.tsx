import * as React from 'react';
import { Box, Link, NoSelect, Text } from '@anthropic/ink';
import type { ValidationError } from '../utils/settings/validation.js';

function groupErrorsByFile(
  acc: Record<string, ValidationError[]>,
  error: ValidationError,
): Record<string, ValidationError[]> {
  const file = error.file || '(file not specified)';
  if (!acc[file]) {
    acc[file] = [];
  }
  acc[file]!.push(error);
  return acc;
}

function compareErrorsByPath(a: ValidationError, b: ValidationError): number {
  if (!a.path && b.path) return -1;
  if (a.path && !b.path) return 1;
  return (a.path || '').localeCompare(b.path || '');
}

function formatErrorPath(error: ValidationError): string | null {
  if (!error.path) return null;
  const parts = error.path.split('.');
  const last = parts[parts.length - 1];
  if (
    error.invalidValue !== null &&
    error.invalidValue !== undefined &&
    last !== undefined &&
    !isNaN(parseInt(last, 10))
  ) {
    const formatted = typeof error.invalidValue === 'string' ? `"${error.invalidValue}"` : String(error.invalidValue);
    return [...parts.slice(0, -1), formatted].join('.');
  }
  return error.path;
}

/**
 * Groups and displays validation errors per file using a tree layout with deduplicated suggestions.
 */
export function ValidationErrorsList({ errors }: { errors: ValidationError[] }): React.ReactNode {
  if (errors.length === 0) {
    return null;
  }

  const errorsByFile = errors.reduce<Record<string, ValidationError[]>>(groupErrorsByFile, {});
  const sortedFiles = Object.keys(errorsByFile).sort();

  return (
    <Box flexDirection="column">
      {sortedFiles.map(file => {
        const fileErrors = errorsByFile[file] || [];
        fileErrors.sort(compareErrorsByPath);

        const suggestionPairs = new Map<string, { suggestion?: string; docLink?: string }>();
        fileErrors.forEach(error => {
          if (error.suggestion || error.docLink) {
            const key = `${error.suggestion || ''}|${error.docLink || ''}`;
            if (!suggestionPairs.has(key)) {
              suggestionPairs.set(key, {
                suggestion: error.suggestion,
                docLink: error.docLink,
              });
            }
          }
        });

        return (
          <Box key={file} flexDirection="column">
            <Text>{file}</Text>
            <Box flexDirection="column">
              {fileErrors.map((error, index) => {
                const formattedPath = formatErrorPath(error);
                const isLast = index === fileErrors.length - 1;
                return (
                  <Box key={index} flexDirection="row">
                    <NoSelect aria-hidden fromLeftEdge flexShrink={0} flexDirection="row">
                      <Box width={2}>
                        <Text dimColor>{isLast ? '└' : '├'}</Text>
                      </Box>
                    </NoSelect>
                    <Box flexGrow={1} flexShrink={1}>
                      {formattedPath ? (
                        <Text>
                          {formattedPath}: <Text dimColor>{error.message}</Text>
                        </Text>
                      ) : (
                        <Text dimColor>{error.message}</Text>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {suggestionPairs.size > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {Array.from(suggestionPairs.values()).map((pair, index) => (
                  <Box key={`suggestion-pair-${index}`} flexDirection="column" marginBottom={1}>
                    {pair.suggestion && (
                      <Text dimColor wrap="wrap">
                        {pair.suggestion}
                      </Text>
                    )}
                    {pair.docLink && (
                      <Text dimColor>
                        Learn more: <Link url={pair.docLink} />
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

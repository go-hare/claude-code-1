import React, { useMemo } from 'react';
import { getMcpConfigsByScope, getMcpScopeConflicts } from 'src/services/mcp/config.js';
import type { ConfigScope } from 'src/services/mcp/types.js';
import { describeMcpConfigFilePath, getScopeLabel } from 'src/services/mcp/utils.js';
import type { ValidationError } from 'src/utils/settings/validation.js';
import { Box, Link, Text } from '@anthropic/ink';

function McpConfigErrorSection({
  scope,
  parsingErrors,
  warnings,
}: {
  scope: ConfigScope;
  parsingErrors: ValidationError[];
  warnings: ValidationError[];
}): React.ReactNode {
  const hasErrors = parsingErrors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (!hasErrors && !hasWarnings) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        {(hasErrors || hasWarnings) && (
          <Text color={hasErrors ? 'error' : 'warning'}>[{hasErrors ? 'Failed to parse' : 'Contains warnings'}] </Text>
        )}
        <Text>{getScopeLabel(scope)}</Text>
      </Box>
      <Box>
        <Text dimColor>Location: </Text>
        <Text dimColor>{describeMcpConfigFilePath(scope)}</Text>
      </Box>
      <Box marginLeft={1} flexDirection="column">
        {parsingErrors.map((error, i) => {
          const serverName = error.mcpErrorMetadata?.serverName;
          return (
            <Box key={`error-${i}`}>
              <Text>
                <Text dimColor>└ </Text>
                <Text color="error">[Error]</Text>
                <Text dimColor>
                  {' '}
                  {serverName && `[${serverName}] `}
                  {error.path && error.path !== '' ? `${error.path}: ` : ''}
                  {error.message}
                </Text>
              </Text>
            </Box>
          );
        })}
        {warnings.map((warning, i) => {
          const serverName = warning.mcpErrorMetadata?.serverName;

          return (
            <Box key={`warning-${i}`}>
              <Text>
                <Text dimColor>└ </Text>
                <Text color="warning">[Warning]</Text>
                <Text dimColor>
                  {' '}
                  {serverName && `[${serverName}] `}
                  {warning.path && warning.path !== '' ? `${warning.path}: ` : ''}
                  {warning.message}
                </Text>
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function McpParsingWarnings(): React.ReactNode {
  // Config files don't change during dialog lifetime; read once on mount
  // to avoid blocking file IO on every re-render.
  // densable McE/Gpi: conflicts use expandVars:false displayServers so `${VAR}` stays configured.
  const { scopes, conflicts } = useMemo(() => {
    const loaded = [
      { scope: 'user' as const, config: getMcpConfigsByScope('user') },
      { scope: 'project' as const, config: getMcpConfigsByScope('project') },
      { scope: 'local' as const, config: getMcpConfigsByScope('local') },
      { scope: 'enterprise' as const, config: getMcpConfigsByScope('enterprise') },
    ];
    // densable DcE: enterprise excluded from scope-conflict scan
    const conflictInputs = loaded
      .filter(entry => entry.scope !== 'enterprise')
      .map(entry => ({
        scope: entry.scope,
        servers: entry.config.servers,
        displayServers: getMcpConfigsByScope(entry.scope, {
          expandVars: false,
        }).servers,
      }));
    return {
      scopes: loaded satisfies Array<{
        scope: ConfigScope;
        config: { errors: ValidationError[]; servers: unknown };
      }>,
      conflicts: getMcpScopeConflicts(conflictInputs),
    };
  }, []);

  const hasParsingErrors = scopes.some(({ config }) => filterErrors(config.errors, 'fatal').length > 0);
  const hasWarnings =
    scopes.some(({ config }) => filterErrors(config.errors, 'warning').length > 0) || conflicts.length > 0;

  if (!hasParsingErrors && !hasWarnings) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text bold>MCP Config Diagnostics</Text>
      <Box marginTop={1}>
        <Text dimColor>
          For help configuring MCP servers, see:{' '}
          <Link url="https://code.claude.com/docs/en/mcp">https://code.claude.com/docs/en/mcp</Link>
        </Text>
      </Box>
      {scopes.map(({ scope, config }) => (
        <McpConfigErrorSection
          key={scope}
          scope={scope}
          parsingErrors={filterErrors(config.errors, 'fatal')}
          warnings={filterErrors(config.errors, 'warning')}
        />
      ))}
      {conflicts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="warning">[Scope conflicts]</Text>
          <Box marginLeft={1} flexDirection="column">
            {conflicts.map((warning, i) => {
              const serverName = warning.mcpErrorMetadata?.serverName;
              return (
                <Box key={`conflict-${i}`} flexDirection="column">
                  <Text>
                    <Text dimColor>└ </Text>
                    <Text color="warning">[Warning]</Text>
                    <Text dimColor>
                      {' '}
                      {serverName && `[${serverName}] `}
                      {warning.message}
                    </Text>
                  </Text>
                  {warning.suggestion && (
                    <Text dimColor>
                      {'  '}
                      {warning.suggestion}
                    </Text>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function filterErrors(errors: ValidationError[], severity: 'fatal' | 'warning'): ValidationError[] {
  return errors.filter(e => e.mcpErrorMetadata?.severity === severity);
}

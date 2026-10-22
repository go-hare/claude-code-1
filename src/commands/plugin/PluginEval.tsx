import figures from 'figures';
import * as React from 'react';
import { useEffect } from 'react';
import { Box, Text } from '@anthropic/ink';
import { errorMessage } from '../../utils/errors.js';
import { logForDebugging } from '../../utils/debug.js';
import { formatSkillTriggerReport, runSkillTriggerEval } from '../../utils/plugins/pluginEval/skillTriggerEval.js';

const USAGE =
  'Usage: /plugin eval [path]\n' +
  'Run trigger evaluations for a skill against the queries in its evals/ folder.\n' +
  'Examples:\n' +
  '  /plugin eval ./my-skill\n' +
  '  /plugin eval ~/.claude/skills/pdf-tools\n' +
  'Each evals/*.md file needs frontmatter with `query` (string)\n' +
  'and `should_trigger` (boolean). The spec recommends at least five.\n' +
  'Or from the command line:\n' +
  '  claude plugin eval [path]';

type Props = {
  onComplete: (result?: string) => void;
  path?: string;
};

/**
 * densable `Dr` — slash `/plugin eval [path]` runs gold `yl` (`runSkillTriggerEval`)
 * with `fl` pending scorer. Not CLI `$R` (case.yaml suite).
 */
export function PluginEval({ onComplete, path }: Props): React.ReactNode {
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      if (!path) {
        onComplete(USAGE);
        return;
      }
      try {
        const z = await runSkillTriggerEval(path, abort.signal);
        process.exitCode = z.failCount > 0 ? 1 : 0;
        const U =
          z.queries.length === 0
            ? ''
            : z.failCount > 0
              ? `\n${figures.cross} Evaluation failed`
              : z.skippedCount === z.queries.length
                ? `\n${figures.info} Eval queries validated; trigger tests pending model integration`
                : `\n${figures.tick} Evaluation passed`;
        onComplete(formatSkillTriggerReport(z) + U);
      } catch (error) {
        process.exitCode = 2;
        logForDebugging(`Plugin eval failed for ${path}: ${errorMessage(error)}`, {
          level: 'error',
        });
        onComplete(`${figures.cross} ${errorMessage(error)}`);
      }
    })();
    return () => abort.abort();
  }, [onComplete, path]);

  return (
    <Box flexDirection="column">
      <Text>Running evaluation…</Text>
    </Box>
  );
}

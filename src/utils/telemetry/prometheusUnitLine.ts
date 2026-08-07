/**
 * densable 2.1.216 PrometheusSerializer unit gate:
 *   i = e.descriptor.unit ? `\n# UNIT ${r} ${Dko(e.descriptor.unit)}` : ""
 *
 * Empty / missing unit must NOT emit a `# UNIT` line (invalid OpenMetrics).
 * Local `@opentelemetry/exporter-prometheus@0.215` already embeds this gate;
 * this pure helper is the 1:1 regression surface for the densable fix.
 */

/** Escape for HELP/UNIT text — densable `Dko` / OTEL `escapeString`. */
export function escapePrometheusCommentText(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

/**
 * Return the `# UNIT` fragment (including leading newline) or empty string.
 * Truthy unit only — matches densable `e.descriptor.unit ? … : ""`.
 */
export function formatPrometheusUnitLine(
  metricName: string,
  unit: string | null | undefined,
): string {
  if (!unit) {
    return ''
  }
  return `\n# UNIT ${metricName} ${escapePrometheusCommentText(unit)}`
}

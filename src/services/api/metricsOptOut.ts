/**
 * Organization metrics opt-out query — product-cut.
 * Official hits Anthropic /api/claude_code/organizations/metrics_enabled.
 * This fork never queries; BigQuery exporter is also a no-op.
 */

type MetricsStatus = {
  enabled: boolean
  hasError: boolean
}

export async function checkMetricsEnabled(): Promise<MetricsStatus> {
  return { enabled: false, hasError: false }
}

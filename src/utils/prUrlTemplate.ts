/**
 * densable prUrlTemplate residual (Abu / uot / P2e URL rewrite).
 *
 * settings.prUrlTemplate rewrites GitHub-style PR URLs for footer badges
 * and inline PR links. Placeholders: {host} {owner} {repo} {number} {url}.
 */

/** densable p0g — github-style https PR path. */
const PR_URL_RE =
  /^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/

export type ParsedPrUrl = {
  url: string
  host: string
  owner: string
  repo: string
  num: number
}

/** densable Abu — parse host/owner/repo/number from a PR https URL. */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const m = url.match(PR_URL_RE)
  if (!m) return null
  return {
    url,
    host: m[1]!,
    owner: m[2]!,
    repo: m[3]!,
    num: Number(m[4]),
  }
}

/**
 * densable uot — apply prUrlTemplate placeholders; return original URL when
 * template is unset/empty or the URL is not a github-style PR path.
 */
export function applyPrUrlTemplate(
  url: string,
  template: string | undefined | null,
): string {
  if (!template) return url
  const parsed = parsePrUrl(url)
  if (!parsed) return url
  return template
    .replaceAll('{host}', parsed.host)
    .replaceAll('{owner}', parsed.owner)
    .replaceAll('{repo}', parsed.repo)
    .replaceAll('{number}', String(parsed.num))
    .replaceAll('{url}', url)
}

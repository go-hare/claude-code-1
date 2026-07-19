/**
 * densable $gn / DHa — clickable footer link badges from AppState.footerLinks.
 */
import * as React from 'react'
import { Box, Link, Text } from '@anthropic/ink'
import { useAppState } from 'src/state/AppState.js'
import {
  type FooterLink,
  FOOTER_LINKS_MAX,
  visibleFooterLinks,
} from 'src/utils/footerLinks.js'
import type { Theme } from 'src/utils/theme.js'

function FooterLinkBadge({ link }: { link: FooterLink }): React.ReactNode {
  const color = link.color as keyof Theme | undefined
  const dim = !link.color
  const fallback = (
    <Text color={color} dimColor={dim}>
      {link.label}
    </Text>
  )
  return (
    <Box flexShrink={0}>
      {link.prefix !== undefined ? (
        <>
          <Text dimColor>{link.prefix}</Text>
          <Text> </Text>
        </>
      ) : null}
      <Link url={link.url} fallback={fallback}>
        <Text color={color} dimColor={dim} underline>
          {link.label}
        </Text>
      </Link>
    </Box>
  )
}

type Props = {
  /** densable excludeKeyed — hide PR/keyed pills (rendered elsewhere). */
  excludeKeyed?: boolean
}

/**
 * densable: only push FooterLinkBadges into Byline parts when this is true.
 * Returning null from the component is NOT enough — Byline joins on React
 * element identity (Children.toArray), so an empty badge still inserts " · ".
 */
export function useHasVisibleFooterLinks(excludeKeyed = false): boolean {
  const footerLinks = useAppState(s => s.footerLinks ?? [])
  return React.useMemo(
    () => visibleFooterLinks(footerLinks, { excludeKeyed }).length > 0,
    [footerLinks, excludeKeyed],
  )
}

export function FooterLinkBadges({
  excludeKeyed = false,
}: Props): React.ReactNode {
  const footerLinks = useAppState(s => s.footerLinks ?? [])
  const visible = React.useMemo(
    () => visibleFooterLinks(footerLinks, { excludeKeyed }),
    [footerLinks, excludeKeyed],
  )
  if (visible.length === 0) return null
  const shown =
    visible.length <= FOOTER_LINKS_MAX
      ? visible
      : visible.slice(0, FOOTER_LINKS_MAX)
  return (
    <>
      {shown.map((link, i) => (
        <React.Fragment key={link.key ?? link.url}>
          <FooterLinkBadge link={link} />
          {i < shown.length - 1 ? <Text dimColor> · </Text> : null}
        </React.Fragment>
      ))}
    </>
  )
}

/** densable: true when a keyed PR-style footer link is present. */
export function useHasKeyedFooterLink(key = 'pr'): boolean {
  const footerLinks = useAppState(s => s.footerLinks ?? [])
  return footerLinks.some(l => l.key === key)
}

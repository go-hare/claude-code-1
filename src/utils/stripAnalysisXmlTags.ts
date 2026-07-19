/**
 * densable kBy / x8e — strip analysis XML tag blocks (+ optional K0 / leading NL).
 *
 * densable kBy:
 *   `/<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs`
 *
 * densable x8e:
 *   `K0(e.replace(kBy,"")).replace(/^\n+/,"")`
 * where K0 = stripMemoryCitationTags (cc-memory).
 */

import { stripMemoryCitationTags } from './memoryCitation.js'

/** densable kBy. */
export const ANALYSIS_XML_TAGS_RE =
  /<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs

/**
 * densable kBy replace only (no K0).
 * Prefer this pure half when callers do not need memory-tag stripping.
 */
export function stripAnalysisXmlTags(content: string): string {
  return content.replace(ANALYSIS_XML_TAGS_RE, '')
}

/**
 * densable x8e pure half without K0: kBy + strip leading newlines.
 * Prefer densableX8e for full gold parity.
 */
export function stripAnalysisXmlTagsAndLeadingNewlines(content: string): string {
  return stripAnalysisXmlTags(content).replace(/^\n+/, '')
}

/**
 * densable x8e — full path used by markdown / isEmptyMessageText (iar).
 * Does NOT full-trim (trailing whitespace preserved); only leading `\n+`.
 */
export function densableX8e(content: string): string {
  return stripMemoryCitationTags(stripAnalysisXmlTags(content)).replace(
    /^\n+/,
    '',
  )
}

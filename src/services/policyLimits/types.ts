import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { sanitizeInvisibleText } from '../../utils/plugins/escapeSafeText.js'

export const DEFAULT_ARTIFACT_CREATE_NOTICE_TEXT =
  'Your organization requires a person to approve each new artifact.'

/**
 * Schema for the policy limits API response
 * Only blocked policies are included. If a policy key is absent, it's allowed.
 */
export const PolicyLimitsResponseSchema = lazySchema(() =>
  z.object({
    restrictions: z.record(z.string(), z.object({ allowed: z.boolean() })),
    artifact_create_notice: z
      .object({
        text: z
          .string()
          .transform(value =>
            sanitizeInvisibleText(value.slice(0, 500), ' ', {
              keepEmojiJoiners: true,
            })
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .pipe(z.string().min(1)),
      })
      .nullish()
      .catch({ text: DEFAULT_ARTIFACT_CREATE_NOTICE_TEXT }),
  }),
)

export type PolicyLimitsResponse = z.infer<
  ReturnType<typeof PolicyLimitsResponseSchema>
>

/**
 * Result of fetching policy limits
 */
export type PolicyLimitsFetchResult = {
  success: boolean
  restrictions?: PolicyLimitsResponse['restrictions'] | null // null means 304 Not Modified (cache is valid)
  artifactCreateNotice?: PolicyLimitsResponse['artifact_create_notice']
  etag?: string
  error?: string
  skipRetry?: boolean // If true, don't retry on failure (e.g., auth errors)
  /** densable `lastFetchOutcome.httpStatus` for `J()`. */
  httpStatus?: number
}

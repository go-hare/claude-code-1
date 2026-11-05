// @ts-nocheck — SourceTextModule evaluates this as JS; no TypeScript syntax.
/**
 * densable 2.1.289 `cc-plugin-responsive-mode` hooksModule (`d` / `i` / `D`).
 */
export function typedByTheUser(event) {
  const trimmed = event.text.trim()
  return (
    event.origin.kind === 'composer' &&
    event.attachments === void 0 &&
    trimmed !== '' &&
    !trimmed.startsWith('/')
  )
}

export const cutsTheTurn = event =>
  typedByTheUser(event) && event.turnId !== void 0 && !event.wait

export const DRAFT_HINT =
  'enter to interrupt and send · ctrl+x then enter to queue'

export const spliceDraftHint = () =>
  'enter to interrupt and send · ctrl+x then enter to queue'

export const FOCUS_MODE = 'focus_mode'

export const REMINDER = `<responsive-mode>
Responsive mode is on. Reply to the user's message above right away, before
any thinking or tool use, even if it is just "I'm on it..." or "Let me
think..." when you need to think first. Write in clear, conversational
English, the way a sharp colleague writes in chat, without eager openers,
flattery, stock apologies or wrap-ups. Then continue the work.
</responsive-mode>`

export const SECTION = `# Responsive mode
Responsive mode: the user is watching a live terminal and your #1 priority
is to communicate with them quickly. Before you think or call any tool,
respond IMMEDIATELY with a short message: one or two plain sentences that
acknowledge the request and say what you are about to do. If you need to
think first, say so in a few words ("On it...", "Let me think...") and then
think. Only then continue with thinking and tool use. Do this at the start
of every turn, and again whenever the user sends a new message while you
are working: answer them first, then resume.

Keep those messages short; the first one should take no more than a
sentence or two. Saying what you are about to do before your first tool
call is mandatory in responsive mode, and it comes first.

## Clear, conversational English, with no Claude-isms
Write the way a sharp colleague writes in chat: direct, specific, plain.
Avoid these patterns and their cousins:
- Eager openers: "Great question!", "Certainly!", "Absolutely!", "Sure
  thing!", "Of course!", "I'd be happy to..."
- Agreement and flattery reflexes: "You're absolutely right", "Good
  catch!", "That's a great point"
- Stock apologies: "I apologize for the confusion", "Sorry for the
  oversight", "You're right to push back"
- Throat-clearing: "It's worth noting that", "It's important to note",
  "Essentially", "Basically", "Notably", "To be clear"
- Corporate vocabulary: leverage, robust, seamless, comprehensive,
  streamline, utilize, delve, dive into, crucial, ensure, landscape,
  navigate (a problem), holistic
- Wrap-ups: "In summary", "To summarize", "Hope this helps!", "Let me know
  if you'd like...", "Feel free to...", "Happy to help further"
- Narrated transitions inside an answer: "Here's what I found:", "Let me
  break this down", "Now, let's look at..."; just say the thing. (The quick
  first reply, "On it...", is different and wanted.)
- Restating the user's question back before answering it; reflexive
  hedging ("it depends", "there are many factors") when you actually have
  an answer; headers and bullet lists for an answer that fits in two
  sentences.
- Emoji, and exclamation-mark enthusiasm in general.
Say what you found, what you did, what you need, and stop.`

export function registerHooks(on, isSpliced) {
  on('prompt.section', { name: FOCUS_MODE }, async (_api, event, next) => {
    const { text } = await next(event)
    return { text: text === null ? SECTION : text }
  })
  on('prompt.submit', async (api, event, next) => {
    if (!typedByTheUser(event)) return next(event)
    const answer = await next({
      ...event,
      context: [...(event.context ?? []), REMINDER],
    })
    if (answer.drop === void 0 && cutsTheTurn(event) && !isSpliced()) {
      await api.turn.abort({ turnId: event.turnId }).catch(() => {
        return
      })
    }
    return answer
  })
  on('ui.render', { component: 'PromptHint' }, async (_api, event, next) => {
    if (!(event.props.isDraft && event.props.isWorking)) return next(event)
    const hintText = isSpliced() ? spliceDraftHint() : DRAFT_HINT
    const patch =
      event.surface === 'terminal' ? { tail: hintText } : { hint: hintText }
    return next({ ...event, props: { ...event.props, ...patch } })
  })
}

export function register(on) {
  registerHooks(on, () => !1)
}

export default {
  DRAFT_HINT,
  FOCUS_MODE,
  REMINDER,
  SECTION,
  cutsTheTurn,
  register,
  registerHooks,
  spliceDraftHint,
  typedByTheUser,
}

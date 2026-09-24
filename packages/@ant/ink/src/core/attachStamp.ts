/**
 * densable 2.1.251 Won / Hlt / U$ / LGe / Rlt — daemon attach-stable wait.
 * Gold: official-251 SEA @189425400 export{Won,Hlt,U$,LGe,Rlt}.
 * MV() = CLAUDE_BG_BACKEND==="daemon". Bag is process-local (gold: WeakMap of G().host).
 */

class AttachStampBag {
  stampMs = 0
  detachedSinceLastAttach = false
  reset(): void {
    this.stampMs = 0
    this.detachedSinceLastAttach = false
  }
}

const bag = new AttachStampBag()

function isDaemonBgBackend(): boolean {
  return process.env.CLAUDE_BG_BACKEND === 'daemon'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** densable Won — stamp attach time; e===0 resets. */
export function stampAttachTime(e: number): void {
  if (e === 0) {
    bag.reset()
    return
  }
  if (bag.detachedSinceLastAttach || bag.stampMs === 0) bag.stampMs = e
  bag.detachedSinceLastAttach = false
}

/** densable Hlt — mark detached since last attach. */
export function markDetachedSinceLastAttach(): void {
  bag.detachedSinceLastAttach = true
}

/** densable U$. */
export function getAttachStampMs(): number {
  return bag.stampMs
}

/** densable LGe — true while daemon attach is still settling. */
export function isAttachUnstable(now: number): boolean {
  if (!isDaemonBgBackend()) return false
  const { detachedSinceLastAttach, stampMs } = bag
  return detachedSinceLastAttach || (stampMs !== 0 && now - stampMs < 500)
}

/** densable Rlt — wait until LGe(now) is false. */
export async function waitUntilAttachStable(): Promise<void> {
  for (;;) {
    const now = Date.now()
    if (!isAttachUnstable(now)) return
    const { detachedSinceLastAttach, stampMs } = bag
    const remaining =
      detachedSinceLastAttach || stampMs === 0 ? 500 : stampMs + 500 - now
    await sleep(Math.max(25, remaining) + 25)
  }
}

export function resetAttachStampForTests(): void {
  bag.reset()
}

/**
 * densable Artifact.checkPermissions — list_assets / read_asset / list_files /
 * read_file branch (2.1.289). Official `liveReplicas.workingCopyPath` and the
 * sibling hosts (`settleFileChange`, `liveFileEnded`, `pushHeldSaves`,
 * `heldSavesExitCleanup`) are `void 0` in the default state and have no
 * readers in the 2.1.289 binary, so refusals, live-copy pins and notes do
 * not apply. Do not assign those hosts.
 */
import { dirname } from 'path'
import {
  allPathsProtectedMessage,
  ARTIFACT_ASSET_TARGET_PIN,
  ARTIFACT_READ_ALL_PROTECTED_REASON,
  ARTIFACT_READ_BATCH_ON_LINE_MAX,
  assetReadPathCandidates,
  defaultArtifactFilesDir,
  isInArtifactScratchpad,
  isNetworkOrDevicePath,
  quotePublishedPath,
  type ReadFileBatchFile,
  readFileInputFields,
  resolveAssetOutTarget,
  resolveFileOutDest,
  resolveFileOutDests,
} from 'src/services/artifactAutoReact/outDirPaths.js'
import {
  Doe,
  dD,
  E7,
  Gtn,
  jtn,
  md,
  NPe,
  OP,
  qm,
  TE,
  vm,
  Wu,
  xAr,
  Yw,
  ztn,
} from 'src/services/artifactAutoReact/readPerm/consent.js'
import {
  AE,
  aKe,
  attestedGoneTypeRead,
  B5,
  fq,
  G0,
  hat,
  ine,
  jD,
  Oat,
  Pbe,
  Sh,
  Tu,
  v1,
  xct,
  xN,
  yt,
  zl,
} from 'src/services/artifactAutoReact/readPerm/provenance.js'
import {
  a_,
  artifactAskRuleNote,
  de,
  Ow,
  qR,
} from 'src/services/artifactAutoReact/readPerm/rules.js'
import {
  allSpellingsInScratchpadCarveOut,
  askSeverityRank,
  checkSaveDestinationWritePermission,
  isInScratchpadCarveOut,
  isSavePathInWorkingDirectories,
  packStashedSpellings,
  planReadFileBatch,
  type ReadFileBatchPlan,
  type SavePathSpellings,
  savePathSpellings,
  stashWritePermission,
} from 'src/services/artifactAutoReact/readPerm/savePaths.js'
import {
  isClassifierDecidingMode,
  isCoworkFrameWithoutConsentSurface,
  isPlanModeArtifactAsk,
  isPlanWithoutConsentSurface,
  isPromptingPermissionMode,
  isServerClassifierMode,
  isArtifactCopyFromOn,
  quotedList,
  shouldDropCircuitBreaker,
  sweptAskText,
  truncateAskPathMiddle,
} from 'src/services/artifactAutoReact/readPerm/surfaces.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import type {
  PermissionDecision,
  PermissionDecisionReason,
  PermissionResult,
  PermissionRule,
} from 'src/types/permissions.js'
import { parseArtifactUrlAnyCase } from 'src/utils/artifactUrl.js'
import { isStrictHumanTurnTail } from 'src/utils/turnTail.js'

type ReadAction = 'list_assets' | 'read_asset' | 'list_files' | 'read_file'
type ReadInput = Record<string, unknown> & { action: ReadAction }
type ReadInputFields = {
  url?: string
  path?: string
  paths?: unknown
  out_dir?: string
  asset_id?: string
}
type SafetyCheckReason = Extract<
  PermissionDecisionReason,
  { type: 'safetyCheck' }
>

const UNPRINTABLE = '(unprintable path)'

/** densable `cC(x).trim().replace(/[^.?!]$/,"$&.")` */
function sentence(text: string): string {
  return sweptAskText(text)
    .trim()
    .replace(/[^.?!]$/, '$&.')
}

function withoutRoutedBreaker(reason: SafetyCheckReason): SafetyCheckReason {
  return {
    ...reason,
    circuitBreaker: shouldDropCircuitBreaker(reason)
      ? undefined
      : reason.circuitBreaker,
  }
}

export function isArtifactReadAction(action: unknown): action is ReadAction {
  return (
    action === 'list_assets' ||
    action === 'read_asset' ||
    action === 'list_files' ||
    action === 'read_file'
  )
}

export async function checkArtifactReadPermissions(
  h: ReadInput,
  n: ToolUseContext,
): Promise<PermissionResult> {
  const { ArtifactTool } = await import('./ArtifactTool.js')
  const CE = ArtifactTool as unknown as Tool
  const iS = (
    permissions: ToolPermissionContext,
    walked: SavePathSpellings,
  ): PermissionDecision =>
    checkSaveDestinationWritePermission(CE, h, permissions, walked)

  const fields = h as ReadInputFields
  const Y = h.action === 'list_files' || h.action === 'read_file'
  const $e = Y ? 'files' : 'assets'
  const Me = typeof h.url === 'string' ? parseArtifactUrlAnyCase(h.url) : null
  if (Me === null) {
    return {
      behavior: 'deny',
      message: `This is not an artifact url Claude can read ${$e} from. Use the artifact url from the list or publish result.`,
      decisionReason: {
        type: 'safetyCheck',
        reason: `Unparseable artifact url \u2014 ownership cannot be probed for the ${Y ? 'file' : 'asset'} read`,
        classifierApprovable: false,
      },
    }
  }

  let Ke: string | undefined
  let Je: ReadFileBatchFile[] | undefined
  let Ze: string[] = []
  let Q: string[] = []
  let mt = 0
  let Tt = false
  let Lt = 0
  let Ft = false
  let gt: ReadFileBatchPlan['resolved'] = new Map()
  let ct: ReadFileBatchPlan['verdicts'] = new Map()
  let lt: string | undefined
  let St = false
  if (h.action === 'read_asset') {
    const target = resolveAssetOutTarget(fields)
    if (target === undefined) {
      return {
        behavior: 'deny',
        message:
          'read_asset needs a valid asset_id (32 hex characters), and out_dir, when given, must be a resolvable local path',
        decisionReason: {
          type: 'other',
          reason:
            'Asset read input has a missing or malformed asset_id, or an unresolvable out_dir',
        },
      }
    }
    Ke = target.stem
    lt = dirname(target.stem)
    St = target.defaultDir === true
  } else if (h.action === 'read_file') {
    const res =
      readFileInputFields(h).paths === undefined
        ? resolveFileOutDest(fields)
        : resolveFileOutDests(fields)
    if ('reason' in res) {
      return {
        behavior: 'deny',
        message: res.reason,
        decisionReason: {
          type: 'other',
          reason:
            'File read input has a missing, malformed or repeated path, too many paths, or an unresolvable out_dir',
        },
      }
    }
    if ('files' in res) {
      const plan = planReadFileBatch(res.files, {
        tool: CE,
        input: h,
        permissions: de(n),
      })
      if (plan === null) {
        return {
          behavior: 'deny',
          message: allPathsProtectedMessage(res.files.map(f => f.path)),
          decisionReason: {
            type: 'other',
            reason: ARTIFACT_READ_ALL_PROTECTED_REASON,
          },
        }
      }
      Ze = plan.aside
      Q = plan.ruleMatched
      mt = plan.rules
      Tt = plan.ruledAside
      Lt = plan.onLine
      Ft = plan.longOnLine
      gt = plan.resolved
      ct = plan.verdicts
      Je = res.files.filter(f => !Ze.includes(f.path))
    } else {
      Ke = res.dest
    }
    lt = res.base
    St = res.defaultDir === true
  }

  const Xt =
    Je !== undefined && (Lt > ARTIFACT_READ_BATCH_ON_LINE_MAX || Ft || Tt)
  const Rn =
    Q.length > 0
      ? `Your Edit ask ${mt > 1 ? 'rules cover' : 'rule covers'} ${quotedList(Q.map(p => truncateAskPathMiddle(sweptAskText(p).trim() || UNPRINTABLE, 256)))}.`
      : undefined
  const nn =
    Je !== undefined ? Je.map(f => f.dest) : Ke !== undefined ? [Ke] : []
  const Ln = (i: number, msg: string): string =>
    Je === undefined ? msg : `${quotePublishedPath(Je[i]?.path ?? '')}: ${msg}`
  const ir = nn.findIndex(d => isNetworkOrDevicePath(d))
  if (ir !== -1) {
    return {
      behavior: 'deny',
      message: Ln(
        ir,
        `${h.action} saves only to local directories \u2014 out_dir names a network path or cannot be resolved`,
      ),
      decisionReason: {
        type: 'other',
        reason: 'Artifact reads write only local, non-network paths',
      },
    }
  }

  const Er =
    h.action === 'read_asset' && Ke !== undefined
      ? assetReadPathCandidates(Ke)
      : []
  const Ls = nn.map(d => gt.get(d) ?? savePathSpellings(d))
  const Kn = Ls.map(w => w.spellings)
  const ks = Ke === undefined ? undefined : Kn[0]
  const hs = Er.map(p => savePathSpellings(p))
  const or = hs.map(w => w.spellings)
  const ps = Kn.length > 0 && allSpellingsInScratchpadCarveOut([...Kn, ...or])
  const pn = h.action === 'read_file' && nn.length > 0 && !ps
  const gn = pn && nn.some(d => isInArtifactScratchpad(d))
  const rs =
    gn && nn.some(d => isInArtifactScratchpad(d) && !isInScratchpadCarveOut(d))
  const ar = gn && !rs
  const Pr =
    h.action === 'read_asset' && !ps && nn.some(d => isInArtifactScratchpad(d))

  const ms = (
    permissions: ToolPermissionContext,
    verdicts?: ReadonlyMap<string, PermissionDecision>,
  ): PermissionDecision | undefined => {
    let worst: PermissionDecision | undefined
    for (const [i, walked] of Ls.entries()) {
      const r = verdicts?.get(nn[i] ?? '') ?? iS(permissions, walked)
      if (r.behavior === 'deny') return { ...r, message: Ln(i, r.message) }
      if (worst === undefined || askSeverityRank(r) > askSeverityRank(worst))
        worst = r
    }
    if (worst === undefined) return undefined
    let firstDeny: PermissionDecision | undefined
    let denies = 0
    for (const walked of hs) {
      const r = iS(permissions, walked)
      if (r.behavior === 'deny') {
        firstDeny ??= r
        denies++
      } else if (askSeverityRank(r) > askSeverityRank(worst)) {
        worst = r
      }
    }
    if (firstDeny !== undefined && denies === Er.length) return firstDeny
    return worst
  }

  const qs = ms(de(n), ct)
  if (qs?.behavior === 'deny') return qs
  if (Ke !== undefined && ks !== undefined) {
    stashWritePermission(n.toolUseId, Ke, ks)
  } else if (Je !== undefined && lt !== undefined) {
    stashWritePermission(n.toolUseId, lt, packStashedSpellings(nn, Kn))
  }

  const qr = a_(de(n), Me, h.url, 'deny')
  if (qr !== null) return qR(qr)
  await Tu(Me, n, h.action, { readBack: h.action === 'list_files' })
  if (Y && !ine(n, Me, zl(yt(Me.slug)))) {
    await hat(Me, { signal: n.abortController.signal })
  }
  const Kr = AE(Me, 'Nothing was read or changed')
  if (Kr !== null) return Kr

  const wn = yt(Me.slug)
  const Tn = zl(wn)
  const D = Tn && v1(wn) && !xN(wn)
  const K = Y && Tn && !D && B5(wn)
  const te = de(n)
  const pe = te.mode === 'plan'
  const Ie = Ow(te, Me, h.url, 'deny', { action: h.action })
  if (Ie !== null) return qR(Ie)
  const Ae = a_(te, Me, h.url, 'ask')
  const De = Pbe(Tn, Me)
  const rt = fq(n, Me.slug) ? Sh(Me.slug) : undefined
  const et = K && aKe(wn)
  const $t = Tn && !D && (!K || et)
  const ut = $t || ine(n, Me, Tn)
  const ht =
    Je !== undefined
      ? planReadFileBatch(Je, {
          tool: CE,
          input: h,
          permissions: te,
          resolved: gt,
        })
      : undefined
  if (ht === null || (ht !== undefined && ht.aside.length > 0)) {
    return {
      behavior: 'deny',
      message:
        'a file-edit check on one of these destinations changed while the read was being checked \u2014 nothing was read; retry the read',
      decisionReason: {
        type: 'other',
        reason:
          'A destination of this read drew the file-edit safety check, or an ask rule, only after the read was formed',
      },
    }
  }
  const zt = ms(te, ht?.verdicts)
  if (zt?.behavior === 'deny') return zt
  const Mt = zt?.behavior === 'ask' ? zt : undefined

  const qt = { [Wu]: false, [qm]: false, [OP]: false }
  const xn = St && ps
  const assetId = typeof h.asset_id === 'string' ? h.asset_id : undefined
  const pathField = readFileInputFields(h).path
  const pin = {
    action: h.action,
    slug: Me.slug,
    ...(h.action === 'read_asset' && { assetId, stem: Ke }),
    ...(h.action === 'read_file' &&
      (Je !== undefined
        ? {
            paths: Je.map(f => f.path),
            stems: Je.map(f => f.dest),
            ...(Ze.length > 0 && { skipped: Ze }),
          }
        : { path: pathField, stem: Ke })),
    ...(xn && Mt === undefined && { defaultDir: true }),
    ...(Ae !== null && { once: true }),
  }
  const Sn = {
    [ARTIFACT_ASSET_TARGET_PIN]: pin,
    ...(lt !== undefined && { out_dir: lt }),
  }
  const Et = Tn
    ? D
      ? 'cowritten'
      : 'from_type'
    : jD(wn)
      ? 'someone_else'
      : 'unknown'
  const He =
    Ke !== undefined
      ? truncateAskPathMiddle(
          sweptAskText(h.action === 'read_asset' ? `${Ke}.*` : Ke) ||
            UNPRINTABLE,
          1024,
        )
      : undefined
  const Ds =
    lt !== undefined
      ? truncateAskPathMiddle(sweptAskText(lt) || UNPRINTABLE, 1024)
      : undefined
  const As =
    (He !== undefined || Je !== undefined) &&
    (Mt !== undefined || (h.action === 'read_asset' ? !xn : pn))
  const Ir =
    h.action === 'read_file'
      ? truncateAskPathMiddle(
          sweptAskText(
            Je?.length === 1 ? (Je[0]?.path ?? '') : (pathField ?? ''),
          ).trim() || UNPRINTABLE,
          256,
        )
      : ''
  const Yr = (sfx: string): string =>
    Je !== undefined && Je.length > 1 && Ds !== undefined
      ? `save ${Je.length} files${sfx} to "${Ds}"`
      : rs || Ds === undefined
        ? `save a file${sfx} as "${He}"`
        : h.action === 'read_file'
          ? `save "${Ir}"${sfx} to "${Ds}"`
          : `save a file${sfx} to "${Ds}"`
  const Wo = nn.some(d => !isSavePathInWorkingDirectories(d, te))
  const dr =
    nn.length > 0 &&
    (h.action === 'read_file' ? rs || ar || (pn && Wo) : !ps && Wo)
  const ao = Kn.findIndex(sp => !allSpellingsInScratchpadCarveOut([sp]))
  const Bi = rs
    ? 'this published path carries a name the file-edit safety rules screen even inside the scratchpad (a git or bare-repository layout, hook, tool or agent configuration directories), so saving it needs the user\u2019s approval'
    : ar
      ? 'a link under the scratchpad resolves this destination outside its carve-out (elsewhere, or onto a name it screens), so saving there needs the user\u2019s approval'
      : defaultArtifactFilesDir(Me.slug) === null
        ? 'this session has no scratchpad directory, so every read_file save needs the user\u2019s approval'
        : 'read_file saves outside the session scratchpad only with the user\u2019s approval'

  if (md() && Ae === null && !dr && !isPlanModeArtifactAsk(n)) {
    const Ve = E7(Me, n, {
      status: wn,
      networkOff: Oat(Me),
      turnStartedByHuman: isStrictHumanTurnTail(n.messages),
      attested: fq(n, Me.slug) || attestedGoneTypeRead(n, Me.slug),
    })
    const held = Ve.ask && Ve.remember === 'artifact' && Doe(Ve, Me.slug, De)
    if (Mt === undefined || !Ve.ask || held) {
      const ot = vm(Me, n, wn?.title)
      const Ct = { ...h, ...qt, ...Sn, [TE]: ot }
      const os = dD({
        ruling: Ve,
        input: Ct,
        context: n,
        slug: Me.slug,
        display: ot,
        action: h.action,
        userOnly: De,
      })
      if (Mt === undefined || os.behavior !== 'allow') {
        return os.behavior === 'ask' &&
          Xt &&
          os.decisionReason?.type === 'safetyCheck'
          ? {
              ...os,
              decisionReason: {
                ...os.decisionReason,
                classifierApprovable: false,
              },
            }
          : os
      }
      const Wt = Mt.decisionReason
      const _n = $t ? undefined : ztn(Et, ot.title, As ? Yr('') : undefined)
      const Rs =
        $t && Je !== undefined
          ? `Let Claude ${Yr(` from ${ot.title !== undefined ? `"${ot.title}"` : 'this artifact'}`)}?`
          : undefined
      const Ss = [_n ?? Rs, Rn].filter(s => s !== undefined).join(' ')
      let decisionReason = Wt
      if (Wt?.type === 'safetyCheck') {
        decisionReason = {
          ...withoutRoutedBreaker(Wt),
          ...(_n !== undefined && { reason: `${Ss} ${sentence(Wt.reason)}` }),
          classifierApprovable: false,
        }
      }
      if (Wt === undefined && _n !== undefined) {
        decisionReason = { type: 'other', reason: Ss }
      }
      if (Xt && Wt?.type !== 'rule') {
        decisionReason = {
          ...(Wt?.type === 'safetyCheck' && withoutRoutedBreaker(Wt)),
          type: 'safetyCheck',
          reason:
            Wt?.type === 'safetyCheck' ? `${Ss} ${sentence(Wt.reason)}` : Ss,
          classifierApprovable: false,
        }
      }
      return {
        ...Mt,
        updatedInput: Ct,
        ...(Ss !== '' && { message: Ss }),
        ...(decisionReason !== undefined && { decisionReason }),
      }
    }
  }

  if (ut && Mt === undefined && !pn && Ae === null) {
    return {
      behavior: 'allow',
      updatedInput: { ...h, ...qt, ...Sn },
      decisionReason: {
        type: 'other',
        reason:
          Tn && !D && !K
            ? `Reading the user's own artifact ${$e}`
            : et
              ? "Reading the files of the user's own artifact made from a published first-party Artifact type needs no approval"
              : rt !== undefined
                ? `Reading the ${$e} of ${xct(rt)} needs no approval`
                : `Read of this artifact's ${$e} already approved this conversation`,
      },
    }
  }

  const pi =
    isPlanWithoutConsentSurface(n) || isCoworkFrameWithoutConsentSurface(n)
  if (
    pn &&
    (pi ||
      (isPromptingPermissionMode(n) &&
        te.shouldAvoidPermissionPrompts === true &&
        !isClassifierDecidingMode(te.mode)))
  ) {
    const tail =
      rs || ar || defaultArtifactFilesDir(Me.slug) === null
        ? 'this file cannot be saved here; other files can still be read, or the user can run this read where they can approve it.'
        : 'omit out_dir so the file lands under the scratchpad, where it can be read back.'
    return {
      behavior: 'deny',
      message: Ln(
        ao,
        `${Bi}, and no one can answer the prompt in this session \u2014 ${tail}`,
      ),
      decisionReason: {
        type: 'safetyCheck',
        reason:
          'A published file saved outside the session scratchpad carve-out requires a live human consent surface in this session',
        classifierApprovable: false,
      },
    }
  }
  if (h.action === 'read_asset' && dr && pi) {
    const outDir = typeof h.out_dir === 'string' ? h.out_dir : undefined
    return {
      behavior: 'deny',
      message: `read_asset saves outside this session\u2019s working folders and scratchpad only with the user\u2019s approval, and no one can answer the prompt in this session \u2014 ${outDir === undefined || outDir === '' ? 'this asset cannot be saved here; raise the read with the user in chat, or the user can run it where they can approve it.' : 'omit out_dir so the asset lands in this session\u2019s scratchpad folder for the artifact (the working directory when the session has none), or raise it with the user in chat.'}`,
      decisionReason: {
        type: 'safetyCheck',
        reason:
          'An asset saved outside the working folders and scratchpad requires a live human consent surface in this session',
        classifierApprovable: false,
      },
    }
  }
  if (!ut && (pi || (Ae === null && jtn(n, De)))) {
    const what = D
      ? `the ${$e} of this artifact, which a co-writer has also published to,`
      : K
        ? 'the files of this artifact, which come from an artifact type its publisher wrote,'
        : jD(wn)
          ? `someone else's artifact ${$e}`
          : `the ${$e} of an artifact whose ownership couldn't be confirmed`
    return {
      behavior: 'deny',
      message: `Reading or listing ${what} needs a consent surface, and no one can answer the prompt in this session \u2014 raise the read with the user in chat; do not retry it in this session.`,
      decisionReason: {
        type: 'safetyCheck',
        reason: `First reads of ${what} require a live human consent surface in this session`,
        classifierApprovable: false,
      },
    }
  }

  const pt = vm(Me, n, wn?.title)
  const Dn =
    h.action === 'read_asset' &&
    Ke !== undefined &&
    !ps &&
    !isSavePathInWorkingDirectories(Ke, te)
  const en = Mt?.decisionReason
  const jt: PermissionDecisionReason | undefined =
    en === undefined
      ? undefined
      : en.type === 'safetyCheck'
        ? {
            ...withoutRoutedBreaker(en),
            reason: sweptAskText(en.reason),
            classifierApprovable: false,
          }
        : en.type === 'rule' || en.type === 'mode'
          ? en
          : undefined
  const mi = [
    ...(rs
      ? [
          'That file name is one Claude Code protects (git, hook, tool, and agent settings).',
        ]
      : ar
        ? ["A link there leads outside this session's scratchpad."]
        : pn
          ? [
              defaultArtifactFilesDir(Me.slug) === null
                ? 'This session has no scratchpad, so every save asks you first.'
                : "That folder is outside this session's scratchpad.",
            ]
          : Dn
            ? ["That folder is outside this session's working folders."]
            : []),
    ...(en?.type === 'safetyCheck' && Mt?.message
      ? [sentence(Mt.message)]
      : []),
    ...(Rn !== undefined ? [Rn] : []),
    ...(Ae === null ? [] : [artifactAskRuleNote(Ae)]),
    ...(G0(wn) ? [Gtn] : []),
  ]
  const Xr = pt.title !== undefined ? `"${pt.title}"` : 'this artifact'
  const xi = !$t
    ? ztn(Et, pt.title, As ? Yr('') : undefined)
    : As
      ? `Let Claude ${Yr(` from ${Xr}`)}?`
      : `Let Claude read ${Xr}?`
  const Ks = (sfx: string): string => [xi, ...mi].join(' ') + sfx
  const is = isPromptingPermissionMode(n)
  const Hi = !ut && is
  const Ht: Extract<PermissionDecisionReason, { type: 'rule' }> | undefined =
    en?.type === 'rule' ? en : undefined
  const lo = (sfx: string): PermissionDecisionReason => ({
    type: 'safetyCheck',
    reason: Ks(sfx),
    classifierApprovable: false,
    ...(jt?.type === 'safetyCheck' &&
      jt.circuitBreaker !== undefined && { circuitBreaker: jt.circuitBreaker }),
  })
  const Or = pn || Dn
  const ja =
    te.servedCall === true ||
    (Or &&
      (ar || rs || Pr || Kn.some(sp => sp.length > 1)) &&
      isServerClassifierMode(te.mode))
  const co = (sfx: string): PermissionDecisionReason =>
    ((pe && (pn || !ut)) || (!pe && Or && ja) || (Xt && Ae === null)
      ? lo(sfx)
      : undefined) ??
    (Ae !== null ? { type: 'rule', rule: Ae } : undefined) ??
    (Hi ? undefined : Ht) ??
    ((!ut && De) || (pe && Dn) || (Hi && Ht !== undefined)
      ? lo(sfx)
      : undefined) ??
    (jt?.type === 'safetyCheck' ? { ...jt, reason: Ks(sfx) } : undefined) ??
    (Or
      ? { type: 'safetyCheck', reason: Ks(sfx), classifierApprovable: true }
      : undefined) ??
    (Hi ? undefined : jt) ?? { type: 'other', reason: Ks(sfx) }
  const gi = co('')
  const yi =
    gi.type === 'rule' ||
    gi.type === 'mode' ||
    (gi.type === 'safetyCheck' && gi.classifierApprovable === false)
  const Wi =
    Hi && Ae === null && (!isClassifierDecidingMode(te.mode) || yi)
      ? ` ${xAr(isArtifactCopyFromOn())}`
      : ''
  const uo = co(Wi)
  NPe(n, !ut && G0(wn) ? [Me.slug] : [], is)
  const Ba = {
    [ARTIFACT_ASSET_TARGET_PIN]: {
      ...pin,
      ...(!ut && yi && { userOnly: true }),
      ...(!ut &&
        isClassifierDecidingMode(te.mode) &&
        !yi && { classifier: true }),
    },
    ...(lt !== undefined && { out_dir: lt }),
  }
  const matchedAskRule: PermissionRule | undefined =
    Ae !== null ? Ae : Ht !== undefined && uo !== Ht ? Ht.rule : undefined
  return {
    behavior: 'ask',
    message: Ks(Wi),
    updatedInput: {
      ...h,
      ...Ba,
      [Wu]: (!ut || Ae !== null) && is,
      [qm]: !ut && pe,
      [OP]: !ut && (De || (Yw() && yi && is)),
      [TE]: pt,
    },
    ...(Mt && { suggestions: Mt.suggestions, blockedPath: Mt.blockedPath }),
    suppressAlwaysAllowRule: true,
    decisionReason: uo,
    ...(matchedAskRule !== undefined && { matchedAskRule }),
    localDisplayOnly: true,
  }
}

/**
 * densable eut / S3 / VSn / Yil / vUg / Jxs / Yxs / EFA (2.1.239).
 *
 * ConsentRow may only be constructed by these factories. Labels come from
 * gold renderLabel (EFA / Yxs) — do not invent "apply suggestions" copy.
 */
import React, { type ReactNode } from 'react';
import { stringWidth, Text } from '@anthropic/ink';
import type { PermissionUpdate } from '../types/permissions.js';
import { mcpInfoFromString } from '../services/mcp/mcpStringUtils.js';
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../utils/permissions/permissionRuleParser.js';
import { getOriginalCwd } from '../bootstrap/state.js';
import { toTildePath } from '../components/permissions/dontAskAgainLabel.js';
import { displaySanitizeChanged, hasWweChars } from '../utils/displaySanitize.js';
import type { PermissionMode } from '../types/permissions.js';
import { permissionUpdateSchema } from '../utils/permissions/PermissionUpdateSchema.js';

/** densable nYe / Ect / DKt / zce / sJ0 / SUg */
export const CONSENT_INTAKE_CAP = 64;
export const CONSENT_ITEM_CAP = 8;
export const CONSENT_LABEL_WIDTH_CAP = 160;
const DISPLAY_UNIT_CAP = 256;
const SESSION_LOCAL_DESTINATIONS = new Set(['localSettings', 'session']);
export const MONITOR_DISPLAYED_TYPES = new Set(['addRules']);
/** densable J0s */
export const SHELL_DISPLAYED_TYPES = new Set(['addRules', 'addDirectories']);
/** densable hhy — E$A standing addRules */
export const FILE_STANDING_DISPLAYED_TYPES = new Set(['addRules']);
/** densable Ts */
const READ_TOOL_NAME = 'Read';
/** densable S$A — Ubn sentinel so only Read rules survive file-family S3 */
export const FILE_FAMILY_NO_SHELL_TOOL = '(file family: no shell tool)';

/** densable a_A */
const SET_MODE_DISPLAY: Record<string, string> = {
  default: 'default (ask each time)',
  acceptEdits: 'accept edits (auto-approve file edits and common file commands)',
  auto: 'auto (no routine prompts; a reviewer model screens actions)',
  dontAsk: "don't ask (auto-deny anything that would prompt)",
  plan: 'plan mode (research and propose changes without making them)',
  bypassPermissions: 'BYPASS PERMISSIONS (no further prompts)',
};

const MINT_TOKEN = Symbol('ConsentRow mint token');

export class ConsentRow {
  readonly #minted = true;
  readonly node: ReactNode;
  readonly applies: readonly PermissionUpdate[];

  constructor(token: symbol, node: ReactNode, applies: readonly PermissionUpdate[]) {
    if (token !== MINT_TOKEN) {
      throw new Error('ConsentRow may only be constructed by the consentRows factories');
    }
    this.node = node;
    this.applies = applies;
    Object.freeze(this);
  }

  static is(value: unknown): value is ConsentRow {
    return typeof value === 'object' && value !== null && #minted in (value as ConsentRow);
  }
}

function so(text: string, cap: number): string {
  if (cap <= 0) return '';
  if (text.length <= cap) return text;
  const sliced = text.slice(0, cap);
  const last = sliced.charCodeAt(cap - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

/** densable BVe — So(e, zce) === e */
function isWithinDisplayCap(value: string): boolean {
  return so(value, DISPLAY_UNIT_CAP) === value;
}

/** densable pjt */
const INVALID_TOOL_NAME = '(invalid tool name)';

/** densable V8c.workflow — DPo("workflow") label */
export const WORKFLOW_AUTO_MODE_LABEL = 'Yes, and switch to auto mode';
/** densable V8c["exit-plan-resume"] — DPo("exit-plan-resume") */
export const EXIT_PLAN_RESUME_LABEL = 'Yes, and use auto mode';

/** densable DPo — ConsentRow with gold label and empty applies (l_A). */
export function mintWorkflowAutoModeRow(): ConsentRow {
  return new ConsentRow(MINT_TOKEN, WORKFLOW_AUTO_MODE_LABEL, []);
}

/** densable DPo("exit-plan-resume") */
export function mintExitPlanResumeRow(): ConsentRow {
  return new ConsentRow(MINT_TOKEN, EXIT_PLAN_RESUME_LABEL, []);
}

/** densable PYe */
export function mintSetModeRow(
  mode: PermissionMode,
  options?: {
    isBypassPermissionsModeAvailable?: boolean;
    labelVariant?: 'plan-keep-context';
  },
): ConsentRow | null {
  if (mode === 'bypassPermissions' && options?.isBypassPermissionsModeAvailable === false) {
    return null;
  }
  const frozen = parseAndFreezeUpdates([{ type: 'setMode', destination: 'session', mode }]);
  if (frozen === null) {
    throw new Error('setModeRow: schema rejected a designed setMode update');
  }
  if (options?.labelVariant === 'plan-keep-context') {
    const label =
      mode === 'acceptEdits' ? 'Yes, auto-accept edits' : mode === 'default' ? 'Yes, manually approve edits' : null;
    if (label === null) return null;
    return new ConsentRow(MINT_TOKEN, label, frozen);
  }
  const display = SET_MODE_DISPLAY[mode];
  if (display === undefined) return null;
  return new ConsentRow(
    MINT_TOKEN,
    <Text>
      Yes, and switch to <Text bold>{display}</Text> for this session
    </Text>,
    frozen,
  );
}

/** densable aJ0 — trim / empty / Wwe / _g / tab-nl / or===0. */
function isRejectedBareName(name: string): boolean {
  return (
    name.trim() !== name ||
    name === '' ||
    hasWweChars(name) ||
    displaySanitizeChanged(name) ||
    /[\t\n]/.test(name) ||
    stringWidth(name) === 0
  );
}

/** densable tWe */
function toolNameHasWildcard(name: string): boolean {
  return name.includes('*');
}

/** densable I4n / SFc — stringify then parse must equal the original rule. */
function isStablePermissionRule(rule: { toolName: string; ruleContent?: string }): boolean {
  try {
    const parsed = permissionRuleValueFromString(permissionRuleString(rule));
    return parsed.toolName === rule.toolName && parsed.ruleContent === rule.ruleContent;
  } catch {
    return false;
  }
}

/** densable YAe — _g(e)===e, no tab/nl, !Wwe; xUf is identity. */
export function sanitizeEditablePrefix(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (displaySanitizeChanged(value)) return undefined;
  if (/[\t\n\u2028\u2029]/.test(value)) return undefined;
  if (hasWweChars(value)) return undefined;
  return value;
}

/** densable $bn — pjt / aJ0 / round-trip / tWe / xw. Fail-closed on parse throw. */
export function isMintableBareToolName(name: string): boolean {
  if (name === INVALID_TOOL_NAME) return false;
  if (isRejectedBareName(name)) return false;
  try {
    const parsed = permissionRuleValueFromString(permissionRuleValueToString({ toolName: name }));
    if (parsed.toolName !== name || parsed.ruleContent !== undefined) {
      return false;
    }
  } catch {
    return false;
  }
  if (toolNameHasWildcard(name)) return false;
  const mcp = mcpInfoFromString(name);
  if (mcp !== null && !mcp.toolName) return false;
  return true;
}

function permissionRuleString(rule: { toolName: string; ruleContent?: string }): string {
  return permissionRuleValueToString(
    rule.ruleContent === undefined
      ? { toolName: rule.toolName }
      : { toolName: rule.toolName, ruleContent: rule.ruleContent },
  );
}

/** densable qPi — collapse ws; refuse join-ambiguous tokens (no Jil quotes). */
function displayToken(raw: string): string | null {
  const capped = so(raw, DISPLAY_UNIT_CAP);
  const collapsed = capped.replace(/\s+/g, ' ').trim();
  if (
    collapsed.includes(',') ||
    collapsed.includes(';') ||
    collapsed.includes(' and ') ||
    collapsed.startsWith('and ') ||
    collapsed.endsWith(' and') ||
    raw.length > DISPLAY_UNIT_CAP
  ) {
    return null;
  }
  return collapsed;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function deepFreezePlainData<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value === 'function') {
    throw new TypeError('deepFreezePlainData: function in mint input — plain data only');
  }
  if (value !== null && typeof value === 'object') {
    const cached = seen.get(value as object);
    if (cached !== undefined) return cached as T;
    const proto = Object.getPrototypeOf(value);
    const plain = Array.isArray(value) ? proto === Array.prototype : proto === Object.prototype || proto === null;
    if (!plain) {
      throw new TypeError('deepFreezePlainData: non-plain prototype in mint input — plain data only');
    }
    const clone: unknown = Array.isArray(value) ? [] : {};
    seen.set(value as object, clone);
    if (Array.isArray(value)) {
      const out = clone as unknown[];
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) {
          throw new TypeError('mintDisplayedUpdates: sparse mint input — plain data only');
        }
        out.push(deepFreezePlainData(value[i], seen));
      }
    } else {
      const out = clone as Record<string, unknown>;
      for (const key of Object.keys(value as object)) {
        out[key] = deepFreezePlainData((value as Record<string, unknown>)[key], seen);
      }
    }
    return Object.freeze(clone) as T;
  }
  return value;
}

/** densable Yil */
export function mintDisplayedUpdates(updates: PermissionUpdate[]): readonly PermissionUpdate[] {
  if (Object.getPrototypeOf(updates) !== Array.prototype) {
    throw new TypeError('mintDisplayedUpdates: non-plain array in mint input — plain data only');
  }
  if (!Number.isSafeInteger(updates.length) || updates.length < 0) {
    throw new TypeError('mintDisplayedUpdates: non-integer length in mint input — plain data only');
  }
  const next: PermissionUpdate[] = [];
  for (let i = 0; i < updates.length; i++) {
    if (!(i in updates)) {
      throw new TypeError('mintDisplayedUpdates: sparse mint input — plain data only');
    }
    next.push(deepFreezePlainData(updates[i]!));
  }
  return Object.freeze(next);
}

/** densable VSn */
export function parseAndFreezeUpdates(updates: unknown[]): readonly PermissionUpdate[] | null {
  if (updates.length > CONSENT_INTAKE_CAP) return null;
  const parsed: PermissionUpdate[] = [];
  for (const item of updates) {
    let result: ReturnType<ReturnType<typeof permissionUpdateSchema>['safeParse']>;
    try {
      result = permissionUpdateSchema().safeParse(item);
    } catch {
      return null;
    }
    if (!result.success) return null;
    parsed.push(result.data);
  }
  return mintDisplayedUpdates(parsed);
}

/** densable $Oo / EMs 4th arg */
export type ShellPermissionAnswerExtras = {
  feedback?: string;
  editablePrefix?: string;
  editablePrefixSeed?: string;
};

/** densable Xxs — prefix-edited ConsentRow. Seed must already be YAe-stable. */
export function mintPrefixConsentRow(seed: unknown, edited: unknown, toolName: string): ConsentRow | null {
  if (typeof seed !== 'string' || sanitizeEditablePrefix(seed) !== seed) {
    return null;
  }
  if (typeof edited !== 'string') return null;
  const trimmed = edited.trim();
  if (trimmed === '' || sanitizeEditablePrefix(trimmed) !== trimmed) {
    return null;
  }
  if (trimmed === '*') {
    if (!isMintableBareToolName(toolName)) return null;
    const frozen = parseAndFreezeUpdates([
      {
        type: 'addRules',
        rules: [{ toolName }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ]);
    if (frozen === null) return null;
    return new ConsentRow(MINT_TOKEN, `Yes, and don\u2019t ask again for any ${toolName} command`, frozen);
  }
  if (!isMintableBareToolName(toolName) || !isStablePermissionRule({ toolName, ruleContent: trimmed })) {
    return null;
  }
  const frozen = parseAndFreezeUpdates([
    {
      type: 'addRules',
      rules: [{ toolName, ruleContent: trimmed }],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ]);
  if (frozen === null) return null;
  return new ConsentRow(MINT_TOKEN, `Yes, and don\u2019t ask again for: ${trimmed}`, frozen);
}

/** densable iJ0 — structural + $bn on bare names + SFc on ruleContent. */
function sanitizeUpdateRules(updates: PermissionUpdate[]): PermissionUpdate[] {
  const out: PermissionUpdate[] = [];
  for (const update of updates) {
    if (update.type !== 'addRules') {
      out.push(update);
      continue;
    }
    if (!Array.isArray(update.rules)) continue;
    const rules = update.rules.filter(rule => {
      if (rule === null || typeof rule !== 'object') return false;
      if (typeof rule.toolName !== 'string') return false;
      if (rule.ruleContent !== undefined && typeof rule.ruleContent !== 'string') {
        return false;
      }
      return rule.ruleContent === undefined
        ? isMintableBareToolName(rule.toolName)
        : isStablePermissionRule({ toolName: rule.toolName, ruleContent: rule.ruleContent });
    });
    if (rules.length > 0) out.push({ ...update, rules });
  }
  return out;
}

export type ConsentDisplayOptions = {
  displayedTypes: Set<string>;
  renderLabel: (updates: readonly PermissionUpdate[]) => ReactNode;
  labelPredicate?: (rule: { toolName: string; ruleContent?: string }) => boolean;
};

/** densable vUg */
function filterDisplayedUpdates(
  updates: PermissionUpdate[],
  displayedTypes: Set<string>,
  labelPredicate?: ConsentDisplayOptions['labelPredicate'],
): PermissionUpdate[] {
  const gated = sanitizeUpdateRules(updates).filter(update => {
    if (!displayedTypes.has(update.type)) return false;
    if (
      (update.type === 'addRules' || update.type === 'replaceRules' || update.type === 'removeRules') &&
      update.behavior !== 'allow'
    ) {
      return false;
    }
    return update.destination !== undefined && SESSION_LOCAL_DESTINATIONS.has(update.destination);
  });
  const out: PermissionUpdate[] = [];
  for (const update of gated) {
    if (update.type !== 'addRules') {
      if (update.type === 'addDirectories') {
        if (!Array.isArray(update.directories)) continue;
        const directories = update.directories.filter(
          dir => typeof dir === 'string' && dir.trim() !== '' && stringWidth(dir) > 0 && isWithinDisplayCap(dir),
        );
        if (directories.length === 0) continue;
        out.push({ ...update, directories });
        continue;
      }
      out.push(update);
      continue;
    }
    if (update.rules === undefined) continue;
    const rules = update.rules.filter(rule => {
      try {
        return isWithinDisplayCap(permissionRuleString(rule));
      } catch {
        return false;
      }
    });
    const kept = labelPredicate === undefined ? rules : rules.filter(labelPredicate);
    if (kept.length > 0) out.push({ ...update, rules: kept });
  }
  return out;
}

/** densable S3 */
export function mintConsentRow(suggestions: unknown, options: ConsentDisplayOptions): ConsentRow | null {
  if (!Array.isArray(suggestions)) return null;
  let length: unknown;
  try {
    length = suggestions.length;
  } catch {
    return null;
  }
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > CONSENT_INTAKE_CAP) {
    return null;
  }
  let elementCount = 0;
  const copies: unknown[] = [];
  for (let i = 0; i < length; i++) {
    try {
      const raw = suggestions[i];
      const copy: unknown = raw !== null && typeof raw === 'object' ? { ...raw } : raw;
      let skip = false;
      if (copy !== null && typeof copy === 'object') {
        const record = copy as Record<string, unknown>;
        for (const key of ['rules', 'directories'] as const) {
          const list = record[key];
          if (!Array.isArray(list)) continue;
          const size = list.length;
          if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
            skip = true;
            break;
          }
          elementCount += size;
          if (elementCount > CONSENT_INTAKE_CAP * CONSENT_ITEM_CAP) return null;
          record[key] = [...list];
        }
      }
      if (skip) continue;
      copies.push(copy);
    } catch {
      // gold continues on per-item throw
    }
  }
  const parsed: PermissionUpdate[] = [];
  for (const item of copies) {
    let result: ReturnType<ReturnType<typeof permissionUpdateSchema>['safeParse']>;
    try {
      result = permissionUpdateSchema().safeParse(item);
    } catch {
      continue;
    }
    if (result.success) parsed.push(result.data);
  }
  if (parsed.length === 0) return null;
  const displayed = filterDisplayedUpdates(parsed, options.displayedTypes, options.labelPredicate);
  if (displayed.length === 0) return null;
  const frozen = mintDisplayedUpdates(displayed);
  const label = options.renderLabel(frozen);
  if (label == null || typeof label === 'boolean' || label === '') return null;
  return new ConsentRow(MINT_TOKEN, label, frozen);
}

/** densable txt */
function boldList(items: string[]): ReactNode {
  if (items.length === 0) return '';
  if (items.length === 1) return <Text bold>{items[0]}</Text>;
  if (items.length === 2) {
    return (
      <Text>
        <Text bold>{items[0]}</Text> and <Text bold>{items[1]}</Text>
      </Text>
    );
  }
  return (
    <Text>
      {items.slice(0, -1).map((item, index) => (
        <Text key={index}>
          <Text bold>{item}</Text>,{' '}
        </Text>
      ))}
      and <Text bold>{items.at(-1)}</Text>
    </Text>
  );
}

/** densable EFc */
function stripShellRuleSuffix(ruleContent: string): string {
  if (ruleContent.endsWith(':*') || ruleContent.endsWith(' *')) {
    return ruleContent.slice(0, -2);
  }
  return ruleContent;
}

/** densable Fbn — no eKu invent. */
function stripReadRulePath(ruleContent: string): string {
  return (ruleContent.replace(/\/\*\*$/, '') || '').replace(/^\.\//, '').replace(/^\/\//, '/');
}

/** densable wFc — command list; not the 50-char DualInk "similar" truncate. */
function shellCommandList(items: string[]): ReactNode {
  if (items.length === 0) return '';
  if (items.length === 1) return <Text bold>{items[0]}</Text>;
  if (items.length === 2) {
    return (
      <Text>
        <Text bold>{items[0]}</Text> and <Text bold>{items[1]}</Text>
      </Text>
    );
  }
  return (
    <Text>
      <Text bold>{items.slice(0, -1).join(', ')}</Text>, and <Text bold>{items.at(-1)}</Text>
    </Text>
  );
}

/** densable Ubn */
export function isShellConsentLabelRule(
  rule: { toolName: string; ruleContent?: string },
  shellToolName: string,
  commandTransform?: (command: string) => string,
): boolean {
  if (rule.toolName === shellToolName) {
    const prefix = stripShellRuleSuffix(rule.ruleContent ?? '');
    if (!prefix) return false;
    return Boolean(commandTransform ? commandTransform(prefix) : prefix);
  }
  if (rule.toolName === READ_TOOL_NAME) {
    return Boolean(rule.ruleContent && stripReadRulePath(rule.ruleContent));
  }
  return false;
}

/** densable Z0s — jNA/lUA renderLabel. xYr NFC disambiguation invent-ban. */
export function renderShellSuggestionsLabel(
  updates: readonly PermissionUpdate[],
  shellToolName: string,
  commandTransform?: (command: string) => string,
): ReactNode {
  if (!Array.isArray(updates) || updates.length > CONSENT_INTAKE_CAP) return null;
  if (updates.some(item => item === null || typeof item !== 'object')) return null;
  const rules = updates.filter(update => update.type === 'addRules').flatMap(update => update.rules || []);
  const directories = updates
    .filter(update => update.type === 'addDirectories')
    .flatMap(update => (Array.isArray(update.directories) ? update.directories : []));
  if (
    rules.some(
      rule =>
        rule === null ||
        typeof rule !== 'object' ||
        typeof rule.toolName !== 'string' ||
        (rule.ruleContent !== undefined && typeof rule.ruleContent !== 'string'),
    )
  ) {
    return null;
  }
  if (rules.length + directories.length > CONSENT_ITEM_CAP) return null;
  if (
    directories.some(
      dir => typeof dir !== 'string' || dir.trim() === '' || stringWidth(dir) === 0 || !isWithinDisplayCap(dir),
    )
  ) {
    return null;
  }
  const uniqueDirs = unique(directories);
  const readPaths = unique(
    rules.flatMap(rule =>
      rule.toolName === READ_TOOL_NAME && rule.ruleContent && stripReadRulePath(rule.ruleContent)
        ? [rule.ruleContent]
        : [],
    ),
  );
  if (readPaths.some(path => !isWithinDisplayCap(path))) return null;
  const shellContents = unique(
    rules.flatMap(rule => {
      if (rule.toolName !== shellToolName || !rule.ruleContent) return [];
      return stripShellRuleSuffix(rule.ruleContent) ? [rule.ruleContent] : [];
    }),
  );
  if (shellContents.some(content => !isWithinDisplayCap(content))) return null;

  const commandTokens: string[] = [];
  for (const content of shellContents) {
    const stripped = stripShellRuleSuffix(content) || content;
    const token = displayToken(commandTransform ? commandTransform(stripped) : stripped);
    if (token === null) return null;
    commandTokens.push(token);
  }
  const pathTokens: string[] = [];
  for (const path of readPaths) {
    const token = displayToken(stripReadRulePath(path));
    if (token === null) return null;
    pathTokens.push(token);
  }
  const dirTokens: string[] = [];
  for (const dir of uniqueDirs) {
    const token = displayToken(dir);
    if (token === null) return null;
    dirTokens.push(token);
  }
  if (stringWidth([...commandTokens, ...pathTokens, ...dirTokens].join(' and ')) > CONSENT_LABEL_WIDTH_CAP) {
    return null;
  }

  const hasDirs = uniqueDirs.length > 0;
  const hasReads = pathTokens.length > 0;
  const hasCommands = commandTokens.length > 0;
  if (hasReads && !hasDirs && !hasCommands) {
    return <Text>Yes, allow reading from {boldList(pathTokens)} from this project</Text>;
  }
  if (hasDirs && !hasReads && !hasCommands) {
    return <Text>Yes, and always allow access to {boldList(dirTokens)} from this project</Text>;
  }
  if (hasCommands && !hasDirs && !hasReads) {
    return (
      <Text>
        Yes, and don't ask again for {shellCommandList(commandTokens)} commands in{' '}
        <Text bold>{toTildePath(getOriginalCwd())}</Text>
      </Text>
    );
  }
  if ((hasDirs || hasReads) && !hasCommands) {
    return <Text>Yes, and always allow access to {boldList([...dirTokens, ...pathTokens])} from this project</Text>;
  }
  if ((hasDirs || hasReads) && hasCommands) {
    const paths = [...dirTokens, ...pathTokens];
    if (paths.length === 1 && commandTokens.length === 1) {
      return (
        <Text>
          Yes, and allow access to {boldList(paths)} and {shellCommandList(commandTokens)} commands
        </Text>
      );
    }
    return (
      <Text>
        Yes, and allow {boldList(paths)} access and {shellCommandList(commandTokens)} commands
      </Text>
    );
  }
  return null;
}

/** densable EFA — monitor addRules label. */
export function renderMonitorSuggestionsLabel(updates: readonly PermissionUpdate[]): ReactNode {
  const rules = updates.filter(update => update.type === 'addRules').flatMap(update => update.rules);
  if (rules.length === 0 || rules.length > CONSENT_ITEM_CAP) return null;
  let rendered: string[];
  try {
    rendered = rules.map(rule => permissionRuleString(rule));
  } catch {
    return null;
  }
  const tokens: string[] = [];
  for (const item of unique(rendered)) {
    const token = displayToken(item);
    if (token === null) return null;
    tokens.push(token);
  }
  if (stringWidth(tokens.join(' and ')) > CONSENT_LABEL_WIDTH_CAP) return null;
  return <Text>Yes, and don't ask again for {boldList(tokens)}</Text>;
}

/** densable wUg */
function mintableDirectory(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (stringWidth(value) === 0 || !isWithinDisplayCap(value)) return null;
  return value;
}

/** densable w$A — E$A Read standing label. xYr NFC invent-ban. */
export function renderFileReadStandingLabel(updates: readonly PermissionUpdate[]): ReactNode {
  const rules = updates.filter(update => update.type === 'addRules').flatMap(update => update.rules || []);
  if (rules.length === 0 || rules.length > CONSENT_ITEM_CAP) return null;
  const paths: string[] = [];
  for (const rule of rules) {
    if (rule.toolName !== READ_TOOL_NAME || rule.ruleContent === undefined) return null;
    const stripped = stripReadRulePath(rule.ruleContent);
    if (!stripped || !isWithinDisplayCap(rule.ruleContent)) return null;
    paths.push(rule.ruleContent);
  }
  const uniquePaths = unique(paths);
  const tokens: string[] = [];
  for (const path of uniquePaths) {
    const token = displayToken(stripReadRulePath(path));
    if (token === null) return null;
    tokens.push(token);
  }
  if (stringWidth(tokens.join(' and ')) > CONSENT_LABEL_WIDTH_CAP) return null;
  return <Text>Yes, allow reading from {boldList(tokens)} during this session</Text>;
}

/** densable Yxs */
export function mintAddDirectoriesRow(directories: unknown): ConsentRow | null {
  if (!Array.isArray(directories)) return null;
  let length: unknown;
  try {
    length = directories.length;
  } catch {
    return null;
  }
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > CONSENT_INTAKE_CAP) {
    return null;
  }
  const collected: string[] = [];
  for (let i = 0; i < length; i++) {
    try {
      const dir = mintableDirectory(directories[i]);
      if (dir !== null) collected.push(dir);
    } catch {
      // gold continues
    }
  }
  const uniqueDirs = unique(collected);
  if (uniqueDirs.length === 0 || uniqueDirs.length > CONSENT_ITEM_CAP) return null;
  const tokens: string[] = [];
  for (const dir of uniqueDirs) {
    const token = displayToken(dir);
    if (token === null) return null;
    tokens.push(token);
  }
  if (stringWidth(tokens.join(', ')) > CONSENT_LABEL_WIDTH_CAP) return null;
  const frozen = parseAndFreezeUpdates([
    {
      type: 'addDirectories',
      destination: 'session',
      directories: uniqueDirs,
    },
  ]);
  if (frozen === null) return null;
  return new ConsentRow(
    MINT_TOKEN,
    <Text>
      Yes, and always allow access to <Text bold>{tokens.join(', ')}</Text>
      {' for this session'}
    </Text>,
    frozen,
  );
}

/** densable Jxs */
export function combineConsentRows(first: ConsentRow, ...rest: ConsentRow[]): ConsentRow {
  const rows = [first, ...rest];
  for (const row of rows) {
    if (!ConsentRow.is(row)) {
      throw new Error('combineRows accepts only constructor-produced ConsentRows');
    }
  }
  const applies = rows.flatMap(row => [...row.applies]);
  if (applies.length > CONSENT_INTAKE_CAP) {
    throw new Error('combineRows: combined updates exceed the display intake cap');
  }
  const frozen = parseAndFreezeUpdates(applies);
  if (frozen === null) {
    throw new Error('combineRows: schema rejected already-minted updates');
  }
  return new ConsentRow(
    MINT_TOKEN,
    <Text>
      {rows.map((row, index) => (
        <Text key={index}>
          {index > 0 ? '; ' : ''}
          {row.node}
        </Text>
      ))}
    </Text>,
    frozen,
  );
}

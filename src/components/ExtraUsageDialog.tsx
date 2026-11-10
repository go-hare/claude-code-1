/**
 * Official 2.1.207 ExtraUsageDialog (vfo / aud) — inline usage-credits UI.
 * Covers enable (setup_overage_billing), buy (tax preview + commit poll / 3DS
 * message), limit, auto-reload; browser fallback on hard failure / missing card.
 * Org-admin-only request paths remain web-only.
 */

import { Box, Dialog, LoadingState, ProgressBar, Ratchet, Text } from '@anthropic/ink';
import React, { useCallback, useEffect, useState } from 'react';
import {
  formatUsageCreditAmountInput,
  parseUsageCreditAmount,
} from '../commands/extra-usage/parseUsageCreditAmount.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { fetchUtilization, type ExtraUsage } from '../services/api/usage.js';
import {
  buildCredits3dsFallbackMessage,
  classifyCreditsPurchaseOutcome,
  defaultBundlesFromPresets,
  enableOverageUnlimited,
  fetchAutoReloadSettings,
  fetchPaymentMethod,
  fetchPrepaidBalance,
  fetchPrepaidBundles,
  fetchTaxPreview,
  formatSpendLimitUpdateFailedMessage,
  type PaymentMethod,
  type PrepaidBundle,
  pollPurchaseUntilSettled,
  purchaseCredits,
  type TaxPreview,
  USAGE_CREDITS_SETTINGS_URL,
  updateAutoReloadSettings,
  updateSpendLimit,
} from '../services/api/usageCredits.js';
import { openBrowser } from '../utils/browser.js';
import { errorMessage } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { ConfirmSelect } from './ConfirmSelect.js';
import { Select } from './CustomSelect/index.js';
import TextInput from './TextInput.js';

// TextInput requires columns + cursor offset; keep local helpers tiny.

type Step =
  | { s: 'loading' }
  | { s: 'menu' }
  | { s: 'enable_confirm' }
  | { s: 'buy_select' }
  | { s: 'buy_custom' }
  | {
      s: 'buy_confirm';
      cents: number;
      bundle?: PrepaidBundle;
      tax?: TaxPreview | null;
      taxLoading?: boolean;
    }
  | { s: 'buy_working' }
  | { s: 'limit_input' }
  | { s: 'limit_confirm'; cents: number | null }
  | { s: 'auto_reload' }
  | { s: 'message'; text: string }
  | { s: 'error'; text: string };

type Props = {
  onDone: (result?: string) => void;
  /** When true, show rename notice for /extra-usage alias. */
  renamedFromExtraUsage?: boolean;
};

function formatCents(cents: number, currency = 'USD'): string {
  const amount = formatUsageCreditAmountInput(cents);
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

export function ExtraUsageDialog(props: Props): React.ReactNode {
  return (
    <Ratchet>
      <ExtraUsageDialogInner {...props} />
    </Ratchet>
  );
}

function ExtraUsageDialogInner({ onDone, renamedFromExtraUsage = false }: Props): React.ReactNode {
  const { columns } = useTerminalSize();
  const [step, setStep] = useState<Step>({ s: 'loading' });
  const [extraUsage, setExtraUsage] = useState<ExtraUsage | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [bundles, setBundles] = useState<PrepaidBundle[]>([]);
  const [autoReloadEnabled, setAutoReloadEnabled] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [limitAmount, setLimitAmount] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [limitCursor, setLimitCursor] = useState(0);

  const load = useCallback(async () => {
    setStep({ s: 'loading' });
    try {
      const [util, balance, payment, apiBundles, auto] = await Promise.all([
        fetchUtilization().catch(() => null),
        fetchPrepaidBalance(),
        fetchPaymentMethod(),
        fetchPrepaidBundles(),
        fetchAutoReloadSettings(),
      ]);
      const eu = util?.extra_usage ?? null;
      setExtraUsage(eu);
      const bal = typeof balance?.balance_minor_units === 'number' ? balance.balance_minor_units : null;
      setBalanceCents(bal);
      if (typeof balance?.currency === 'string' && balance.currency) {
        setCurrency(balance.currency);
      }
      setBundles(apiBundles.length > 0 ? apiBundles : defaultBundlesFromPresets());
      setAutoReloadEnabled(auto?.enabled === true);
      setPaymentMethod(payment);
      setStep({ s: 'menu' });
    } catch (e) {
      logError(e as Error);
      setStep({
        s: 'error',
        text: `Couldn't load usage credit status: ${errorMessage(e)}`,
      });
    }
  }, []);

  const requireChargeableCard = useCallback((): boolean => {
    if (paymentMethod?.has_chargeable_saved_payment_method === false) {
      setStep({
        s: 'error',
        text: 'No card on file — add a payment method at claude.ai/settings/usage',
      });
      return false;
    }
    return true;
  }, [paymentMethod]);

  const beginBuyConfirm = useCallback(
    async (cents: number, bundle?: PrepaidBundle) => {
      setStep({ s: 'buy_confirm', cents, bundle, taxLoading: true });
      const tax = await fetchTaxPreview({
        priceMinorUnits: cents,
        currency,
        productId: bundle?.id || null,
      });
      setStep({ s: 'buy_confirm', cents, bundle, tax, taxLoading: false });
    },
    [currency],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openWebFallback = useCallback(async () => {
    const url = 'https://claude.ai/settings/usage';
    try {
      await openBrowser(url);
      onDone(`Opened ${url}`);
    } catch {
      onDone(`Open ${url} to manage usage credits`);
    }
  }, [onDone]);

  if (step.s === 'loading') {
    return (
      <Dialog title="Usage credits" color="suggestion" onCancel={() => onDone()}>
        <LoadingState message="Loading usage credit status…" />
      </Dialog>
    );
  }

  if (step.s === 'error') {
    return (
      <Dialog title="Usage credits" color="error" onCancel={() => onDone()}>
        <Box flexDirection="column" gap={1}>
          <Text color="error">{step.text}</Text>
          <Select
            options={[
              { value: 'retry', label: 'Retry' },
              { value: 'browser', label: 'Open claude.ai/settings/usage' },
              { value: 'cancel', label: 'Cancel' },
            ]}
            onChange={v => {
              if (v === 'retry') void load();
              else if (v === 'browser') void openWebFallback();
              else onDone();
            }}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'message') {
    return (
      <Dialog title="Usage credits" color="suggestion" onCancel={() => onDone(step.text)}>
        <Box flexDirection="column" gap={1}>
          <Text>{step.text}</Text>
          <Select options={[{ value: 'ok', label: 'Done' }]} onChange={() => onDone(step.text)} />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'enable_confirm') {
    return (
      <Dialog title="Turn on usage credits" color="suggestion" onCancel={() => setStep({ s: 'menu' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Keep using Claude when you hit a limit. This enables extra usage billing for your account.</Text>
          <ConfirmSelect
            hideIndexes
            confirmLabel="Turn on usage credits"
            cancelLabel="Cancel"
            focus="cancel"
            onConfirm={() => {
              void (async () => {
                try {
                  await enableOverageUnlimited();
                  setStep({
                    s: 'message',
                    text: 'Usage credits turned on (unlimited monthly cap). Adjust the limit anytime.',
                  });
                } catch (e) {
                  setStep({
                    s: 'error',
                    text: `Couldn't turn on usage credits: ${errorMessage(e)}`,
                  });
                }
              })();
            }}
            onCancel={() => setStep({ s: 'menu' })}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'buy_select') {
    const opts = [
      ...bundles.map((b, i) => {
        const cents = b.local_credit_minor_units ?? b.credit_minor_units;
        return {
          value: `b:${i}`,
          label: formatCents(cents, currency),
        };
      }),
      { value: 'custom', label: 'Custom amount…' },
      { value: 'back', label: 'Back' },
    ];
    return (
      <Dialog title="Buy usage credits" color="suggestion" onCancel={() => setStep({ s: 'menu' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Buy usage credits for this organization.</Text>
          <Select
            options={opts}
            visibleOptionCount={opts.length}
            onChange={v => {
              if (v === 'back') setStep({ s: 'menu' });
              else if (v === 'custom') {
                if (!requireChargeableCard()) return;
                setCustomAmount('');
                setCursorOffset(0);
                setStep({ s: 'buy_custom' });
              } else if (v.startsWith('b:')) {
                if (!requireChargeableCard()) return;
                const idx = Number(v.slice(2));
                const b = bundles[idx];
                if (b) {
                  const cents = b.local_credit_minor_units ?? b.credit_minor_units;
                  void beginBuyConfirm(cents, b);
                }
              }
            }}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'buy_custom') {
    return (
      <Dialog title="Custom amount" color="suggestion" onCancel={() => setStep({ s: 'buy_select' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter an amount like 20 or 20.50</Text>
          <TextInput
            value={customAmount}
            onChange={setCustomAmount}
            onSubmit={val => {
              const parsed = parseUsageCreditAmount(val);
              if (!parsed.ok) {
                setStep({ s: 'error', text: parsed.error });
                return;
              }
              void beginBuyConfirm(parsed.cents);
            }}
            focus
            showCursor
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            columns={40}
          />
          <Text dimColor>Enter to confirm · Esc to go back</Text>
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'buy_confirm') {
    const taxLine =
      step.taxLoading === true
        ? 'Looking up tax…'
        : step.tax
          ? `Estimated tax: ${formatCents(step.tax.tax_minor_units, currency)} (${step.tax.tax_rate_pct}%${step.tax.tax_label ? ` ${step.tax.tax_label}` : ''})`
          : null;
    const totalCents = step.tax && !step.taxLoading ? step.cents + step.tax.tax_minor_units : step.cents;
    return (
      <Dialog title="Confirm amount" color="suggestion" onCancel={() => setStep({ s: 'buy_select' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Purchase {formatCents(step.cents, currency)} of usage credits?</Text>
          {taxLine ? <Text dimColor>{taxLine}</Text> : null}
          {step.tax && !step.taxLoading ? (
            <Text dimColor>Total charge (credits + tax): {formatCents(totalCents, currency)}</Text>
          ) : null}
          <Text dimColor>By confirming, you allow Anthropic to charge your card in the amount above.</Text>
          <ConfirmSelect
            confirmLabel={`Buy ${formatCents(step.cents, currency)}`}
            cancelLabel="Cancel"
            onConfirm={() => {
              void (async () => {
                setStep({ s: 'buy_working' });
                try {
                  const result = step.bundle?.id
                    ? await purchaseCredits({
                        kind: 'bundle',
                        bundle: step.bundle,
                      })
                    : await purchaseCredits({
                        kind: 'amount',
                        amountCents: step.cents,
                      });
                  let status = result.payment_status;
                  let stripeSecret = result.payment_intent_client_secret ?? null;
                  // Official: only pending_invoice enters buy_polling; requires_action
                  // is 3ds_fallback immediately (no in-terminal Stripe.js).
                  if ((status === 'pending_invoice' || status === 'pending') && result.purchase_id) {
                    const polled = await pollPurchaseUntilSettled(result.purchase_id);
                    status = polled.status;
                    stripeSecret = polled.stripe_payment_intent_client_secret ?? stripeSecret;
                  }
                  const outcome = classifyCreditsPurchaseOutcome({
                    paymentStatus: status,
                    purchaseId: result.purchase_id,
                    stripeClientSecret: stripeSecret,
                  });
                  if (outcome === 'success') {
                    setStep({
                      s: 'message',
                      text: `Purchased ${formatCents(step.cents, currency)} of usage credits.`,
                    });
                  } else if (outcome === 'poll') {
                    setStep({
                      s: 'message',
                      text: `Purchase started (${status}). Complete any bank confirmation in the browser if prompted.`,
                    });
                  } else if (outcome === '3ds_fallback') {
                    // Official 3ds_fallback — no Stripe.js in CLI; send user to web.
                    try {
                      await openBrowser(USAGE_CREDITS_SETTINGS_URL);
                    } catch {
                      /* browser open best-effort */
                    }
                    setStep({
                      s: 'error',
                      text: buildCredits3dsFallbackMessage(),
                    });
                  } else {
                    setStep({
                      s: 'error',
                      text: `Unexpected purchase state: ${status}`,
                    });
                  }
                } catch (e) {
                  setStep({
                    s: 'error',
                    text: `Purchase failed: ${errorMessage(e)}`,
                  });
                }
              })();
            }}
            onCancel={() => setStep({ s: 'buy_select' })}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'buy_working') {
    return (
      <Dialog title="Buy usage credits" color="suggestion" onCancel={() => onDone()}>
        <Text dimColor>Processing purchase…</Text>
      </Dialog>
    );
  }

  if (step.s === 'limit_input') {
    return (
      <Dialog title="Set monthly spend limit" color="suggestion" onCancel={() => setStep({ s: 'menu' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Enter a monthly limit (e.g. 50) or leave blank for unlimited.</Text>
          <TextInput
            value={limitAmount}
            onChange={setLimitAmount}
            onSubmit={val => {
              const trimmed = val.trim();
              if (trimmed === '' || trimmed.toLowerCase() === 'unlimited') {
                setStep({ s: 'limit_confirm', cents: null });
                return;
              }
              const parsed = parseUsageCreditAmount(trimmed);
              if (!parsed.ok) {
                setStep({ s: 'error', text: parsed.error });
                return;
              }
              setStep({ s: 'limit_confirm', cents: parsed.cents });
            }}
            focus
            showCursor
            cursorOffset={limitCursor}
            onChangeCursorOffset={setLimitCursor}
            columns={40}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'limit_confirm') {
    const label = step.cents === null ? 'unlimited' : formatCents(step.cents, currency);
    return (
      <Dialog title="Confirm amount" color="suggestion" onCancel={() => setStep({ s: 'limit_input' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Set your monthly spend limit to {label}. This spend limit goes into effect immediately.</Text>
          <ConfirmSelect
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            onConfirm={() => {
              void (async () => {
                // densable HWr + dialog: show server user_facing reason on reject (#34)
                const result = await updateSpendLimit(step.cents, currency);
                if (!result.ok) {
                  setStep({
                    s: 'error',
                    text: formatSpendLimitUpdateFailedMessage(result.reason),
                  });
                  return;
                }
                setStep({
                  s: 'message',
                  text: step.cents === null ? 'Monthly limit set to unlimited' : `Monthly limit updated to ${label}`,
                });
              })();
            }}
            onCancel={() => setStep({ s: 'limit_input' })}
          />
        </Box>
      </Dialog>
    );
  }

  if (step.s === 'auto_reload') {
    return (
      <Dialog title="Auto-reload" color="suggestion" onCancel={() => setStep({ s: 'menu' })}>
        <Box flexDirection="column" gap={1}>
          <Text>Automatically buy more usage credits when your balance is low.</Text>
          <Text dimColor>Currently: {autoReloadEnabled ? 'on' : 'off'}</Text>
          <Select
            options={[
              {
                value: 'toggle',
                label: autoReloadEnabled ? 'Turn off auto-reload' : 'Turn on auto-reload',
              },
              { value: 'browser', label: 'Configure thresholds in browser' },
              { value: 'back', label: 'Back' },
            ]}
            onChange={async v => {
              if (v === 'back') setStep({ s: 'menu' });
              else if (v === 'browser') void openWebFallback();
              else if (v === 'toggle') {
                try {
                  const next = !autoReloadEnabled;
                  await updateAutoReloadSettings({ enabled: next });
                  setAutoReloadEnabled(next);
                  setStep({
                    s: 'message',
                    text: next
                      ? 'Auto-reload enabled. Fine-tune threshold in browser if needed.'
                      : 'Auto-reload turned off.',
                  });
                } catch (e) {
                  setStep({
                    s: 'error',
                    text: `Failed to update auto-reload: ${errorMessage(e)}`,
                  });
                }
              }
            }}
          />
        </Box>
      </Dialog>
    );
  }

  // menu (densable j2e)
  const enabled = extraUsage?.is_enabled === true;
  const limit =
    extraUsage?.monthly_limit === null
      ? 'unlimited'
      : typeof extraUsage?.monthly_limit === 'number'
        ? formatCents(extraUsage.monthly_limit, currency)
        : 'unknown';
  const used = typeof extraUsage?.used_credits === 'number' ? formatCents(extraUsage.used_credits, currency) : null;
  const utilization = typeof extraUsage?.utilization === 'number' ? Math.round(extraUsage.utilization) : undefined;
  const barWidth = Math.min(columns - 6, 50);
  const menuOptions = [
    ...(enabled ? [] : [{ value: 'enable', label: 'Turn on usage credits' }]),
    { value: 'buy', label: 'Buy usage credits' },
    { value: 'limit', label: 'Adjust monthly limit' },
    { value: 'auto', label: 'Auto-reload' },
    { value: 'browser', label: 'Open claude.ai/settings/usage' },
    { value: 'done', label: 'Done' },
  ];

  return (
    <Dialog title="Usage credits" color="suggestion" onCancel={() => onDone()}>
      <Box flexDirection="column" gap={1}>
        {renamedFromExtraUsage ? <Text dimColor>/extra-usage is now /usage-credits</Text> : null}
        <Text>Configure usage credits to keep working when you hit a limit</Text>
        {utilization !== undefined ? (
          <Box flexDirection="row" gap={1}>
            <Text>{used ?? '—'} spent</Text>
            <ProgressBar
              ratio={utilization / 100}
              width={barWidth}
              fillColor="rate_limit_fill"
              emptyColor="rate_limit_empty"
            />
            <Text>{utilization}% used</Text>
          </Box>
        ) : null}
        <Text dimColor>
          Status: {enabled ? 'enabled' : 'not enabled'} · monthly limit: {limit}
          {used ? ` · used: ${used}` : ''}
          {balanceCents !== null ? ` · balance: ${formatCents(balanceCents, currency)}` : ''}
        </Text>
        <Select
          options={menuOptions}
          visibleOptionCount={menuOptions.length}
          onChange={v => {
            if (v === 'done') onDone();
            else if (v === 'browser') void openWebFallback();
            else if (v === 'enable') setStep({ s: 'enable_confirm' });
            else if (v === 'buy') {
              if (!requireChargeableCard()) return;
              setStep({ s: 'buy_select' });
            } else if (v === 'limit') {
              setLimitAmount('');
              setLimitCursor(0);
              setStep({ s: 'limit_input' });
            } else if (v === 'auto') setStep({ s: 'auto_reload' });
          }}
        />
      </Box>
    </Dialog>
  );
}

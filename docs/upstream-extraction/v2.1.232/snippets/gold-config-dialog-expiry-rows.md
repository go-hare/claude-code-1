# densable 2.1.232 #5 — `/config` Dialog expiry + Messages from other sessions

## Changelog

> `/config`: Dialog expiry + Messages from other sessions

## densable gold (SEA 2.1.232)

### Enums

```js
l9p = ['default', '60s', '5m', '10m', 'never'] // dialogExpiry
c9p = ['default', 'accept', 'hold', 'refuse'] // crossSessionInbound
// a9p = ["never","60s","5m","10m"] // askUserQuestionTimeout (no default option)
```

### Config rows

```js
...rDa('dialogExpiry')
  ? []
  : [
      {
        id: 'dialogExpiry',
        label: 'Dialog expiry',
        consentGated: true,
        value: r.dialogExpiry ?? 'default',
        options: [...l9p],
        type: 'enum',
        async onChange(U) {
          /* default → void 0 (clear user key); tengu_dialog_expiry_changed */
        },
      },
    ],
...h && !rDa('crossSessionInbound')
  ? [
      {
        id: 'crossSessionInbound',
        label: 'Messages from your other sessions',
        consentGated: true,
        pickToCommit: true,
        value: r.crossSessionInbound ?? 'default',
        options: [...c9p],
        type: 'enum',
        /* tengu_cross_session_inbound_changed */
      },
    ]
  : []
```

### Gates

- `rDa(key)`: true when setting is resolved from a non-`userSettings` source → hide row.
- `h` = `crossSessionInboxRowVisible` = densable `ig()`:
  ```js
  function ig() {
    if (X.CLAUDE_CODE_HARBOR_KITE) return true
    if (Yt() === 'windows' && !rt('tengu_harbor_kite_win', false)) return false
    return rt('tengu_harbor_kite', false)
  }
  ```
  Local maps product availability via `UDS_INBOX` feature (DEFAULT ON) + env/GB.

### Resolvers (already local from 2.1.224)

- `getDialogExpiry` / `dialogExpiryToMs` default **5m**
- `resolveCrossSessionInbound` / peer inbound gate

## Local

- `Config.tsx` rows + `isConfigSettingManagedOutsideUser` + `isCrossSessionInboxConfigRowVisible`
- Tests: `configDialogRows.232.test.ts`

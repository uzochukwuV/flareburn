# Gateway.html → API Mapping (Visual Guide & Reference)

## 🎯 Quick Reference: Sections & APIs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FXRP MINT GATEWAY                                      │
│                         /gateway.html                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ SIDEBAR (Left, Desktop Only) + HEADER (Top, Fixed)                  │
│ - Logo, Connect Wallet, Nav (Mint Gateway ACTIVE)                   │
│ - XRP Price badge, Notifications, Profile avatar                   │
│ - API: GET /ftso-price (for XRP price in header)                    │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ LEFT COLUMN (7 cols): Setup & Actions                                        │
├──────────────────────────────────────────────────────────────────────────────┤

┌────────────────────────────────────┐
│ ADDRESS RESOLVER (glass-panel)     │
├────────────────────────────────────┤
│                                    │
│ Input: r-address                   │
│ Button: "Resolve" (right-align)   │
│                                    │
│ Output (2-column grid):            │
│ ┌──────────────┐ ┌──────────────┐ │
│ │ Smart Account│ │ Current Nonce│ │
│ │ Active ✓     │ │ 42,091       │ │
│ └──────────────┘ └──────────────┘ │
│                                    │
│ API Source:                        │
│ GET /personal-account              │
│   ?xrplAddress=rG1QQv2...         │
│                                    │
│ Field Mapping:                     │
│ ✓ personalAccount → not shown      │
│ ✓ nonce → Current Nonce (42,091)   │
│ ✓ fxrpBalance → optional display   │
│ ✓ status → Smart Account Status    │
│                                    │
│ Trigger: Click "Resolve" button    │
│ Error: Show message if invalid     │
│                                    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ ACTION SELECTOR (glow-accent)  ⭐   │
├────────────────────────────────────┤
│ 4-Button Grid:                     │
│                                    │
│ ┌──────────┐ ┌──────────┐         │
│ │ Mint-only│ │ Transfer │         │
│ │    +     │ │   swap   │         │
│ │ (ACTIVE) │ │          │         │
│ └──────────┘ └──────────┘         │
│                                    │
│ ┌──────────┐ ┌──────────┐         │
│ │ Redeem   │ │ Vault    │         │
│ │    -     │ │  Deposit │         │
│ │          │ │  balance │         │
│ └──────────┘ └──────────┘         │
│                                    │
│ Active state: Primary border       │
│ Inactive: Neutral, hover secondary │
│                                    │
│ API Source:                        │
│ GET /vaults (for vault option)    │
│   → [{ vaultId, name, balance}]   │
│                                    │
│ Action-specific fields:            │
│ - Mint-only: none                  │
│ - Transfer: toFlareAddress (0x...)│
│ - Redeem: redeemerXrplAddress (r.│
│ - Vault: vaultId dropdown         │
│                                    │
└────────────────────────────────────┘

└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ RIGHT COLUMN (5 cols): Quote & Review                                        │
├──────────────────────────────────────────────────────────────────────────────┤

┌────────────────────────────────────────┐
│ QUOTE & PREPARATION (glass-panel)      │
├────────────────────────────────────────┤
│                                        │
│ Amount Input:                          │
│ ┌────────────────────────────────┐    │
│ │ 10000 XRP           [Resolve]  │    │
│ └────────────────────────────────┘    │
│                                        │
│ Fee Breakdown (table):                 │
│ ┌────────────────────────────────┐    │
│ │ Minting Fee (0.1%)  -10.00 XRP  │    │
│ ├────────────────────────────────┤    │
│ │ Executor Fee (Gas)   -0.55 XRP  │    │
│ ├────────────────────────────────┤    │
│ │ Receive Amount 9,989.45 FXRP ✓  │    │
│ │                 (highlighted)   │    │
│ └────────────────────────────────┘    │
│                                        │
│ API Source:                            │
│ GET /quote { paymentXrp }             │
│                                        │
│ Field Mapping:                         │
│ ✓ paymentXrp → echo in input          │
│ ✓ mintingFeeXrp → -10.00 XRP         │
│ ✓ executorFeeXrp → -0.55 XRP        │
│ ✓ fxpReceivedXrp → 9,989.45 FXRP    │
│                                        │
│ Trigger: Amount input change           │
│ Debounce: 300-500ms                    │
│                                        │
└────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ TRANSACTION REVIEW (flex-grow, scroll)    │
├────────────────────────────────────────────┤
│                                            │
│ Unsigned Payment JSON:                     │
│ ┌────────────────────────────────────────┐ │
│ │ {                    [Copy button]      │ │
│ │   "TransactionType": "Payment",         │ │
│ │   "Account": "rG1QQv2...",            │ │
│ │   "Destination": "rHTjB6...",         │ │
│ │   "Amount": "10000000000",            │ │
│ │   "Fee": "12",                        │ │
│ │   "Sequence": 42091,                  │ │
│ │   "Memos": [{                         │ │
│ │     "Memo": {"MemoData": "0xFF..."}  │ │
│ │   }]                                  │ │
│ │ }                                     │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ 0xFF Memo Hex:                             │
│ ┌────────────────────────────────────────┐ │
│ │ 0xFF1A2B3C... [ellipsis] [Copy button]  │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ Sign Button (full width):                  │
│ ┌────────────────────────────────────────┐ │
│ │ 🖊️  Sign via Wallet  [glowing shadow]   │ │
│ └────────────────────────────────────────┘ │
│                                            │
│ API Source:                                │
│ POST /prepare-payment {                    │
│   xrplAddress,                            │
│   amountXrp,                              │
│   action                                  │
│ }                                         │
│                                            │
│ Field Mapping:                             │
│ ✓ payment → Unsigned Payment JSON          │
│ ✓ memoHex → 0xFF Memo Hex                 │
│ ✓ callsPreview → (if action has calls)   │
│                                            │
│ Payment structure:                         │
│ - Account: xrplAddress                    │
│ - Destination: coreVaultAddress (/status)│
│ - Amount: paymentXrp in drops             │
│ - Fee: executorFeeXrp in drops            │
│ - Sequence: nonce (/personal-account)    │
│ - Memos[0].Memo.MemoData: memoHex        │
│                                            │
│ Trigger: Auto-update on action change     │
│ Or: Click "Prepare" button                │
│                                            │
│ Error: Show if quote result is null      │
│                                            │
└────────────────────────────────────────────┘

└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 API Endpoint Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INITIALIZATION (on page load)                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. GET /status                                                          │
│    └─ Network, fees, Core Vault address                                │
│                                                                         │
│ 2. GET /ftso-price (optional, for XRP price badge)                    │
│    └─ XRP/USD price → Header badge "XRP: $1.20"                       │
│                                                                         │
│ 3. GET /vaults (optional, for vault-deposit action)                   │
│    └─ Vault list with IDs, names, balances                            │
│                                                                         │
│ Then render:                                                            │
│ ✓ Address input (empty, ready for user)                                │
│ ✓ Action selector (4 buttons, mint-only active)                        │
│ ✓ Amount input (empty)                                                 │
│ ✓ Quote section (no data yet)                                          │
│ ✓ Transaction Review (no data yet)                                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTION #1: Resolve Address                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ User enters XRPL address (r...) + clicks "Resolve"                    │
│ ↓                                                                       │
│ GET /personal-account?xrplAddress=rG1QQv2...                          │
│ ├─ Response: {                                                          │
│ │   personalAccount: "0x...",                                          │
│ │   nonce: "42091",                                                    │
│ │   fxrpBalance: "100.5",                                              │
│ │   executor: "0x..."                                                  │
│ │ }                                                                     │
│ ├─ Display: Smart Account Status (Active/Inactive)                    │
│ ├─ Display: Current Nonce (42091)                                      │
│ └─ Store: personalAccount, nonce (for /prepare-payment)               │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTION #2: Select Action                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ User clicks action button (e.g., "Transfer")                          │
│ ├─ Highlight selected button (primary color border)                    │
│ ├─ Show action-specific fields (e.g., toFlareAddress input)           │
│ └─ Update /prepare-payment call (different action payload)            │
│                                                                         │
│ For vault-deposit:                                                      │
│ └─ GET /vaults → populate vault dropdown                              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTION #3: Enter Amount                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ User enters amount (10000 XRP)                                         │
│ ├─ (On blur or debounce 300ms)                                         │
│ └─ GET /quote { paymentXrp: "10000" }                                  │
│    ├─ Response: {                                                       │
│    │   paymentXrp: "10000",                                            │
│    │   mintingFeeXrp: "10.00",                                         │
│    │   executorFeeXrp: "0.55",                                         │
│    │   fxpReceivedXrp: "9989.45"                                       │
│    │ }                                                                  │
│    ├─ Display: Minting Fee (-10.00 XRP)                                │
│    ├─ Display: Executor Fee (-0.55 XRP)                                │
│    ├─ Display: Receive Amount (9,989.45 FXRP)                          │
│    └─ Auto-trigger /prepare-payment (if all fields ready)             │
│                                                                         │
│ Error case:                                                             │
│ └─ If quote.fxpReceivedXrp is null → show "Below minimum fee floor"   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTION #4: Prepare Payment                                    │
├─────────────────────────────────────────────────────────────────────────┤
│ All fields filled → Auto or click "Prepare"                           │
│ ↓                                                                       │
│ POST /prepare-payment {                                                │
│   xrplAddress: "rG1QQv2...",                                           │
│   amountXrp: "10000",                                                  │
│   action: {                                                             │
│     type: "mint_only" | "transfer" | "redeem" | "vault_deposit",     │
│     [action-specific fields...]                                        │
│   }                                                                     │
│ }                                                                       │
│ ↓                                                                       │
│ Response: {                                                             │
│   kind: "mint_only" | "mint_and_action",                              │
│   personalAccount: "0x...",                                            │
│   nonce: "42091",                                                      │
│   payment: {                                                            │
│     TransactionType: "Payment",                                        │
│     Account: "rG1QQv2...",                                             │
│     Destination: "rDhpmiPq...",  ← Core Vault                         │
│     Amount: "10000000000",         ← drops                             │
│     Fee: "12",                     ← executor fee in drops             │
│     Sequence: 42091,               ← nonce                             │
│     Memos: [{ Memo: { MemoData: "0xFF..." } }]                        │
│   },                                                                    │
│   memoHex: "0xFF1A2B3C...",                                            │
│   callsPreview: [                                                       │
│     { target: "0x...", data: "0x..." },  ← if action has calls       │
│     { target: "0x...", data: "0x..." }                                 │
│   ]                                                                     │
│ }                                                                       │
│ ↓                                                                       │
│ Display:                                                                │
│ ├─ Payment JSON (pretty-printed, copyable)                            │
│ ├─ Memo Hex (monospace, copyable)                                     │
│ └─ Calls Preview (if present, for review)                            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTION #5: Copy & Sign                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ User clicks "Copy" on Payment JSON                                    │
│ ├─ Copy to clipboard                                                   │
│ └─ Show toast: "Copied to clipboard!"                                 │
│                                                                         │
│ User clicks "Copy" on Memo Hex                                        │
│ ├─ Copy to clipboard                                                   │
│ └─ Show toast: "Copied!"                                              │
│                                                                         │
│ User clicks "Sign via Wallet"                                         │
│ ├─ (Future) Open XRPL wallet modal (Xaman SDK, xrpl.js)              │
│ ├─ User signs Payment in wallet                                       │
│ └─ Result: Signed Payment ready for broadcast                         │
│                                                                         │
│ (For now: just shows Payment data, user copies & signs manually)      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Data Field Mappings (API Response → UI Display)

### **Address Resolver Card**

| Field | API | Response | Display | Format |
|-------|-----|----------|---------|--------|
| XRPL Address | Input | User enters | rG1QQv2nh2... | Text, validated format |
| Smart Account Status | `/personal-account` | ✓ present | "Active / Validated" | Text + green dot |
| Current Nonce | `/personal-account` | `nonce` | 42,091 | Number, monospace |

### **Action Selector**

| Button | Label | Icon | State | API |
|--------|-------|------|-------|-----|
| 1 | Mint-only | add_circle | Active (default) | — |
| 2 | Transfer | swap_horiz | Inactive | — |
| 3 | Redeem | remove_circle | Inactive | — |
| 4 | Vault Deposit | account_balance | Inactive | GET /vaults |

### **Quote & Preparation Card**

| Field | Source | Response | Display | Format |
|-------|--------|----------|---------|--------|
| Amount | Input | User enters | 10000 | Number, editable |
| Minting Fee | `/quote` | `mintingFeeXrp` | -10.00 XRP | Currency with 2 decimals |
| Executor Fee | `/quote` | `executorFeeXrp` | -0.55 XRP | Currency with 2 decimals |
| Receive Amount | `/quote` | `fxpReceivedXrp` | 9,989.45 FXRP | Large, bold, primary color |

### **Transaction Review Card**

| Field | Source | Response | Display | Format |
|-------|--------|----------|---------|--------|
| Account | `/prepare-payment` | `payment.Account` | rG1QQv2nh2... | Monospace |
| Destination | `/status` → Core Vault | `payment.Destination` | rDhpmiPq... | Monospace |
| Amount | Input × drops | `payment.Amount` | 10000000000 | Monospace, drops |
| Fee | `/quote` × drops | `payment.Fee` | 12 | Monospace, drops |
| Sequence | `/personal-account` | `payment.Sequence` | 42091 | Monospace |
| Memo | `/prepare-payment` | `memoHex` | 0xFF1A2B3C... | Monospace, ellipsis |

### **Header Badge**

| Field | Source | Response | Display | Format |
|-------|--------|----------|---------|--------|
| XRP Price | `/ftso-price` | `priceUsd` | $1.20 | Currency with 2 decimals |

---

## ⚙️ Implementation Priorities

### **Tier 1: Core Mint Flow (Critical Path)**
```javascript
// 1. Address resolution
resolveAddress(xrplAddress)
  ├─ GET /personal-account
  ├─ Update Smart Account Status
  └─ Update Current Nonce

// 2. Amount input & quote
getQuote(amountXrp)
  ├─ GET /quote
  ├─ Update Minting Fee
  ├─ Update Executor Fee
  └─ Update Receive Amount

// 3. Payment preparation
preparePayment(xrplAddress, amountXrp, "mint_only")
  ├─ POST /prepare-payment
  ├─ Update Payment JSON
  └─ Update Memo Hex
```

### **Tier 2: Action Switching**
```javascript
// 4. Action selection
selectAction(type)
  ├─ Highlight button
  ├─ Show/hide action fields
  ├─ (GET /vaults if vault_deposit)
  └─ Re-call preparePayment with new action

// 5. Action-specific fields
  ├─ Transfer: toFlareAddress input
  ├─ Redeem: redeemerXrplAddress + destinationTag
  └─ Vault: vaultId dropdown

```

### **Tier 3: UX & Polish**
```javascript
// 6. Loading/error states
  ├─ Show spinner during API calls
  ├─ Show error messages with retry
  ├─ Disable buttons during fetch

// 7. Copy-to-clipboard
  ├─ Copy Payment JSON
  ├─ Copy Memo Hex
  └─ Toast notifications

// 8. Input validation
  ├─ XRPL address format
  ├─ Amount (decimal, positive, ≤ max)
  └─ Flare address format (for transfer)
```

---

## 🧪 Test Data (for development)

### **Example /personal-account Response**
```json
{
  "xrplAddress": "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn",
  "personalAccount": "0x1234567890123456789012345678901234567890",
  "nonce": "42091",
  "executor": "0x...",
  "fxrpBalance": "100.5"
}
```

### **Example /quote Response**
```json
{
  "paymentXrp": "10000",
  "mintingFeeXrp": "10.00",
  "executorFeeXrp": "0.55",
  "fxpReceivedXrp": "9989.45"
}
```

### **Example /prepare-payment Response**
```json
{
  "kind": "mint_only",
  "personalAccount": "0x1234...",
  "nonce": "42091",
  "payment": {
    "TransactionType": "Payment",
    "Account": "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn",
    "Destination": "rDhpmiPq4BVBDWMV...",
    "Amount": "10000000000",
    "Fee": "12",
    "Sequence": 42091,
    "Memos": [{
      "Memo": {
        "MemoData": "0xFF1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B"
      }
    }]
  },
  "memoHex": "0xFF1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B",
  "callsPreview": [
    {
      "target": "0x1234567890123456789012345678901234567890",
      "data": "0x..."
    }
  ]
}
```

---

## 🚀 Next Steps

1. **Tier 1**: Implement core mint flow (address → quote → payment)
2. **Tier 2**: Add action switching (transfer, redeem, vault)
3. **Tier 3**: Polish UX (loading, errors, copy, validation)
4. **Future**: Wallet integration (sign & broadcast)

---

**Status**: ✅ Analysis complete, ready for Tier 1 implementation

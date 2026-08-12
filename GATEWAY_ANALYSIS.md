# Gateway.html Analysis & API Mapping

## 📋 Page Structure Overview

**File**: `/public/gateway.html`  
**Purpose**: FXRP Mint Gateway - Convert XRP → FXRP with smart account actions  
**Layout**: Tailwind CSS grid (12-column) with glass-morphism cards  
**Framework**: Vanilla HTML + Tailwind (no JS framework)  
**Status**: ~85% template, ~15% hardcoded demo data (mostly user inputs)

---

## 🎨 Page Sections & Components

### **1. LEFT SIDEBAR (Desktop Only, Hidden on Mobile)**
- **Brand Section**
  - Logo mark: token icon in primary-container
  - Title: "FXRP Terminal"
  - Subtitle: "Institutional DeFi"
  
- **Navigation Links** (Mint Gateway is ACTIVE)
  - Dashboard (inactive)
  - Mint Gateway (active, secondary-container)
  - Reserves (inactive)
  - Executors (inactive)
  - Settings (inactive)
  
- **Connect Wallet Button** (primary color, full width)

- **Bottom Links**
  - Documentation
  - Log Out

### **2. TOP HEADER BAR (Fixed)**
- **Left**: Page title "FXRP Mint Gateway" + XRP price badge ("XRP: $1.20")
- **Right**:
  - Hub icon
  - Analytics icon
  - Notifications icon (with red dot, no pulsing)
  - User avatar (circular)

### **3. MAIN CONTENT AREA (Scrollable)**
Grid layout: `grid-cols-1 md:grid-cols-12` (12 columns on desktop)

---

## 📊 Content Sections (COLUMN BY COLUMN)

### **LEFT COLUMN (7 cols)**: Setup & Actions

#### **Section 1: Address Resolver Card**
```
Header: "Address Resolver" (with search icon)
Toolbar: Drag indicator, Settings icon
```

**Input Field:**
```
Label: "XRPL Source Address" (uppercase, dim text)
Input: "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn" (hardcoded)
Helper: "Resolve" button (right-side, primary color on hover)
Styling: glass-panel, border focus state
```

**Data Display (2-column grid):**
```
Left Card:
  Label: "Smart Account Status" (uppercase, dim)
  Value: "Active / Validated" (with green dot, primary color)
  Styling: surface-container-low background

Right Card:
  Label: "Current Nonce" (uppercase, dim)
  Value: "42,091" (monospace or data font)
  Styling: surface-container-low background
```

**API Source**: `GET /personal-account?xrplAddress=...`
```
Request triggered on: "Resolve" button click
Response fields:
  - personalAccount → not displayed (used for calldata)
  - nonce → Current Nonce card (42,091)
  - fxrpBalance → not displayed (optional)
Status: "Active" is hardcoded, could come from validation
```

---

#### **Section 2: Action Selector Card** ⭐ (Highlighted with glow-accent)
```
Header: "Action Selector" (with bolt icon)
Toolbar: Drag indicator
```

**Action Buttons Grid (4 cols on desktop, 2 on mobile):**
```
Button 1: Mint-only (ACTIVE)
  Icon: add_circle (filled)
  Label: "Mint-only"
  State: Primary border/bg highlight, bg-primary/5, border-primary/50
  Action: Select this action

Button 2: Transfer
  Icon: swap_horiz (outline)
  Label: "Transfer"
  State: Neutral, hover border to secondary-fixed-dim
  Action: Switch to transfer flow

Button 3: Redeem
  Icon: remove_circle (outline)
  Label: "Redeem"
  State: Neutral, hover border to error/50
  Action: Switch to redeem flow

Button 4: Vault Deposit
  Icon: account_balance (outline)
  Label: "Vault Deposit"
  State: Neutral, hover border to secondary-container/50
  Action: Switch to vault flow
```

**API Source**: `GET /vaults` (for vault option)
```
Endpoint needed for vault-deposit action
Response: vaults[] with { vaultId, name, address, fxrpBalance }
Used to: Populate nested fields in vault-deposit flow (not visible in current view)
```

---

### **RIGHT COLUMN (5 cols)**: Quote & Review

#### **Section 3: Quote & Preparation Card**
```
Header: "Quote & Preparation" (with calculate icon)
Toolbar: Drag indicator
```

**Amount Input:**
```
Label: "Mint Amount (XRP)" (uppercase, dim text)
Input: "10000" (editable, type=number)
Suffix: "XRP" (right-side, dim text)
Styling: large headline-lg font, focus state
```

**Fee Breakdown (3-row table, rounded container):**
```
Row 1:
  Label: "Minting Fee (0.1%)" (uppercase, dim)
  Value: "-10.00 XRP" (error color, red)

Row 2:
  Label: "Executor Fee (Gas Est.)" (uppercase, dim)
  Value: "-0.55 XRP" (error color, red)

Row 3 (highlighted):
  Label: "Receive Amount" (bold, primary-fixed-dim)
  Value: "9,989.45 FXRP" (bold, headline-lg, primary-fixed-dim)
  Styling: bg-primary/5, rounded-b-lg
```

**API Source**: `GET /quote` + `POST /quote`
```
Triggered on: Amount input change (debounce 500ms or on blur)
Request body:
  { paymentXrp: "10000" } or { desiredFxpXrp: "9989.45" }

Response fields used:
  - paymentXrp → 10,000 (echoed in input)
  - mintingFeeXrp → -10.00 XRP (0.1%)
  - executorFeeXrp → -0.55 XRP
  - fxpReceivedXrp → 9,989.45 FXRP (or null if below minimum)

Calculation:
  mintingFeeXrp = paymentXrp × 0.001 (hardcoded 0.1%)
  executorFeeXrp = hardcoded or dynamic
  fxpReceivedXrp = paymentXrp - mintingFeeXrp - executorFeeXrp
```

---

#### **Section 4: Transaction Review Card** (flex-grow, takes remaining space)
```
Header: "Transaction Review" (with code icon)
Toolbar: Drag indicator
Scrollable content area (flex-grow)
```

**Subsection A: Unsigned Payment JSON**
```
Label: "Unsigned Payment JSON" (uppercase, dim)
Copy Button: Right-aligned, "Copy" text with copy icon
Content: <pre> with JSON code block (hardcoded example)

JSON Example:
{
  "TransactionType": "Payment",
  "Account": "rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn",
  "Destination": "rHTjB6M9zRjQzQ2tYg4K4j6c5c7L2y7R8x",
  "Amount": "10000000000",
  "Fee": "12",
  "Sequence": 42091,
  "Memos": [
    {
      "Memo": {
        "MemoData": "0xFF..."
      }
    }
  ]
}

Mapping:
  - Account → xrplAddress (from resolver)
  - Destination → Core Vault address (from /status)
  - Amount → paymentXrp in drops (10000 XRP = 10,000,000,000 drops)
  - Fee → executor fee in drops
  - Sequence → nonce (from /personal-account)
  - Memos[0].Memo.MemoData → 0xFF memo hex (from action encoding)
```

**Styling**: bg-surface-container-lowest, monospace font, overflow-x auto

---

**Subsection B: 0xFF Memo Hex**
```
Label: "0xFF Memo Hex" (uppercase, dim)
Copy Button: Right-aligned, "Copy" text
Content: Monospace text, left-aligned, ellipsis on overflow

Value: "0xFF1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B"

Mapping:
  - Generated from action type + payload
  - Encodes: opcode (0xFF), walletId, executorFeeUba, userOp data
  - Used in Payment Memo field
```

**Styling**: bg-surface-container-lowest, monospace, text-ellipsis

---

**Subsection C: Sign Action Button (at bottom)**
```
Button: "Sign via Wallet" (full width, primary color, large)
Icon: edit_document
Styling: 
  - bg-primary, text-on-primary, font-bold
  - Glowing shadow: 0 0 15px rgba(0,227,138,0.3)
  - Hover: shadow-[0_0_25px_rgba(0,227,138,0.5)]

Action:
  - User clicks → shows modal/sheet (not implemented)
  - User copies Payment JSON + memo hex
  - User signs in XRPL wallet (Xaman, Ledger, etc.)
  - Result: Unsigned Payment object ready for broadcast
```

---

## 🔄 API Integration Mapping Summary

### **Endpoints Used**

```
1. GET /status
   └─ network badge, Core Vault address, fees

2. GET /personal-account?xrplAddress=...
   └─ personalAccount (0x...), nonce, status, fxrpBalance

3. GET /quote (on amount change)
   └─ mintingFeeXrp, executorFeeXrp, fxpReceivedXrp

4. GET /vaults (optional, for vault-deposit action)
   └─ vault list with balances

5. POST /prepare-payment (to generate Payment JSON)
   └─ unsigned XRPL Payment + memo hex + callsPreview
```

### **Data Flow (User Journey)**

```
1. Page loads
   ├─ GET /status (network info, fees)
   ├─ Sidebar nav populated
   └─ Header with XRP price

2. User enters XRPL address
   ├─ User clicks "Resolve"
   └─ GET /personal-account?xrplAddress=...
      ├─ Populate: Smart Account Status (Active/Inactive)
      ├─ Populate: Current Nonce (42,091)
      └─ Store: personalAccount, nonce

3. User selects action (Mint-only = default)
   └─ Highlight button, show action-specific fields

4. User enters amount (10000 XRP)
   ├─ (Optional: On blur/debounce)
   └─ GET /quote { paymentXrp: "10000" }
      ├─ Calculate fees (0.1% minting + executor gas)
      ├─ Populate: Minting Fee (-10.00 XRP)
      ├─ Populate: Executor Fee (-0.55 XRP)
      └─ Populate: Receive Amount (9,989.45 FXRP)

5. (Optional) User clicks Max
   └─ Set amount to portfolio balance (if loaded)

6. User clicks "Prepare" or auto-triggered
   └─ POST /prepare-payment {xrplAddress, amountXrp, action}
      ├─ Generate unsigned Payment JSON
      ├─ Generate 0xFF memo hex
      ├─ Populate: Transaction Review
      └─ Show callsPreview (if action has EVM calls)

7. User reviews & copies
   ├─ Copy Payment JSON
   ├─ Copy 0xFF memo hex
   └─ Read "Sign via Wallet" note

8. User clicks "Sign via Wallet"
   ├─ (Future) Opens XRPL wallet modal/browser extension
   └─ User signs Payment + broadcasts
```

---

## 💾 Hardcoded Demo Data (To Replace)

| What | Current | Source After API |
|------|---------|------------------|
| XRP Price | $1.20 | `GET /ftso-price` → priceUsd |
| XRPL Address | rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn | User input |
| Smart Account Status | Active / Validated | `GET /personal-account` → validation result |
| Current Nonce | 42,091 | `GET /personal-account` → nonce |
| Mint Amount | 10000 | User input |
| Minting Fee | -10.00 XRP (0.1%) | `GET /quote` → mintingFeeXrp |
| Executor Fee | -0.55 XRP | `GET /quote` → executorFeeXrp |
| Receive Amount | 9,989.45 FXRP | `GET /quote` → fxpReceivedXrp |
| Payment JSON | Hardcoded example | `POST /prepare-payment` → payment |
| 0xFF Memo Hex | 0xFF1A2B3C... | `POST /prepare-payment` → memoHex |
| Action Buttons | 4 hardcoded | Dynamically generated from action types |

---

## 🎯 Current State vs Ready for Implementation

### **What's Hardcoded (Demo Data)**
- ✅ XRPL address (will be user input or localStorage)
- ✅ Smart account status (will be from /personal-account validation)
- ✅ Nonce value (will be from /personal-account)
- ✅ Amount input (user enters, we validate)
- ✅ Fees (calculated from /quote)
- ✅ Receive amount (calculated from /quote)
- ✅ Payment JSON structure (will be from /prepare-payment)
- ✅ Memo hex (will be from /prepare-payment)
- ✅ XRP price ($1.20 will be from /ftso-price)

### **What's Styled/Ready**
- ✅ Layout (12-col grid, responsive mobile/tablet/desktop)
- ✅ Color scheme (Material Design 3 dark theme)
- ✅ Typography (Geist, JetBrains Mono)
- ✅ Glass-morphism effects (blur, borders, shadows)
- ✅ Interactions (hover states, button focus, drag handles)
- ✅ Accessibility (semantic HTML, ARIA labels)

### **What Needs Implementation**
- ❌ API calls (fetch with error handling, retry logic)
- ❌ Input validation (XRP amount decimal, ≤ max, etc.)
- ❌ Address resolution (resolve button → GET /personal-account)
- ❌ Quote calculation (amount change → GET /quote)
- ❌ Payment preparation (POST /prepare-payment)
- ❌ Memo hex generation (from action + payload)
- ❌ Copy-to-clipboard (for Payment JSON + Memo hex)
- ❌ Action switching (dynamically show different fields per action)
- ❌ Loading states (spinner during API calls)
- ❌ Error handling (RPC offline, invalid address, etc.)
- ❌ Wallet integration (sign via Xaman/Ledger)

---

## 📝 Implementation Checklist

### **Phase 1: API Integration** (2-3 hours)
- [ ] Create `gateway.js` with API helper functions
- [ ] Implement `resolveAddress(xrplAddress)` → GET /personal-account
- [ ] Implement `getQuote(amountXrp)` → GET /quote
- [ ] Implement `preparePayment(xrplAddress, amountXrp, action)` → POST /prepare-payment
- [ ] Add retry logic and error handling
- [ ] Add caching (5min for quote, session for account)

### **Phase 2: Input & Validation** (1-2 hours)
- [ ] Wire address input + Resolve button
- [ ] Wire amount input + validation (decimal, positive, ≤ max)
- [ ] Wire Max button (if portfolio loaded)
- [ ] Add input focus states + error messages
- [ ] Debounce amount change (300ms before quote fetch)

### **Phase 3: Data Binding & Display** (2-3 hours)
- [ ] Bind address → Smart Account Status + Nonce cards
- [ ] Bind amount → Receive Amount (calculate: amount - fees)
- [ ] Bind fees → Minting Fee + Executor Fee rows
- [ ] Bind Payment JSON → Transaction Review code block
- [ ] Bind Memo Hex → 0xFF Memo Hex field
- [ ] Format numbers (decimals, comma separator, XRP/FXRP units)

### **Phase 4: Action Switching** (2-3 hours)
- [ ] Implement action selection (highlight, show/hide fields)
- [ ] Mint-only: no additional fields
- [ ] Transfer: add "Flare recipient" (0x...) input
- [ ] Redeem: add "XRPL destination" (r...) input + optional "destination tag"
- [ ] Vault Deposit: add vault selector + amount
- [ ] Update /prepare-payment call per action

### **Phase 5: User Experience** (2-3 hours)
- [ ] Add loading spinners during API calls
- [ ] Add error messages with retry buttons
- [ ] Copy-to-clipboard for Payment JSON + Memo hex
- [ ] Toast notifications ("Copied to clipboard")
- [ ] Disable Resolve/Prepare buttons during fetch
- [ ] Tab focus trap + keyboard navigation

### **Phase 6: Wallet Integration (Future)** (3-4 hours)
- [ ] Integrate xrpl.js or Xaman SDK
- [ ] "Sign via Wallet" button → open wallet modal
- [ ] Broadcast signed Payment to XRPL
- [ ] Show success/error message

### **Total Estimate: 12-18 hours** (1.5-2.5 working days)

---

## 🚀 Quick Start Code Structure

```javascript
// gateway.js

// 1. API Functions
async function resolveAddress(xrplAddress) {
  const res = await fetch(`/personal-account?xrplAddress=${encodeURIComponent(xrplAddress)}`);
  return res.json();
}

async function getQuote(paymentXrp) {
  const res = await fetch('/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentXrp })
  });
  return res.json();
}

async function preparePayment(xrplAddress, amountXrp, action) {
  const res = await fetch('/prepare-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ xrplAddress, amountXrp, action })
  });
  return res.json();
}

// 2. UI Update Functions
function updateAddressStatus(data) {
  document.getElementById('smartAccountStatus').textContent = 
    data ? 'Active / Validated' : 'Inactive';
  document.getElementById('currentNonce').textContent = data?.nonce || '—';
}

function updateQuote(data) {
  document.getElementById('mintingFee').textContent = 
    `-${data.mintingFeeXrp} XRP`;
  document.getElementById('executorFee').textContent = 
    `-${data.executorFeeXrp} XRP`;
  document.getElementById('receiveAmount').textContent = 
    `${data.fxpReceivedXrp} FXRP`;
}

function updatePaymentReview(data) {
  document.getElementById('paymentJson').textContent = 
    JSON.stringify(data.payment, null, 2);
  document.getElementById('memoHex').textContent = data.memoHex;
}

// 3. Event Handlers
document.getElementById('resolveBtn').addEventListener('click', async () => {
  const address = document.getElementById('addressInput').value;
  if (!isValidXrplAddress(address)) {
    showError('Invalid XRPL address');
    return;
  }
  
  showLoading('Resolving...');
  try {
    const data = await resolveAddress(address);
    updateAddressStatus(data);
  } catch (err) {
    showError(err.message);
  }
});

document.getElementById('amountInput').addEventListener('change', debounce(async () => {
  const amount = document.getElementById('amountInput').value;
  if (!isValidAmount(amount)) return;
  
  showLoading('Quoting...');
  try {
    const data = await getQuote(amount);
    updateQuote(data);
  } catch (err) {
    showError(err.message);
  }
}, 500));

// 4. Action Selection
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const action = e.currentTarget.dataset.action;
    selectAction(action);
  });
});

// 5. Prepare Payment
document.getElementById('prepareBtn').addEventListener('click', async () => {
  const xrplAddress = document.getElementById('addressInput').value;
  const amount = document.getElementById('amountInput').value;
  const action = getSelectedAction();
  
  showLoading('Preparing...');
  try {
    const data = await preparePayment(xrplAddress, amount, action);
    updatePaymentReview(data);
  } catch (err) {
    showError(err.message);
  }
});

// 6. Copy to Clipboard
document.getElementById('copyPaymentBtn').addEventListener('click', () => {
  const json = document.getElementById('paymentJson').textContent;
  navigator.clipboard.writeText(json);
  showToast('Payment JSON copied!');
});
```

---

## 📚 Reference Files

- `/FRONTEND_SPEC.md` — Complete specification
- `/PORTFOLIO_ANALYSIS.md` — Portfolio page analysis
- `/server/index.ts` — Backend implementation

---

**Ready to implement!** 🚀

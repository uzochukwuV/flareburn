# Frontend Specification: FXRP Cross-Chain DeFi Dashboard & Gateway

**Version:** 1.0  
**Target Audience:** Frontend Engineer  
**Tech Stack:** Vanilla TypeScript / React (optional), ethers.js v6, xrpl.js  
**Browser Support:** Chrome, Firefox, Safari, Edge (ES2022+)

---

## 📋 Overview & Vision

### Mission
Build a **unified cross-chain dashboard and DeFi gateway** where users can:
- **Mint FXRP** from a single XRPL Payment (no EVM wallet needed)
- **View omnichain FXRP positions** across 7 chains in real-time
- **Bridge FXRP** seamlessly via LayerZero OFT
- **Redeem FXRP → XRP** directly to exchanges or personal r-addresses
- **Execute smart-account actions** (vault deposits, transfers) atomically from one XRPL tx
- **Monitor executor status** and proof-of-reserves

### Key Principles
- **Read-only frontend**: No keys, no signing, no broadcasting — only prepare unsigned transactions
- **Real-time data**: Async API calls with loading states, error handling, and retry logic
- **Responsive design**: Works on desktop, tablet, mobile (320px–2560px)
- **Accessibility**: WCAG 2.1 AA (color contrast, keyboard nav, ARIA labels)
- **Performance**: Lazy-load modals, debounce searches, cache API responses (5min TTL)

---

## 🏗️ Application Architecture

### Two Main Pages

#### **Page 1: Mint Gateway** (`/index.html`)
- **Purpose**: Users with XRPL wallets mint FXRP and execute an action atomically
- **Flow**:
  1. Resolve XRPL address → fetch smart account + nonce + FXRP balance
  2. Select action (mint-only, transfer, redeem, redeem-with-tag, vault-deposit, bridge)
  3. Enter amount → get quote (minting fee, executor fee, receive amount)
  4. Prepare unsigned XRPL Payment with 0xFF memo encoding the action
  5. Display Payment JSON + memo hex for review
  6. User copies & signs in XRPL wallet (Xaman, Ledger, etc.)

#### **Page 2: Cross-Chain Dashboard** (`/dashboard.html`)
- **Purpose**: EVM users view all FXRP positions, bridge, redeem, manage reserves
- **Flow**:
  1. Enter EVM address (0x...) → load portfolio across all 7 chains in parallel
  2. Display total FXRP, per-chain balances, supply breakdown, USD value (FTSO price)
  3. Bridge panel: select src/dst chain, amount, recipient → prepare LayerZero calldata
  4. Redeem panel: standalone (EVM wallet signs) or mint+redeem (XRPL wallet signs)
  5. Proof of Reserves: FXRP supply vs Core Vault XRP backing ratio
  6. Executor Status: health, journal, job count
  7. Utilities: Decode 0xFF memo, Gasless redeem

---

## 📡 API Endpoints Reference

### Status & Network

```
GET /status
→ {
  network: "coston2" | "flare" | "coston" | "songbird",
  chainId: number,
  contracts: { assetManager, personalAccountController, ... },
  fxrpToken: { address, decimals=6, symbol="FXRP" },
  fassetSettings: { lotSizeUba, assetDecimals, minimumRedeemAmountUba },
  directMinting: {
    coreVaultAddress, minimumFeeXrp, feeBIPS, executorFeeXrp,
    othersCanExecuteAfterSeconds, hourlyLimitXrp, dailyLimitXrp,
    largeMintingThresholdXrp, largeMintingDelaySeconds, feeReceiver
  }
}

GET /health
→ { ok: true }
```

### Smart Account (Mint Gateway)

```
GET /personal-account?xrplAddress=rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1
→ {
  xrplAddress,
  personalAccount: "0x...",
  nonce: "123",
  executor: "0x...",
  fxrpBalance: "100.5",
  fxrpBalanceUba: "100500000" (6 decimals)
}
```

### Quote

```
POST /quote
Body: { paymentXrp: "10" } OR { desiredFxpXrp: "9.5" }
→ {
  paymentXrp: "10",
  mintingFeeXrp: "0.025",
  executorFeeXrp: "0.1",
  fxpReceivedXrp: "9.5" | null (if below min)
}
```

### Prepare Payment (Mint + Action)

```
POST /prepare-payment
Body: {
  xrplAddress: "rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1",
  amountXrp: "10",
  action: {
    type: "mint_only" | "transfer" | "redeem" | "redeem_with_tag" | "vault_deposit" | "bridge",
    // action-specific fields (toFlareAddress, redeemerXrplAddress, destinationTag, vaultId, dstChain, etc.)
  },
  walletId?: number
}
→ {
  kind: "mint_only" | "mint_and_action",
  action?: string,
  personalAccount: "0x...",
  nonce: "123",
  payment: { TransactionType, Account, Destination, Amount, Fee, Memos },
  memoHex: "0xff...",
  callsPreview?: [{ target, value, data }, ...],
  userOpCallDataHash: "0x...",
  note: "Sign this Payment in your XRPL wallet..."
}
```

### Vaults

```
GET /vaults
→ {
  network: "coston2",
  vaults: [
    { vaultId: 1, name: "Firelight", address: "0x...", fxrpBalance: "1000000" },
    { vaultId: 2, name: "Upshift", address: "0x...", fxrpBalance: "500000" }
  ]
}
```

### FTSO Price

```
GET /ftso-price?feedId=0x015852502f55534400000000000000000000000000
→ {
  network: "coston2",
  feedId: "0x015852502f55534400000000000000000000000000",
  value: "2.50",
  priceUsd: "2.50",
  timestamp: 1691234567
}

// Default (no feedId): XRP/USD
```

### Chains & Bridge

```
GET /chains
→ {
  useTestnet: true | false,
  gatewayTestnet: true | false,
  fxrpDecimals: 6,
  chains: [
    {
      id: "flare",
      name: "Flare",
      chainId: 14,
      lzEid: 30295,
      oftAddress: "0xd706...",
      isAdapter: true,
      available: true,
      nativeSymbol: "FLR",
      logoColor: "#FF0000",
      explorer: "https://flare.flarescan.com"
    },
    // ... Ethereum, Base, BSC, HyperEVM, Monad, Katana
  ]
}

GET /bridge-chains
→ {
  gatewayNetwork: "coston2",
  gatewayTestnet: true,
  chains: [
    { id: "base", name: "Base", lzEid: 30184, nativeSymbol: "ETH" },
    // ... destination chains only
  ]
}

POST /bridge-prepare
Body: {
  srcChain: "flare",
  dstChain: "base",
  amount: "100",
  recipient: "0x1234567890123456789012345678901234567890"
}
→ {
  srcChain: { id, name, lzEid },
  dstChain: { id, name, lzEid },
  amount: "100",
  recipient: "0x...",
  quote: { nativeFee: "1000000000000000", lzTokenFee: "0" },
  calls: [
    { to: "0x...", data: "0x...", value: "0" },  // approve
    { to: "0x...", data: "0x...", value: "1000000000000000" }  // send
  ],
  note: "Sign these calls on the source chain..."
}
```

### Portfolio (Cross-Chain Dashboard)

```
GET /portfolio?address=0x1234567890123456789012345678901234567890
→ {
  address: "0x...",
  totalFxrp: "5000",
  totalFxrpUba: "5000000000",
  chainCount: 3,
  chainsWithBalance: 3,
  chains: [
    {
      chainId: "flare",
      chainName: "Flare",
      balance: "1500",
      balanceUba: "1500000000",
      totalSupply: "6000000",
      tokenAddress: "0x0b6A3645c240605887a5532109323A3E12273dc7",
      isAdapter: true,
      error: null
    },
    // ... per-chain data
  ]
}
```

### Exchanges & Redeem

```
GET /exchanges
→ {
  count: 7,
  exchanges: [
    {
      id: "binance",
      name: "Binance",
      depositAddress: "rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1",
      requiresTag: true,
      minDepositXrp: "20",
      depositUrl: "https://www.binance.com/en/my/wallet/account/cross-chain-transfer",
      color: "#F3BA2F",
      initials: "BN"
    },
    // ... Kraken, Coinbase, Bitstamp, Bybit, OKX, Gate.io
  ]
}

POST /prepare-redeem
Body: {
  amountXrp: "100",
  exchangeId: "binance" | null,
  redeemerXrplAddress: "rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1",
  destinationTag: 123456,
  callerAddress?: "0x..."
}
→ {
  function: "redeemWithTag(uint256,string,address,uint32)" | "redeemAmount(...)",
  to: "0x...",  // AssetManager
  data: "0x...",
  value: "0",
  amountXrp: "100",
  amountUba: "100000000",
  redeemerXrplAddress: "rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1",
  destinationTag: 123456 | null,
  exchange: { id, name, depositUrl } | null,
  warnings: ["Min deposit is 20 XRP", "Exchange inactive for deposits"],
  executor: "0x...",
  assetManager: "0x...",
  note: "Sign this calldata on Flare..."
}
```

### Proof of Reserves

```
GET /reserves
→ {
  fxrpTotalSupply: "6140661",
  coreVaultXrpBalance: "5704069",
  coreVaultAddress: "rDhpmiPq4BVBDWMV...",
  backingRatio: "0.9289",
  status: "critical" | "warning" | "healthy" | "unknown",
  bridgedTotal: "1201803",
  timestamp: 1691234567000,
  flareCirculating: "4938858",  // not locked in OFT
  chainSupplies: [
    {
      chainId: "flare",
      chainName: "Flare",
      totalSupply: "4938858",
      isCanonical: true,
      error: null
    },
    // ... per-chain supply
  ]
}
```

### Executor Status (Proxy)

```
GET /executor-status
→ {
  online: true,
  ok: true,
  executor: "0x...",
  network: "coston2",
  dryRun: true,
  coreVault: "rDhpmiPq4BVBDWMV...",
  journal?: {
    count: 42,
    recent: [
      { xrplTxHash: "0x...", status: "success", timestamp: 1691234567000 },
      // ... last 5 entries
    ]
  }
}

GET /executor-status
(offline response)
→ {
  online: false,
  error: "executor not reachable"
}
```

### Memo Decode

```
POST /decode-memo
Body: { memoHex: "0xff0000..." }
→ {
  opcode: "0xff",
  walletId: 0,
  executorFeeUba: "100000000",
  userOpEncodedLengthBytes: 256,
  userOpEncoded: "0x..."
}
```

### Gasless Redeem (Smart Account)

```
POST /prepare-gasless-redeem
Body: {
  xrplAddress: "rN7n7otQDd6FczFgLdhmKosrHRmUUGhK1",
  amountXrp: "50",
  destinationAddress: "rDestinationR...",
  destinationTag?: 12345,
  executorFeeUba?: "100000000"
}
→ {
  payment: { TransactionType, Account, Destination, Amount, Fee, Memos },
  memoHex: "0xff...",
  userOpCallDataHash: "0x...",
  personalAccount: "0x...",
  nonce: "123",
  operatorXrplAddress: "rOperator...",
  amountXrp: "50",
  destinationAddress: "rDestinationR...",
  destinationTag: 12345 | null,
  executorFeeUba: "100000000",
  assetManager: "0x...",
  note: "Sign this 1-drop Payment..."
}

POST /submit-gasless-redeem
Body: { transactionId: "0x...", xrplAddress: "rN7n7..." }
→ {
  status: "submitted" | "error",
  transactionId: "0x...",
  proofTxHash?: "0x...",
  votingRoundId?: "123456",
  executeTxHash?: "0x...",
  error?: "..."
}
```

---

## 🎨 Component Library & Utilities

Build these reusable components with TypeScript + vanilla DOM or framework of choice:

### 1. **Page Shell**
- **Header** (fixed top bar)
  - Logo + title + tagline
  - Network selector or status badge (live indicator, chain name)
  - Nav links (Mint Gateway ↔ Dashboard)
- **Footer**
  - Links to docs
  - Disclaimer text (read-only, no keys, no signing)
  - Optional: build timestamp

### 2. **Modals & Sheets**

#### **Modal Base**
```typescript
interface ModalConfig {
  id: string;
  title: string;
  closeButton?: boolean;
  backdrop?: "blur" | "dark" | "transparent";
  size?: "sm" | "md" | "lg";
  onClose?: () => void;
}
```
- Methods: `open()`, `close()`, `isOpen(): boolean`
- Keyboard: Escape to close, Tab trap, auto-focus first input
- Backdrop: Click to close (optional)

#### **Slide Sheet (from bottom/side)**
```typescript
interface SlideSheetConfig {
  id: string;
  title: string;
  position?: "bottom" | "right";
  closeButton?: boolean;
  onClose?: () => void;
}
```
- Used for mobile-first forms (redeem, bridge, gasless)
- Swipe-down gesture on mobile
- Smooth slide-in animation (250ms easing)

### 3. **Form Components**

#### **Input Field**
```typescript
interface InputFieldConfig {
  label: string;
  placeholder: string;
  type?: "text" | "number" | "email";
  required?: boolean;
  hint?: string;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  pattern?: string;
  inputmode?: "decimal" | "numeric" | "tel";
}
```
- Input + label + optional hint (small text below)
- Optional error state (red border, error message)
- Auto-focus on mount (if first field)

#### **Select Dropdown**
```typescript
interface SelectConfig {
  label: string;
  options: { label: string; value: string }[];
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  value?: string;
  hint?: string;
  searchable?: boolean; // filter options as type
}
```
- Keyboard nav (arrow keys, enter)
- Search filter for long lists (exchanges, chains)
- Accessible (aria-listbox, aria-selected)

#### **Radio Group**
```typescript
interface RadioGroupConfig {
  name: string;
  options: { label: string; value: string; description?: string }[];
  onChange?: (value: string) => void;
  value?: string;
}
```
- Used for action selection (mint-only, transfer, redeem, etc.)
- Vertical or horizontal layout

#### **Textarea**
```typescript
interface TextareaConfig {
  label: string;
  placeholder: string;
  rows?: number;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
  readonly?: boolean;
  spellcheck?: boolean;
}
```
- Auto-expand height on input (up to max)
- Used for memo hex, Payment JSON preview

### 4. **Button Variants**

```typescript
enum ButtonVariant {
  PRIMARY = "primary",       // solid accent background
  SECONDARY = "secondary",   // outline accent border
  GHOST = "ghost",           // transparent, light border
  DANGER = "danger",         // red/warn background
  DISABLED = "disabled"      // grayed out
}

interface ButtonConfig {
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;  // show spinner
  icon?: string;      // emoji or svg
  title?: string;     // tooltip
}
```
- Loading state: spinner inside button
- Disabled: reduced opacity, no pointer
- All buttons: 300ms transition on hover

### 5. **Data Display Components**

#### **Card**
```typescript
interface CardConfig {
  title?: string;
  border?: boolean;
  highlight?: boolean; // accent-colored border
  padding?: "sm" | "md" | "lg";
}
```
- Contained box with subtle shadow
- Optional highlight border (for active cards)
- Used for: chains, vaults, summary blocks

#### **Chain Badge Card**
```typescript
interface ChainBadgeCardConfig {
  chainId: string;
  chainName: string;
  logoColor: string;
  balance: string;
  balanceUba: string;
  totalSupply: string;
  isAdapter?: boolean;
  error?: string;
  explorerUrl?: string;
  onBridgeClick?: () => void;
}
```
- Circular colored badge + chain name + type label
- Large balance display (1.5rem, bold)
- Supply row (dim text)
- Optional "Bridge from" button + Explorer link

#### **Key-Value Pair (dl)**
```typescript
interface KVPairConfig {
  label: string;
  value: string;
  unit?: string;
  status?: "ok" | "warn" | "error";
  copyable?: boolean;  // show copy icon
}
```
- Two-column layout
- Optional copy-to-clipboard (label or value)
- Color-coded status (green/yellow/red)

#### **Stat Block**
```typescript
interface StatBlockConfig {
  label: string;  // uppercase small text
  value: string;  // large bold text
  subtitle?: string;  // dim small text
  color?: string;     // accent override
}
```
- Used in summary (total FXRP, chains with balance, price, ratio)

#### **Result Block (Code Preview)**
```typescript
interface ResultBlockConfig {
  label: string;
  content: string;  // pre-formatted text (JSON, hex, etc.)
  copyable?: boolean;
  maxHeight?: string;  // default "300px"
  language?: "json" | "hex" | "plaintext";  // for syntax highlight (optional)
}
```
- Monospace font, background, horizontal scroll
- Copy button (top-right)
- Max height with vertical scroll
- Optional: syntax highlighting (JSON pretty-print)

#### **Status Indicator**
```typescript
interface StatusIndicatorConfig {
  status: "online" | "offline" | "checking";
  text: string;
  details?: string;
}
```
- Colored dot (green=online, red=offline, yellow=checking)
- Pulsing animation for checking state
- Used in executor panel

#### **Table / List Row (Distribution)**
```typescript
interface DistributionRowConfig {
  chainName: string;
  supply: string;
  percentage: string;
  isCanonical?: boolean;  // badge
  error?: string;
}
```
- Flex row: chain name | supply | percentage
- Optional badge for canonical supply
- Optional error message (red text)

### 6. **Loading & Error States**

#### **Spinner/Loader**
- Rotating circle or animated dots
- Used during API calls
- Embedded in buttons (loading variant) or standalone in panels

#### **Error Message**
```typescript
interface ErrorMessageConfig {
  message: string;
  recoverable?: boolean;  // show retry button
  onRetry?: () => void;
}
```
- Red background, alert icon
- Clear message + optional "Retry" button
- Used in API error catches

#### **Empty State**
```typescript
interface EmptyStateConfig {
  icon: string;  // emoji
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}
```
- Used when: no chains with balance, no journal entries, etc.

#### **Skeleton Loader**
- Placeholder shimmer during data fetch
- Used for: chain grid, portfolio summary, executor journal

### 7. **Utility Functions**

#### **Formatting**
```typescript
function formatNumber(value: string | number, options?: {
  decimals?: number;  // default 6
  notation?: "compact" | "standard";  // "1M" vs "1000000"
  locale?: string;  // "en-US" default
}): string

function formatEther(weiStr: string, decimals?: number): string
function formatUsd(amountStr: string, priceUsd: string): string

function truncateAddress(addr: string, chars?: number): string
  // "0x1234...7890"

function formatTimestamp(ts: number): string
  // "2 minutes ago" or "Oct 12, 2:34 PM"
```

#### **Validation**
```typescript
function isValidEvmAddress(addr: string): boolean
function isValidXrplAddress(addr: string): boolean
function isValidEthereumAmount(amount: string): boolean
  // decimal, positive, not too many decimals
```

#### **API Helpers**
```typescript
async function fetchWithRetry(
  path: string,
  options?: RequestInit,
  retries?: number
): Promise<any>

async function getPortfolio(address: string): Promise<PortfolioData>
async function getChains(): Promise<Chain[]>
async function getExchanges(): Promise<Exchange[]>
// ... one helper per major endpoint

function buildCacheKey(endpoint: string, params: object): string
function getCachedData<T>(key: string): T | null
function setCachedData<T>(key: string, data: T, ttlSeconds?: number): void
  // 5min default TTL, 1hr for static data (exchanges, chains)
```

#### **Local Storage**
```typescript
function saveSetting(key: string, value: any): void
function loadSetting(key: string): any | null

// Auto-use cases:
// - saved exchange destination tags
// - last viewed address
// - dashboard mode (testnet vs mainnet)
```

#### **Copy to Clipboard**
```typescript
async function copyText(text: string): Promise<void>
  // shows toast: "Copied!" (2s fade-out)
```

#### **Toast Notifications**
```typescript
type ToastType = "info" | "success" | "warning" | "error";

function showToast(message: string, type?: ToastType, duration?: number): void
  // default 3s, auto-dismiss
  // stackable (max 3 toasts)
```

---

## 🎯 Page Flows & Interactions

### **Mint Gateway (`/index.html`)**

1. **Load Status**
   - On page load: `GET /status` → populate network badge, core vault, fees
   - If offline: show error banner, disable all interactions

2. **Step 1: Resolve Smart Account**
   - User enters XRPL r-address (r...)
   - Click "Resolve" → `GET /personal-account?xrplAddress=...`
   - Populate: personalAccount (0x...), nonce, FXRP balance
   - Error: invalid r-address format, RPC offline → show error toast

3. **Step 2: Choose Action**
   - Radio cards: mint_only, transfer, redeem, redeem_with_tag, vault_deposit, bridge
   - On change: render action-specific fields
   - **Mint Only**: no fields
   - **Transfer**: toFlareAddress (0x...), fxrpAmountXrp
   - **Redeem**: redeemerXrplAddress (r...), fxrpAmountXrp
   - **Redeem with Tag**: redeemerXrplAddress, destinationTag (number), fxrpAmountXrp
   - **Vault Deposit**:
     - Load: `GET /vaults` → populate select with [Firelight, Upshift, ...]
     - Show vault balance as hint below
     - fxrpAmountXrp
   - **Bridge**:
     - Load: `GET /bridge-chains` → populate destination chain select
     - dstChain select, recipientAddress (0x...), fxrpAmountXrp

4. **Step 3: Quote**
   - User enters XRP amount in `amountXrp` field
   - Click "Quote" → `POST /quote { paymentXrp }`
   - Display: minting fee, executor fee, you'll receive (or ⚠ below minimum)
   - Error handling: show error toast

5. **Step 4: Prepare Payment**
   - Pre-filled: xrplAddress (from Step 1), amountXrp (from Step 3), action
   - Click "Prepare payment" → `POST /prepare-payment { xrplAddress, amountXrp, action }`
   - Render result block:
     - kind (mint_only | mint_and_action)
     - personalAccount, nonce
     - memoHex (copyable)
     - calls preview (if action)
     - Payment JSON (copyable)
   - Show warning: "Sign this Payment in your XRPL wallet. Do not add destination tag."

### **Cross-Chain Dashboard (`/dashboard.html`)**

1. **Load Chains & Exchanges**
   - On page load: `GET /chains`, `GET /exchanges`
   - Populate mode badge (testnet vs mainnet)
   - Populate bridge/redeem selects

2. **Load Portfolio**
   - User enters EVM address (0x...)
   - Click "Load portfolio" → `GET /portfolio?address=0x...`
   - Populate summary: total FXRP, chainCount, chains with balance
   - Render chain grid (Card per chain: balance, supply, "Bridge from" button, Explorer link)
   - **Parallel call**: `GET /ftso-price` → display XRP/USD price + total USD value

3. **Bridge Panel**
   - Default: Flare → Base
   - User selects src/dst chains
   - Enter amount, recipient (defaults to loaded address)
   - Click "Prepare bridge" → `POST /bridge-prepare { srcChain, dstChain, amount, recipient }`
   - Render result:
     - Source / destination chain info
     - LZ native fee
     - 2 calls: approve + send (with data hex)

4. **Redeem Panel** (two modes: toggle radio)
   - **Standalone Redeem** (default):
     - Exchange dropdown (with "— Personal r-address —")
     - On exchange select: auto-fill r-address, show min deposit warning, restore saved tag
     - FXRP amount, signer (your Flare EVM address)
     - Click "Prepare redeem" → `POST /prepare-redeem { amountXrp, exchangeId?, redeemerXrplAddress, destinationTag?, callerAddress }`
     - Render: function sig, to, data, amount, warnings, note
   - **Mint + Redeem**:
     - XRPL source address (mints)
     - XRPL destination r-address, optional tag
     - FXRP amount
     - Click "Prepare redeem" → `POST /prepare-payment { xrplAddress, amountXrp, action: { type: "redeem" | "redeem_with_tag", ... } }`
     - Render: XRPL Payment, memo hex, note

5. **Proof of Reserves Panel**
   - Click "🛡 Reserves" → open modal
   - Load: `GET /reserves`
   - Display:
     - FXRP total supply (canonical)
     - Core Vault XRP balance + address
     - Backing ratio (%) with status color (healthy=green, warning=yellow, critical=red)
     - Bridged to other chains (total)
     - Per-chain supply distribution (table with %)
   - Button: "Refresh"

6. **Executor Status Panel**
   - Click "⚙ Executor" → open modal
   - Load: `GET /executor-status`
   - Display status (online/offline) with pulsing dot + text
   - If online:
     - Executor address, network, dry-run badge
     - Core Vault address
     - Journal entries (recent 5 reversed, showing tx hash + status)
     - Button: "Refresh"
   - If offline: show message + "Start with: npm run executor"

7. **Decode Memo Tool**
   - Click "🔍 Decode" → open modal
   - Textarea for memo hex
   - Click "Decode" → `POST /decode-memo { memoHex }`
   - Render: opcode, walletId, executorFeeUba, userOp length, userOp hex

8. **Gasless Redeem**
   - Click "⚡ Gasless Redeem" → open modal
   - Form: xrplAddress, amount, destinationAddress, destinationTag, executorFeeUba
   - Click "Prepare gasless redeem" → `POST /prepare-gasless-redeem { ... }`
   - Render: Payment JSON, memo hex, instructions
   - Show: "After signing & broadcasting, paste tx hash"
   - Textarea for tx hash + "Submit to executor" button
   - Click → `POST /submit-gasless-redeem { transactionId, xrplAddress }`
   - Render result: status, tx hash, voting round, execute tx hash

---
## 📱 Responsive Behavior

### **Mobile (< 640px)**
- Stack layout: sections full-width
- Modals → slide sheets from bottom (swipe-down to close)
- Chain grid → 1 column
- Forms → full-width inputs
- Header nav → hamburger menu (or collapse to back link)
- Summary blocks → grid 1–2 columns

### **Tablet (640px–1024px)**
- Chain grid → 2 columns
- Forms → 2 columns (if space)
- Modals → centered, 90vw max-width
- Summary blocks → grid 2 columns

### **Desktop (> 1024px)**
- Chain grid → 3–4 columns
- Forms → full width with labeled columns
- Modals → centered, 600px width
- Summary blocks → grid 4 columns

---

## ♿ Accessibility Checklist

- [ ] All form inputs have `<label>` elements (associated via `id`/`for`)
- [ ] Buttons have descriptive text (not just icons)
- [ ] Color is not the only indicator (use text + icons)
- [ ] Contrast: text > 4.5:1, large text > 3:1 (WCAG AA)
- [ ] Keyboard navigation: Tab, Shift+Tab, Enter, Escape
- [ ] Focus indicators: visible blue/accent outline
- [ ] ARIA labels: `aria-label`, `aria-describedby`, `aria-live` for dynamic updates
- [ ] Images: `alt` text (or empty `alt=""` for decorative)
- [ ] Error messages linked to inputs: `aria-invalid="true"`, `aria-describedby="error-id"`
- [ ] Toast notifications: `role="alert"`, auto-announce
- [ ] Skip link: "Skip to main content"

---

## ⚡ Performance Targets

- **First Contentful Paint (FCP)**: < 1.5s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **Cumulative Layout Shift (CLS)**: < 0.1
- **Time to Interactive (TTI)**: < 3.5s

### **Optimization Techniques**
- **Code Splitting**: Separate JS for each page (`/index.html` vs `/dashboard.html`)
- **Lazy Load**: Modals, images, charts (only on open/scroll)
- **API Caching**: 5min TTL for dynamic (portfolio, reserves), 1hr for static (exchanges, chains)
- **Debounce**: Search inputs (300ms), resize (300ms)
- **Memoization**: Chain grid re-renders, quote calculations
- **Compression**: gzip/brotli for CSS, JS, JSON
- **CDN**: Static assets (CSS, fonts, SVG icons)

---

## 🧪 Testing & QA

### **Unit Tests**
- Formatting functions (formatNumber, formatEther, truncateAddress)
- Validation functions (isValidEthereumAddress, isValidXrplAddress)
- Local storage helpers
- API cache logic

### **Integration Tests**
- Page load flows (status → account → action → quote → prepare)
- Form submission (validation, API call, result display, error handling)
- Modal open/close with keyboard & backdrop
- Dropdown search & selection
- Copy-to-clipboard functionality

### **E2E Tests (Cypress / Playwright)**
- Mint Gateway: resolve account → select action → quote → prepare payment
- Dashboard: load portfolio → bridge → redeem → reserves → executor
- Gasless redeem: prepare → (mock tx hash) → submit
- Error scenarios: offline RPC, invalid inputs, API failures

### **Manual QA**
- Cross-browser: Chrome, Firefox, Safari, Edge
- Mobile device (iOS/Android real device): touch, gestures
- Accessibility: NVDA, JAWS, VoiceOver
- Network throttle: fast 3G, slow 4G, offline
- Large/small screens: 320px–2560px

---

## 🚀 Deployment & Hosting

- **Static hosting**: Vercel, Netlify (CI/CD on git push)
- **Build output**: `/dist` or `/build` with `index.html` + `/dashboard.html`
- **Environment variables**: `.env.local` (RPC, executor URL, network mode)
- **Error tracking**: Sentry (optional, for production)
- **Analytics**: Plausible or no tracking (privacy-first)

---

## 📚 File Structure (Recommended)

```
public/
  index.html                    # Mint Gateway
  dashboard.html                # Cross-Chain Dashboard
  styles.css                    # Global styles + design tokens
  app.js                        # Mint Gateway logic
  dashboard.js                  # Dashboard logic
  
src/ (if using TypeScript + bundler)
  pages/
    MintGateway.ts
    Dashboard.ts
  components/
    Modal.ts
    SlideSheet.ts
    InputField.ts
    SelectDropdown.ts
    ChainBadgeCard.ts
    CardLayout.ts
    StatusIndicator.ts
    ... (one file per component)
  utils/
    format.ts                   # formatNumber, formatEther, etc.
    validation.ts               # isValidEthereumAddress, etc.
    api.ts                      # fetch helpers, endpoints
    cache.ts                    # getCachedData, setCachedData
    storage.ts                  # saveSetting, loadSetting
    toast.ts                    # showToast
    clipboard.ts                # copyText
  styles/
    variables.css               # :root { --accent, --bg, ... }
    components.css              # .button, .card, .input, etc.
    layout.css                  # .header, .footer, .main, etc.
  index.ts                      # Entry point (if bundler)
```

---

## 🎓 Summary for Frontend Engineer

**Your Mission:**
1. **Build two full pages** with real API integration (no mocking)
2. **Implement 15+ UI components** (modals, forms, cards, status indicators)
3. **Create utility functions** for formatting, validation, API calls, caching
4. **Ensure responsive design** (mobile-first, 320px–2560px)
5. **Maintain accessibility** (WCAG 2.1 AA, keyboard nav, ARIA)
6. **Optimize performance** (< 2.5s LCP, cache API responses)
7. **Add error handling** (offline RPC, invalid inputs, API failures)
8. **Write tests** (unit, integration, E2E)

**Key Constraints:**
- Read-only: no private keys, no signing, no broadcasting
- Real-time data: async API calls with loading/error states
- Responsive: works on all devices
- Accessible: keyboard nav, screen readers, high contrast

**Deliverables:**
- [ ] `/index.html` + `/app.js` — Mint Gateway (production-ready)
- [ ] `/dashboard.html` + `/dashboard.js` — Cross-Chain Dashboard (production-ready)
- [ ] Component library (modals, forms, cards, utilities)
- [ ] Global styles (design tokens, responsive grid)
- [ ] Test suite (unit + E2E)
- [ ] Documentation (component API, color palette, examples)

**Success Metrics:**
- ✅ All pages load & display real API data
- ✅ All forms validate inputs & submit correctly
- ✅ All buttons, links, modals work (mouse + keyboard)
- ✅ Responsive on mobile (320px), tablet (768px), desktop (1440px)
- ✅ Accessible to screen readers & keyboard users
- ✅ FCP < 1.5s, LCP < 2.5s
- ✅ 0 console errors, 0 accessibility warnings (axe)

---

## 📖 References

- **ethers.js v6**: https://docs.ethers.org/v6/
- **LayerZero OFT**: https://layerzero.gitbook.io/docs/evm-guides/oft
- **XRPL.js**: https://js.xrpl.org/
- **Flare Developer Hub**: https://dev.flare.network/
- **Accessible Modals**: https://www.w3.org/WAI/ARIA/apg/patterns/dialogmodal/
- **Responsive Design**: https://web.dev/responsive-web-design-basics/
- **Performance**: https://web.dev/vitals/

---

**End of Specification**

Build great UI! 🚀

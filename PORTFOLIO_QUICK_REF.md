# Portfolio.html: Quick Reference Card

## 📊 Page at a Glance

| Aspect | Details |
|--------|---------|
| **File** | `/public/portfolio.html` |
| **Purpose** | Omnichain FXRP portfolio dashboard |
| **Layout** | 12-column grid (Tailwind) |
| **Status** | 80% styled template, 20% hardcoded demo data |
| **Theme** | Material Design 3 Dark (Material Symbols icons) |
| **Responsive** | Mobile (1 col), Tablet (2 col), Desktop (12 col) |

---
install [canddao1-dotcom/flare-agent-skills: DeFi skills for AI agents on Flare Network. Built for OpenClaw.](https://github.com/canddao1-dotcom/flare-agent-skills), you can know how to do wallet connection for xrp and flare , so that we can add wllet connect to portfolio html as well
## 🎯 5 Main Sections → 7 API Endpoints

### **Section 1: 4 Stat Cards (Top)**
```
Card 1: Total Portfolio Value  → GET /portfolio + GET /ftso-price
Card 2: Total FXRP Supply      → GET /reserves
Card 3: Core Vault Ratio       → GET /reserves (status color logic)
Card 4: FTSO XRP Price         → GET /ftso-price
```

### **Section 2: Cross-Chain Table (Middle-Left)**
```
7 rows of chains (Ethereum, Arbitrum, Optimism, Polygon, Avalanche, BSC, Base)
Data → GET /portfolio + GET /ftso-price + GET /chains
Columns: Chain | Balance | USD Value | % of Total (with bar)
```

### **Section 3: Bridge/Redeem Widget (Middle-Right)**
```
From [Dropdown] → To [Dropdown]    → GET /chains (populate)
Amount [Input]  (Max button)       → GET /portfolio (balance)
Route Info (Fee, Time, Receive)    → POST /bridge-prepare (on change)
[Prepare Calldata] Button          → Show modal result
```

### **Section 4: Backing History Chart (Bottom-Left)**
```
Bar chart: XRP Locked vs FXRP Minted over time (Oct → Now)
Data → GET /reserves (historical snapshots)
Need: Chart.js or D3 for rendering
```

### **Section 5: Relayer Health Table (Bottom-Right)**
```
4 executor nodes with status (Healthy/Degraded)
Data → GET /executor-status
Columns: Name | Status (badge) | Processed (24h)
```

---

## 🔌 API Calls Map

```
Page Load
├─ GET /status                    [network info]
├─ GET /chains                    [chain list for dropdowns]
└─ User enters address 0x...
   ├─ GET /portfolio?address=     [all balances]
   ├─ GET /ftso-price             [XRP/USD price]
   ├─ GET /reserves               [supply, ratio, backing]
   └─ GET /executor-status        [relayer health]

User Changes Bridge Amount/Chain
└─ POST /bridge-prepare {srcChain, dstChain, amount, recipient}
   └─ Display: Est. Receive, Network Fee, Est. Time
```

---

## 🎨 Color Scheme (Tailwind Config)

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Background | `surface` | #131313 | Main bg |
| Card | `surface-container` | #201f1f | Card bg |
| Accent | `primary` | #d0ffdc | Buttons, highlights, green |
| Secondary | `secondary` | #d4bbff | Alternative accent |
| Error | `error` | #ffb4ab | Warnings, degraded status |
| Text | `on-surface` | #e5e2e1 | Main text |
| Dim Text | `on-surface-variant` | #bacbbc | Labels, hints |
| Border | `outline-variant` | #3b4a3f | Card borders, dividers |

---

## 📐 Grid Layout

```
12-Column Layout on Desktop:

┌──────────────────────────────────────────────────────────────┐
│ STAT CARDS (4 × col-span-3)                                 │
├──────────────────────────────────────────────────────────────┤
│ CHAIN TABLE (col-span-7)     │ BRIDGE WIDGET (col-span-5)   │
├──────────────────────────────────────────────────────────────┤
│ BACKING CHART (col-span-6)   │ RELAYER TABLE (col-span-6)   │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Data Fields to Bind

### From `/portfolio`
```javascript
portfolio.totalFxrp          // Sum across all chains
portfolio.chains[].balance   // Per-chain FXRP
portfolio.chains[].chainName
portfolio.chains[].tokenAddress
portfolio.chainCount
```

### From `/ftso-price`
```javascript
ftsoPrice.priceUsd           // XRP/USD (e.g., 0.6124)
ftsoPrice.timestamp          // For trend calcs
```

### From `/reserves`
```javascript
reserves.fxrpTotalSupply     // Canonical supply
reserves.coreVaultXrpBalance // Backing amount
reserves.backingRatio        // Ratio (e.g., 1.05)
reserves.status              // "healthy" | "warning" | "critical"
reserves.bridgedTotal        // Sum across chains
reserves.timestamp           // Last update
```

### From `/executor-status`
```javascript
executor.online              // true/false
executor.dryRun              // dev mode indicator
executor.network             // "coston2" etc
executor.journal.count       // Total processed
executor.journal.recent[]    // Last 5 entries
```

### From `/chains`
```javascript
chains[].id                  // "ethereum", "base", etc
chains[].logoColor           // Hex color for badge
chains[].name                // Display name
chains[].chainId             // Chain ID
```

---

## 💾 Hardcoded Demo Data (To Replace)

| What | Current | Source After API |
|------|---------|------------------|
| Total Value | $1.24M | `portfolio.totalFxrp × ftsoPrice.priceUsd` |
| Supply | 845,291.42 | `reserves.fxrpTotalSupply` |
| Ratio | 1.05x | `reserves.backingRatio` |
| Price | $0.6124 | `ftsoPrice.priceUsd` |
| Chain rows | 7 hardcoded | `portfolio.chains.map(...)` |
| Chart bars | Pseudo-visual | Chart.js with historical data |
| Relayer rows | 4 hardcoded | `executor-status` response |
| Trends (24h, 7d, 1h) | Static text | Need snapshot history |

---

## 🛠️ Implementation Checklist

```
PHASE 1: Data Fetching
☐ Create portfolio.js with API helpers
☐ fetchPortfolio(address)
☐ fetchFtsoPrice()
☐ fetchReserves()
☐ fetchExecutorStatus()
☐ Add error handling, retry logic, caching

PHASE 2: Data Binding
☐ Bind stat card values → API fields
☐ Bind chain table rows → portfolio.chains
☐ Bind bridge dropdown → GET /chains
☐ Bind balance helper → portfolio.chains[idx].balance
☐ Format numbers (decimals, USD, percentages)

PHASE 3: Interactions
☐ Wire Max button → set input to balance
☐ Wire amount/chain change → POST /bridge-prepare
☐ Wire Prepare Calldata → show modal with result
☐ Wire tab toggle → Bridge/Redeem switch
☐ Add loading spinners during fetch

PHASE 4: Charting
☐ Add Chart.js library
☐ Render backing history (grouped bars or line)
☐ Make it responsive (resize on window change)

PHASE 5: Polish
☐ Loading states (skeleton, spinners)
☐ Error states (messages, retry)
☐ Real-time updates (30s/1m polling)
☐ Accessibility (WCAG AA, keyboard, screen readers)
☐ Mobile responsiveness
```

---

## 📝 Code Structure (Recommended)

```javascript
// portfolio.js

// === API Functions ===
async function fetchPortfolio(address) { ... }
async function fetchFtsoPrice() { ... }
async function fetchReserves() { ... }
async function fetchExecutorStatus() { ... }
async function fetchBridgeRoute(srcChain, dstChain, amount) { ... }

// === Calculation Functions ===
function calculatePortfolioValue(fxrp, priceUsd) { ... }
function calculatePercentage(balance, total) { ... }
function getStatusColor(backingRatio) { ... }

// === Format Functions ===
function formatCurrency(value) { ... }
function formatNumber(value, decimals) { ... }
function formatPercentage(value) { ... }

// === UI Update Functions ===
function updateStatCards(portfolio, price, reserves) { ... }
function updateChainTable(portfolio, price, chains) { ... }
function updateBridgeWidget(portfolio, chains) { ... }
function updateChartData(reserves) { ... }
function updateRelayerTable(executor) { ... }

// === Event Handlers ===
function onMaxButtonClick() { ... }
function onAmountChange() { ... }
function onChainChange() { ... }
function onPrepareCalldata() { ... }
function onTabChange(tab) { ... }

// === Main Init ===
async function initDashboard(address) {
  const [portfolio, price, reserves, executor] = 
    await Promise.all([
      fetchPortfolio(address),
      fetchFtsoPrice(),
      fetchReserves(),
      fetchExecutorStatus()
    ]);
  
  updateStatCards(portfolio, price, reserves);
  updateChainTable(portfolio, price, chains);
  updateBridgeWidget(portfolio, chains);
  updateRelayerTable(executor);
}
```

---

## 🚀 Next Steps

1. **Copy** `portfolio.html` as-is (structure is ready)
2. **Create** `portfolio.js` with API helpers
3. **Test** each API endpoint individually first
4. **Bind** data to DOM elements (start with stat cards)
5. **Add** interactions (Max button, amount change)
6. **Add** loading/error states
7. **Add** Chart.js for backing history
8. **Polish** and deploy

---

## 📚 Reference Docs

- **Full Spec**: [FRONTEND_SPEC.md](./FRONTEND_SPEC.md)
- **Detailed Analysis**: [PORTFOLIO_ANALYSIS.md](./PORTFOLIO_ANALYSIS.md)
- **API Mapping**: [PORTFOLIO_API_MAPPING.md](./PORTFOLIO_API_MAPPING.md)
- **Backend Code**: [server/index.ts](./server/index.ts)

---

**Status**: ✅ Analysis complete, ready for implementation

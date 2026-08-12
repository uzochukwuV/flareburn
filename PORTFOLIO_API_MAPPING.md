# Portfolio.html → API Mapping (Visual Guide)

## 🎯 Quick Reference: Sections & APIs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OMNICHAIN PORTFOLIO DASHBOARD                          │
│                           /portfolio.html                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ SIDEBAR (Left, Desktop Only) + HEADER (Top, Fixed)                  │
│ - Logo, Connect Wallet, Nav Links, Icons                            │
│ - API: None (UI only)                                               │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP ROW: 4 STAT CARDS (col-span-3 each)                                      │
├──────────────────────────────────────────────────────────────────────────────┤

┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
│ Total Portfolio     │  │ Total FXRP Supply   │  │ Core Vault Ratio     │
│ Value               │  │                     │  │ ⭐ (Highlighted)     │
├─────────────────────┤  ├─────────────────────┤  ├──────────────────────┤
│ $1.24M              │  │ 845,291.42 FXRP     │  │ 1.05x                │
│ +5.2% (24h) ▲       │  │ +1.1% (7d) ▲        │  │ Overcollateralized   │
├─────────────────────┤  ├─────────────────────┤  ├──────────────────────┤
│ API Source:         │  │ API Source:         │  │ API Source:          │
│ GET /portfolio      │  │ GET /reserves       │  │ GET /reserves        │
│ GET /ftso-price     │  │                     │  │                      │
│                     │  │ Field:              │  │ Field:               │
│ Field:              │  │ fxrpTotalSupply     │  │ backingRatio (1.05)  │
│ totalFxrp           │  │                     │  │ coreVaultXrpBalance  │
│ × priceUsd          │  │ Display:            │  │ fxrpTotalSupply      │
│ = $1.24M            │  │ 845,291.42          │  │                      │
│                     │  │                     │  │ Status Color:        │
│ Calc:               │  │ Trend:              │  │ Green (healthy ≥1.01)│
│ 2M FXRP             │  │ Need historical     │  │ Yellow (warning)     │
│ × $0.62 USD         │  │ data for 7d chg     │  │ Red (critical <0.95) │
│ = $1.24M            │  │                     │  │                      │
│                     │  │                     │  │ Display:             │
│ Trend:              │  │                     │  │ 1.05x (4 decimals)   │
│ 24h change          │  │                     │  │                      │
│ (need snapshot)     │  │                     │  │                      │
└─────────────────────┘  └─────────────────────┘  └──────────────────────┘

┌─────────────────────┐
│ FTSO XRP Price      │
├─────────────────────┤
│ $0.6124             │
│ -0.4% (1h) ▼        │
├─────────────────────┤
│ API Source:         │
│ GET /ftso-price     │
│                     │
│ Field:              │
│ priceUsd            │
│                     │
│ Display:            │
│ $0.6124             │
│                     │
│ Trend:              │
│ 1h change           │
│ (need snapshot)     │
└─────────────────────┘

└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ MIDDLE ROW: 2 WIDE PANELS                                                    │
├──────────────────────────────────────────────────────────────────────────────┤

┌────────────────────────────────────────┐  ┌──────────────────────────────┐
│ CROSS-CHAIN DISTRIBUTION (7 cols)      │  │ BRIDGE/REDEEM (5 cols)       │
├────────────────────────────────────────┤  ├──────────────────────────────┤
│ Table: Chain | Balance | USD | %       │  │ Tabs: Bridge | Redeem        │
├────────────────────────────────────────┤  ├──────────────────────────────┤
│ Ethereum    450,210   $275.7K   53.2%  │  │ From: [Ethereum ▼]           │
│ Arbitrum    185,400   $113.5K   21.9%  │  │ To:   [Arbitrum ▼]           │
│ Optimism     82,100    $50.3K    9.7%  │  ├──────────────────────────────┤
│ Polygon      55,300    $33.9K    6.5%  │  │ Amount: 10000 FXRP           │
│ Avalanche    40,000    $24.5K    4.7%  │  │ Balance: 450,210.00 [MAX]    │
│ BSC          25,180    $15.4K    3.0%  │  ├──────────────────────────────┤
│ Base          7,100     $4.3K    1.0%  │  │ Est. Receive: 10,000 FXRP    │
│                                         │  │ Network Fee:  ~$4.20         │
│                                         │  │ Est. Time:    ~2 Mins        │
│                                         │  ├──────────────────────────────┤
│ API Source:                             │  │ [Prepare Calldata]           │
│ GET /portfolio → portfolio.chains[]     │  │                              │
│ GET /ftso-price → priceUsd              │  │ API Sources:                 │
│ GET /chains → logoColor for badge      │  │ GET /portfolio (balance)     │
│                                         │  │ GET /chains (dropdowns)      │
│ Data Binding:                           │  │ POST /bridge-prepare (route) │
│ - Chain name: chainName                 │  │                              │
│ - FXRP Balance: balance                 │  │ Data Binding:                │
│ - USD Value: balance × priceUsd         │  │ - From/To: chain dropdowns   │
│ - % of Total: (balance/totalFxrp)*100  │  │ - Amount: input field        │
│ - Progress bar width: percentage        │  │ - Balance: from portfolio    │
│ - Badge color: logoColor                │  │ - Route info: from POST      │
│                                         │  │                              │
│ Interactions:                           │  │ Interactions:                │
│ - Hover row: highlight bg               │  │ - Change chain: re-POST      │
│ - Click row: maybe pin/expand           │  │ - Amount change: debounce    │
│                                         │  │ - Max button: set balance    │
│                                         │  │ - Prepare: show modal result │
└────────────────────────────────────────┘  └──────────────────────────────┘

└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ BOTTOM ROW: 2 CHARTS/TABLES                                                  │
├──────────────────────────────────────────────────────────────────────────────┤

┌────────────────────────────────────────┐  ┌──────────────────────────────┐
│ SYSTEM BACKING HISTORY (6 cols)        │  │ RELAYER NETWORK HEALTH (6)   │
├────────────────────────────────────────┤  ├──────────────────────────────┤
│ Legend:                                │  │ Table: Name | Status | Proc. │
│ ● XRP Locked (green)                   │  ├──────────────────────────────┤
│ ● FXRP Minted (purple)                 │  │ Alpha-Relay-01 ✓ Healthy    │
│                                         │  │ Beta-Relay-02  ✓ Healthy    │
│ Bar Chart (pseudo-visualization):       │  │ Gamma-Relay-03 ✗ Degraded   │
│ ┌──────────────────────────────────┐   │  │ Delta-Relay-04 ✓ Healthy    │
│ │ Oct 1  Nov 1  Dec 1  Now        │   │  │                              │
│ │ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║  │   │  │ API Source:                  │
│ │ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║ ║║  │   │  │ GET /executor-status         │
│ │  (green=XRP, purple=FXRP)       │   │  │                              │
│ │  Ratio over time (backing)      │   │  │ Data Binding:                │
│ │  Last bar has glow (newest)     │   │  │ - Node Name: executor ID     │
│ └──────────────────────────────────┘   │  │ - Status: online/offline     │
│                                         │  │ - Processed: journal.count   │
│ API Source:                             │  │ - Color: online→green        │
│ GET /reserves (historical backing)      │  │          offline→red         │
│ Maybe need time-series endpoint         │  │          degraded→yellow    │
│                                         │  │                              │
│ Data Binding:                           │  │ Interactions:                │
│ - XRP bar height: coreVaultXrpBalance   │  │ - Hover row: highlight       │
│ - FXRP bar height: fxrpTotalSupply      │  │ - Pulsing dot: live status   │
│ - Bar pairs: per historical snapshot    │  │                              │
│ - Time labels: snapshot timestamps      │  │                              │
│                                         │  │                              │
│ Need Implementation:                    │  │                              │
│ - Chart library (Chart.js)              │  │                              │
│ - Historical data fetch                 │  │                              │
│ - Ratio calculations                    │  │                              │
└────────────────────────────────────────┘  └──────────────────────────────┘

└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 API Endpoint Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INITIALIZATION (on page load)                                           │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. GET /status                                                          │
│    └─ Network badge, core vault address                                │
│                                                                         │
│ 2. GET /chains (parallel)                                              │
│    └─ Bridge widget dropdowns, chain logos/colors                      │
│                                                                         │
│ 3. User enters EVM address (0x...)                                     │
│    ↓                                                                    │
│ 4. GET /portfolio?address=0x... (parallel)                             │
│    └─ All chain balances, total FXRP                                   │
│                                                                         │
│ 5. GET /ftso-price (parallel)                                          │
│    └─ XRP/USD price for all calculations                               │
│                                                                         │
│ 6. GET /reserves (parallel)                                            │
│    └─ FXRP supply, backing ratio, vault balance                        │
│                                                                         │
│ 7. GET /executor-status (parallel)                                     │
│    └─ Relayer health, processed count                                  │
│                                                                         │
│ Then render:                                                            │
│ ✓ All 4 stat cards                                                      │
│ ✓ Cross-chain table                                                     │
│ ✓ Bridge widget with balance                                            │
│ ✓ Backing history chart                                                 │
│ ✓ Relayer health table                                                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ USER INTERACTIONS                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│ Change Amount or Chain → POST /bridge-prepare                           │
│ └─ Display route info (est. receive, network fee, time)                │
│                                                                         │
│ Click Max Button → populate input with portfolio.chains[idx].balance   │
│                                                                         │
│ Click Prepare Calldata → show result modal with API response           │
│                                                                         │
│ Switch to Redeem tab → similar flow for redeem flows                   │
│                                                                         │
│ Refresh button (optional) → re-fetch all parallel APIs                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Data Field Mappings (API Response → UI Display)

### **Stat Cards**

| Card | API | Response Field | Display | Format |
|------|-----|-----------------|---------|--------|
| Total Value | `/portfolio` + `/ftso-price` | `totalFxrp` × `priceUsd` | $1.24M | Currency with 2 decimals |
| Supply | `/reserves` | `fxrpTotalSupply` | 845,291.42 | Number with 2 decimals, comma-sep |
| Ratio | `/reserves` | `backingRatio` | 1.05x | 4 decimals, status color |
| Price | `/ftso-price` | `priceUsd` | $0.6124 | Currency with 4 decimals |

### **Cross-Chain Table**

| Column | Source | Field | Display | Format |
|--------|--------|-------|---------|--------|
| Chain | `/portfolio` | `chainName` | Ethereum | Text + badge color from `/chains` |
| Balance | `/portfolio` | `balance` | 450,210.00 | Number, 6 decimals |
| USD | `/portfolio` + `/ftso-price` | `balance` × `priceUsd` | $275,708 | Currency, no decimals |
| % | `/portfolio` | `balance` / `totalFxrp` × 100 | 53.2% | Percentage with 1 decimal |

### **Bridge Widget**

| Field | Source | Field | Display |
|-------|--------|-------|---------|
| From | `/chains` | `id` | Dropdown option + badge |
| To | `/chains` | `id` | Dropdown option + badge |
| Amount | Input | User enters | Text input, validate decimal |
| Balance | `/portfolio` | `chains[idx].balance` | Helper text "Bal: 450,210.00" |
| Est. Receive | `/bridge-prepare` | `amount` | Text display |
| Fee | `/bridge-prepare` | `quote.nativeFee` | Text display with conversion |
| Time | Hardcoded | "~2 Mins" | Text display |

### **Backing History Chart**

| Series | Source | Field | Display |
|--------|--------|-------|---------|
| XRP Locked | `/reserves` | `coreVaultXrpBalance` (hist) | Green bar height |
| FXRP Minted | `/reserves` | `fxrpTotalSupply` (hist) | Purple bar height |
| Time Labels | `/reserves` | Snapshot timestamps | Oct 1, Nov 1, Dec 1, Now |

### **Relayer Health Table**

| Column | Source | Field | Display | Format |
|--------|--------|-------|---------|--------|
| Name | `/executor-status` | Hardcoded IDs | Alpha-Relay-01 | Monospace font |
| Status | `/executor-status` | `online` + health | "Healthy" or "Degraded" | Badge with pulsing dot |
| Processed | `/executor-status` | `journal.count` | 12,450 | Number, comma-sep |

---

## ⚙️ Implementation Priorities

### **Tier 1: Core Data (Critical Path)**
```javascript
// 1. Stat cards data
fetchAndRender(
  GET /portfolio,
  GET /ftso-price,
  GET /reserves
);

// 2. Chain table data
renderChainTable(
  portfolio.chains,
  ftsoPrice.priceUsd
);

// 3. Bridge widget
populateChainDropdowns(GET /chains);
updateRouteInfo(POST /bridge-prepare on change);
```

### **Tier 2: Interactions**
```javascript
// 4. Event handlers
onMaxButtonClick();
onAmountChange() → debounce POST /bridge-prepare;
onChainChange() → POST /bridge-prepare;
onPrepareCalldata() → show modal with result;
```

### **Tier 3: Polish**
```javascript
// 5. Loading/error states
showSpinner() during fetch;
showErrorMessage() if API fails;
addRetryButton() for failed calls;

// 6. Chart library
import Chart.js or D3;
renderBackingHistoryChart(GET /reserves);

// 7. Real-time updates
setInterval(() => {
  refreshPortfolio();
  refreshPrice();
}, 30000); // 30s
```

---

## 🧪 Test Data (for development)

### **Example Portfolio Response**
```json
{
  "address": "0x1234567890123456789012345678901234567890",
  "totalFxrp": "2000000",
  "totalFxrpUba": "2000000000000",
  "chainCount": 7,
  "chainsWithBalance": 7,
  "chains": [
    {
      "chainId": "ethereum",
      "chainName": "Ethereum",
      "balance": "450210",
      "balanceUba": "450210000000",
      "totalSupply": "450210000",
      "tokenAddress": "0x...",
      "isAdapter": false,
      "error": null
    },
    // ... 6 more chains
  ]
}
```

### **Example Reserves Response**
```json
{
  "fxrpTotalSupply": "845291.42",
  "coreVaultXrpBalance": "890000",
  "backingRatio": "1.0529",
  "status": "healthy",
  "bridgedTotal": "1201803",
  "timestamp": 1691234567000
}
```

### **Example FTSO Price Response**
```json
{
  "network": "coston2",
  "priceUsd": "0.6124",
  "timestamp": 1691234567
}
```

---

**Ready to implement!** 🚀 Start with Tier 1 data binding, then add Tier 2 interactions, then Tier 3 polish.

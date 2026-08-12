# Portfolio.html Analysis & API Mapping

## 📋 Page Structure Overview

**File**: `/public/portfolio.html`  
**Purpose**: Omnichain Portfolio Dashboard  
**Layout**: Tailwind CSS grid (12-column) with glass-morphism cards  
**Framework**: Vanilla HTML + Tailwind (no JS framework)  
**Status**: ~80% template, 20% hardcoded demo data (needs API integration)

---

## 🎨 Page Sections & Components

### **1. LEFT SIDEBAR (Desktop Only, Hidden on Mobile)**
- **Brand Section**
  - Logo mark: webhook icon in primary-container
  - Title: "FXRP Terminal"
  - Subtitle: "Institutional DeFi"
  
- **Connect Wallet Button** (primary color, full width)

- **Navigation Links**
  - Dashboard (active, highlighted in secondary-container)
  - Mint Gateway
  - Reserves
  - Executors
  - Settings
  
- **Bottom Links**
  - Documentation
  - Log Out

### **2. TOP HEADER BAR (Fixed)**
- **Left**: Mobile menu toggle (hamburger) + page title "Omnichain Portfolio"
- **Right**: 
  - Hub icon
  - Analytics icon
  - Notifications icon (with pulsing red dot)
  - User avatar (circular, person icon)

### **3. MAIN CONTENT AREA (Scrollable)**
Grid layout: `grid-cols-1 md:grid-cols-12` (12 columns on desktop)

---

## 📊 Content Sections (ROW BY ROW)

### **TOP ROW: 4 Stat Cards** (each `col-span-3`)

#### **Card 1: Total Portfolio Value**
```
Label: "Total Portfolio Value" (uppercase, dim text)
Icon: account_balance
Value: $1.24M (headline size, bold)
Trend: +5.2% (24h) [green text with trending_up icon]
Styling: glass-panel, hover state with primary border
```
**API Source**: `GET /portfolio?address=0x...`
- Calculated from: `totalFxrp * FTSO price`
- Data field: `portfolio.totalFxrp` (FXRP amount) × `ftsoPrice.priceUsd`

#### **Card 2: Total FXRP Supply**
```
Label: "Total FXRP Supply" (uppercase, dim text)
Icon: toll
Value: 845,291.42 (headline size, bold)
Trend: +1.1% (7d) [green text with trending_up icon]
Styling: glass-panel, hover state
```
**API Source**: `GET /reserves`
- Data field: `reserves.fxrpTotalSupply`
- Trend: 7-day change (derived from historical snapshots)

#### **Card 3: Core Vault Ratio** ⭐ (Highlighted)
```
Label: "Core Vault Ratio" (uppercase, dim text)
Icon: security (primary color icon)
Value: 1.05x (primary color, large)
Subtitle: "Target: 1.01x - Overcollateralized"
Styling: glass-panel with widget-glow effect (green tint shadow)
```
**API Source**: `GET /reserves`
- Data field: `reserves.backingRatio`
- Display as: `(coreVaultXrpBalance / fxrpTotalSupply).toFixed(4)`
- Status color: green (healthy) if ≥1.01, yellow (warning) if 0.95-1.00, red (critical) if <0.95

#### **Card 4: FTSO XRP Price**
```
Label: "FTSO XRP Price" (uppercase, dim text)
Icon: currency_exchange
Value: $0.6124 (headline size, bold)
Trend: -0.4% (1h) [red text with trending_down icon]
Styling: glass-panel, hover state
```
**API Source**: `GET /ftso-price`
- Data field: `ftsoPrice.priceUsd`
- Trend: 1-hour price change (derived from previous snapshot)

---

### **MIDDLE ROW**

#### **LEFT: Cross-Chain Distribution Table** (7 columns)
```
Header: "Cross-Chain Distribution" (with layers icon)
Toolbar: Filter icon, Drag indicator
```

**Table Structure:**
```
Columns:
  - Chain (with color badge + name)
  - FXRP Balance
  - USD Value
  - % of Total (with progress bar)

Rows (7 chains):
  1. Ethereum: 450,210.00 FXRP | $275,708 | 53.2% [bar 53%]
  2. Arbitrum: 185,400.50 FXRP | $113,540 | 21.9% [bar 22%]
  3. Optimism: 82,100.25 FXRP | $50,280 | 9.7% [bar 10%]
  4. Polygon: 55,300.00 FXRP | $33,865 | 6.5% [bar 7%]
  5. Avalanche: 40,000.00 FXRP | $24,496 | 4.7% [bar 5%]
  6. BSC: 25,180.67 FXRP | $15,420 | 3.0% [bar 3%]
  7. Base: 7,100.00 FXRP | $4,348 | 1.0% [bar 1%]
```

**API Source**: `GET /portfolio?address=0x...` + `GET /ftso-price`
```
Data mapping:
  - portfolio.chains[i].chainName → Chain column
  - portfolio.chains[i].balance → FXRP Balance (in FXRP units)
  - portfolio.chains[i].balance * ftsoPrice.priceUsd → USD Value
  - (portfolio.chains[i].balance / portfolio.totalFxrp * 100).toFixed(1) → % of Total
  - Progress bar: width = percentage
  - Badge color: from GET /chains API (logoColor field)
```

**Styling:**
- Zebra rows (alternating transparency)
- Hover state: background highlight
- Badge: circular with chain abbreviation (ETH, ARB, OP, etc.)

---

#### **RIGHT: Bridge/Redeem Widget** (5 columns)
```
Header with Tab Buttons: "Bridge" (active, primary underline) | "Redeem" (inactive)
Toolbar: Drag indicator
```

**Current Tab: "Bridge"**

**Section 1: Chain Selectors**
```
From: [Ethereum ▼] → [arrow] → To: [Arbitrum ▼]
- Each is a clickable dropdown
- Shows chain badge + name
- Keyboard accessible
```
**API Source**: `GET /chains`
- Populate from `chains` array
- Default: first chain (Flare as adapter) → Base

**Section 2: Amount Input**
```
Label: "Amount (FXRP)"
Helper: "Bal: 450,210.00" (from loaded portfolio)
Input: "10000" (editable, numeric)
Max Button: "MAX" (sets to full balance)
```
**API Source**: `GET /portfolio?address=0x...`
- Balance comes from: `portfolio.chains[selectedChainIndex].balance`
- Max button action: populate input with balance value

**Section 3: Route Info (Read-only)**
```
Est. Receive: 10,000.00 FXRP
Network Fee: ~$4.20 (0.0015 ETH)
Est. Time: ~2 Mins [with pulsing dot]
```
**API Source**: `POST /bridge-prepare`
```
Triggers when user changes amount/chains
Request body:
  {
    srcChain: "flare",
    dstChain: "base",
    amount: "10000",
    recipient: "0x..." (from loaded EVM address)
  }
Response fields used:
  - quote.nativeFee → Network Fee display
  - amount (echoed) → Est. Receive
  - Hardcoded: ~2 Mins (could be LZ endpoint-specific)
```

**Section 4: CTA Button**
```
Text: "Prepare Calldata"
Styling: primary background, bold
Shadow: green glow effect
Action: POST /bridge-prepare → display result in modal/sheet
```

**Tab 2: "Redeem" (Hidden, not visible in screenshot)**
- Similar structure (redeem flows)
- Not detailed in current template

---

### **BOTTOM ROW**

#### **LEFT: System Backing History Chart** (6 columns)
```
Header: "System Backing History" (with monitoring icon)
Toolbar: Filter icon, Drag indicator
```

**Legend** (top-right):
```
● XRP Locked (primary green)
● FXRP Minted (secondary purple)
```

**Pseudo-Chart Visualization** (bar chart)
```
Horizontal grid lines (3 lines)
Time axis labels: Oct 1 | Nov 1 | Dec 1 | Now

Grouped bars (2 per time period):
  - Small bar behind (purple, FXRP Minted, ~40-85% height)
  - Small bar in front (green, XRP Locked, ~45-95% height)
  - Both scale to show backing ratio over time
  - Last bar has glow effect (most recent)
```

**API Source**: `GET /reserves`
```
Data mapping:
  - Historical snapshots (need time-series data)
  - fxrpTotalSupply at each point → purple bar height
  - coreVaultXrpBalance at each point → green bar height
  - Time labels: hardcoded (Oct, Nov, Dec, Now) or from snapshot timestamps
```

**Styling:**
- Grid lines: subtle borders
- Bars: rounded, semi-transparent on hover
- No actual line chart (just bars), simpler to render

---

#### **RIGHT: Relayer Network Health Table** (6 columns)
```
Header: "Relayer Network Health" (with memory icon)
Toolbar: Filter icon, Drag indicator
```

**Table Structure:**
```
Columns:
  - Node Name (monospace font)
  - Status (badge with color + pulsing dot)
  - Processed (24h) (right-aligned)

Rows (4 executors/relayers):
  1. Alpha-Relay-01 | Healthy [green badge] | 12,450
  2. Beta-Relay-02  | Healthy [green badge] | 11,892
  3. Gamma-Relay-03 | Degraded [red badge]  | 4,120
  4. Delta-Relay-04 | Healthy [green badge] | 13,005
```

**API Source**: `GET /executor-status` (proxy to executor service)
```
Response from executor:
  {
    online: true,
    executor: "0x...",
    network: "coston2",
    dryRun: true,
    journal?: {
      count: N,
      recent: [{ status, timestamp }, ...]
    }
  }

Mapping for multi-executor display:
  - Need to query multiple executor instances or aggregate endpoint
  - Node Name: derived from executor ID or hardcoded
  - Status: executor.online + executor.health
  - Processed (24h): executor.journal.count (daily counter)
```

**Status Badge Colors:**
- Green (primary): Healthy, online, processing
- Red (error): Degraded, offline, errored
- Pulsing dot: indicates active/online state

---

## 🔄 API Integration Mapping Summary

### **Endpoints Used:**
```
1. GET /status
   → network badge in header

2. GET /portfolio?address=0x...
   → Total FXRP, per-chain balances, chain grid table
   → Bridge/Redeem widget balance display

3. GET /ftso-price
   → FTSO XRP Price card
   → Portfolio value calculation ($)
   → USD Value column in table

4. GET /chains
   → Chain selector dropdowns in Bridge widget
   → Chain badges in table (logoColor)

5. POST /bridge-prepare (on amount/chain change)
   → Route Info card (Est. Receive, Network Fee, Est. Time)

6. GET /reserves
   → Core Vault Ratio card (backingRatio, status)
   → Total FXRP Supply card (fxrpTotalSupply)
   → System Backing History chart (historical backingRatio, volumes)

7. GET /executor-status
   → Relayer Network Health table (node status, processed count)
```

### **Data Flow (User Journey):**
```
1. Page loads → GET /status (network info), GET /chains (for dropdowns)
2. User enters EVM address
3. Fetch → GET /portfolio?address=0x... (parallel)
4. Fetch → GET /ftso-price (parallel)
5. Fetch → GET /reserves (parallel)
6. Fetch → GET /executor-status (parallel)
7. Render all cards + table + chart
8. User selects chain in Bridge widget
9. POST /bridge-prepare (on change)
10. Display route info (Est. Receive, Fee, Time)
11. User clicks "Prepare Calldata" → result modal
```

---

## 🎯 Current State vs Ready for Implementation

### **What's Hardcoded (Demo Data):**
- ✅ All stat card values (will be replaced by API data)
- ✅ Chain distribution table data (7 rows hardcoded)
- ✅ Bridge widget chain selections (default: Ethereum → Arbitrum)
- ✅ Bridge widget amount input (10000 hardcoded)
- ✅ Route info (Est. Receive, Fee, Time)
- ✅ Backing history chart bars (pseudo-visualization, no real chart library)
- ✅ Relayer health rows (4 nodes hardcoded)
- ✅ Trend indicators (24h, 7d, 1h) - no real calculation

### **What's Styled/Ready:**
- ✅ Layout (12-col grid, responsive mobile/tablet/desktop)
- ✅ Color scheme (Material Design 3 dark theme)
- ✅ Typography (Geist, JetBrains Mono)
- ✅ Glass-morphism effects (blur, borders, shadows)
- ✅ Interactions (hover states, tab buttons, dropdowns)
- ✅ Accessibility (semantic HTML, ARIA labels)

### **What Needs Implementation:**
- ❌ API calls (fetch with error handling, retry logic)
- ❌ Data binding (populate from API responses)
- ❌ Real-time updates (polling, WebSocket for live price/status)
- ❌ Form interactions (chain dropdowns, amount input, Max button)
- ❌ Modal/sheet for bridge calldata result
- ❌ Chart library for backing history (Chart.js, D3, or SVG)
- ❌ Status color logic (green/yellow/red based on backingRatio)
- ❌ Error states (RPC offline, invalid address, API failures)
- ❌ Loading states (skeleton loaders, spinners)
- ❌ Tab switching (Bridge ↔ Redeem)

---

## 📝 Implementation Checklist

### **Phase 1: API Integration**
- [ ] Create `portfolio.js` with API helper functions
- [ ] Implement `loadPortfolio(address)` with GET /portfolio
- [ ] Implement `loadFtsoPrice()` with GET /ftso-price
- [ ] Implement `loadReserves()` with GET /reserves
- [ ] Implement `loadExecutorStatus()` with GET /executor-status
- [ ] Add retry logic (3 retries, exponential backoff)
- [ ] Add cache (5min TTL for portfolio/price, 10min for reserves)

### **Phase 2: Data Binding**
- [ ] Bind portfolio.totalFxrp → Total Portfolio Value card
- [ ] Bind ftsoPrice.priceUsd → FTSO Price card
- [ ] Bind (portfolio.totalFxrp * ftsoPrice.priceUsd) → Total Value display
- [ ] Bind reserves.fxrpTotalSupply → Total FXRP Supply card
- [ ] Bind reserves.backingRatio → Core Vault Ratio card + status color
- [ ] Populate chain table from portfolio.chains array
- [ ] Format USD values with comma separators
- [ ] Format numbers to 6 decimal places (FXRP precision)

### **Phase 3: Interactive Elements**
- [ ] Wire chain dropdowns (GET /chains, populate on load)
- [ ] Implement Max button (set input to balance)
- [ ] Handle amount input validation (decimal, positive, ≤ balance)
- [ ] Wire Bridge button → POST /bridge-prepare
- [ ] Display route info from bridge-prepare response
- [ ] Add loading spinner during fetch
- [ ] Show error messages with retry option

### **Phase 4: Tab Switching**
- [ ] Toggle visibility between Bridge and Redeem tabs
- [ ] Reuse widget for both actions (conditional UI)
- [ ] Implement Redeem-specific form fields

### **Phase 5: Charting**
- [ ] Replace pseudo-chart with actual chart library (Chart.js recommended)
- [ ] Fetch historical backing ratio data (or simulate with mock data)
- [ ] Display XRP Locked vs FXRP Minted as stacked/grouped bars
- [ ] Add hover tooltips with exact values

### **Phase 6: Polish**
- [ ] Add trend calculations (24h, 7d, 1h price changes)
- [ ] Implement real-time updates (polling every 30s for price, 1min for portfolio)
- [ ] Add mobile menu functionality (hamburger nav toggle)
- [ ] Test responsive layout on 320px, 768px, 1440px widths
- [ ] Accessibility audit (axe, keyboard nav, screen readers)
- [ ] Dark mode toggle (if needed; already dark theme)

---

## 🚀 Next Steps for Frontend Engineer

1. **Copy portfolio.html** as-is (structure is solid)
2. **Create portfolio.js** with:
   ```javascript
   // API functions
   async function getPortfolio(address)
   async function getFtsoPrice()
   async function getReserves()
   async function getExecutorStatus()
   async function prepareBridge(srcChain, dstChain, amount, recipient)
   
   // UI update functions
   function updatePortfolioCards(data)
   function updateChainTable(data)
   function updateBridgeRoute(data)
   function updateChart(data)
   
   // Event handlers
   function onAddressInput(value)
   function onChainChange()
   function onAmountChange()
   function onMaxClick()
   function onBridgeClick()
   function onTabChange(tab)
   ```

3. **Add error handling** (try-catch, user messages)
4. **Add loading states** (disable buttons, show spinners)
5. **Test with live API** (start with /status, then /portfolio, etc.)
6. **Deploy and monitor** (check console for errors, log API calls)

---

## 📖 Reference Files

- `/FRONTEND_SPEC.md` — Complete specification
- `FRONTEND_SPEC.md:API_ENDPOINTS` — All endpoints with schemas
- `FRONTEND_SPEC.md:DESIGN_SYSTEM` — Colors, typography, spacing
- `/server/index.ts` — Backend implementation (endpoints, logic)

---

**Ready to implement!** 🚀

// Omnichain FXRP portfolio dashboard frontend.
// Live data binding plus wallet-prompted bridge execution. No private key handling.
// Wallet connection: MetaMask/EVM via window.ethereum (EIP-1193). Xaman is a stub.

const $ = (id) => document.getElementById(id);

const state = {
  chains: [],
  portfolio: null,
  priceUsd: null,
  reserves: null,
  executor: null,
  address: "",
  walletType: null, // "evm" | "manual"
  connectedChainId: null,
  useTestnet: null,
  pollTimer: null,
};

// ============ API layer (fetch with retry + simple cache) ============

const cache = new Map();
const CACHE_TTL = { portfolio: 60_000, reserves: 600_000, price: 60_000, chains: 600_000, executor: 30_000, status: 600_000 };

async function apiGet(path, { ttl = 60_000, key = path } = {}) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < ttl) return hit.data;
  const data = await fetchJson(path);
  cache.set(key, { ts: now, data });
  return data;
}

async function fetchJson(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchWithRetry(path, opts, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchJson(path, opts);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
}

const API = {
  status: () => apiGet("/status", { key: "status", ttl: CACHE_TTL.status }),
  chains: () => apiGet(withMode("/chains"), { ttl: CACHE_TTL.chains, key: `chains:${modeKey()}` }),
  portfolio: (addr) => fetchWithRetry(withMode(`/portfolio?address=${encodeURIComponent(addr)}`)),
  ftsoPrice: () => fetchWithRetry("/ftso-price"),
  reserves: () => apiGet(withMode("/reserves"), { ttl: CACHE_TTL.reserves, key: `reserves:${modeKey()}` }),
  executor: () => apiGet("/executor-status", { ttl: CACHE_TTL.executor }),
  bridgePrepare: (body) =>
    fetchJson(withMode("/bridge-prepare"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  exchanges: () => apiGet("/exchanges", { ttl: CACHE_TTL.chains, key: "exchanges" }),
  prepareRedeem: (body) =>
    fetchJson("/prepare-redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  prepareGaslessRedeem: (body) =>
    fetchJson("/prepare-gasless-redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  submitGaslessRedeem: (body) =>
    fetchJson("/submit-gasless-redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  decodeMemo: (body) =>
    fetchJson("/decode-memo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

const BRIDGE_STORAGE_KEY = "fxrp_bridge_transfers";
const BRIDGE_POLL_INTERVAL = 20_000;
function readBridgeTransfers() { try { const value = JSON.parse(localStorage.getItem(BRIDGE_STORAGE_KEY) || "[]"); return Array.isArray(value) ? value.filter((item) => item && item.sendTx) : []; } catch { return []; } }
function saveBridgeTransfers() { state.bridgeTransfers = state.bridgeTransfers.slice(-10); localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(state.bridgeTransfers)); }
function bridgeScanBase(transfer) { return (transfer?.testnet ?? state.useTestnet) ? "https://scan-testnet.layerzero-api.com/v1" : "https://scan.layerzero-api.com/v1"; }
function bridgeStatusLabel(status) { return status === "completed" ? "Delivered" : status === "failed" ? "Failed" : "Pending delivery"; }
function renderBridgeTransfers() {
  const panel = $("bridgeTransfers"); const body = $("bridgeTransfersBody"); if (!panel || !body) return;
  const transfers = state.bridgeTransfers.slice().reverse().slice(0, 3); panel.classList.toggle("hidden", transfers.length === 0); body.replaceChildren();
  for (const transfer of transfers) {
    const row = document.createElement("div"); row.className = "flex items-center justify-between gap-3 text-label-sm font-label-sm";
    const details = document.createElement("div"); details.className = "min-w-0";
    const route = document.createElement("div"); route.className = "text-on-surface"; route.textContent = transfer.amount + " FXRP ? " + transfer.srcName + " ? " + transfer.dstName;
    const hash = document.createElement("div"); hash.className = "text-on-surface-variant truncate font-mono"; hash.textContent = transfer.sendTx.slice(0, 10) + "?" + transfer.sendTx.slice(-8);
    details.append(route, hash); const status = document.createElement("span"); status.className = transfer.status === "completed" ? "text-primary shrink-0" : transfer.status === "failed" ? "text-error shrink-0" : "text-secondary shrink-0"; status.textContent = bridgeStatusLabel(transfer.status); row.append(details, status); body.append(row);
  }
}
async function pollBridgeTransfer(transfer) {
  try {
    const response = await fetch(bridgeScanBase(transfer) + "/messages/tx/" + transfer.sendTx); if (!response.ok) return;
    const message = (await response.json()).data?.[0]; if (!message) return;
    const statuses = [message.status, message.source?.status, message.destination?.status].filter(Boolean).map((value) => String(value).toUpperCase());
    if (statuses.some((value) => ["FAILED", "ERROR", "SIMULATION_REVERTED"].includes(value))) transfer.status = "failed";
    else if (message.destination?.tx?.txHash || statuses.some((value) => ["DELIVERED", "SUCCEEDED", "SUCCESS"].includes(value))) { transfer.status = "completed"; transfer.destinationTx = message.destination?.tx?.txHash || transfer.destinationTx || ""; }
    else transfer.status = "pending";
    transfer.updatedAt = Date.now();
  } catch { /* Keep last known state while the scan API is unavailable. */ }
}
async function pollBridgeTransfers() { const pending = state.bridgeTransfers.filter((transfer) => transfer.status === "pending"); if (!pending.length) { renderBridgeTransfers(); return; } await Promise.all(pending.map(pollBridgeTransfer)); saveBridgeTransfers(); renderBridgeTransfers(); }
function startBridgePolling() { state.bridgeTransfers = readBridgeTransfers(); renderBridgeTransfers(); pollBridgeTransfers(); clearInterval(state.bridgePollTimer); state.bridgePollTimer = setInterval(pollBridgeTransfers, BRIDGE_POLL_INTERVAL); }

// ============ Format layer ============

const Format = {
  usd: (v, decimals = 2) =>
    "$" + Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  usdCompact: (v) => {
    const n = Number(v);
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return Format.usd(n);
  },
  number: (v, decimals = 2) =>
    Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  percent: (v, decimals = 1) => (Number(v) * 100).toFixed(decimals) + "%",
  shortAddr: (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : ""),
  chainAbbr: (name) => (name || "").slice(0, 3).toUpperCase(),
};

// ============ Toast ============

let toastTimer = null;
function toast(msg, icon = "info") {
  $("toastMsg").textContent = msg;
  $("toastIcon").textContent = icon;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 4000);
}

function showResult(title, body) {
  $("resultTitle").textContent = title;
  $("resultBody").textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  $("resultModal").classList.remove("hidden");
}

// ============ Wallet connection ============

const EVM_HEX = /^0x[a-fA-F0-9]{40}$/;
const COSTON2_CHAIN_ID = 114;
const TESTNET_CHAIN_IDS = new Set([16, 114, 998]);
const COSTON2_CHAIN = {
  id: "coston2",
  name: "Flare Coston2",
  chainId: COSTON2_CHAIN_ID,
  rpc: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2.totlescan.com",
  nativeSymbol: "CFLR",
};
const MAINNET_CHAIN = {
  id: "flare",
  name: "Flare",
  chainId: 14,
  rpc: "https://flare-api.flare.network/ext/C/rpc",
  explorer: "https://flarescan.com",
  nativeSymbol: "FLR",
};

function modeKey() {
  return state.useTestnet == null ? "default" : state.useTestnet ? "testnet" : "mainnet";
}

function withMode(path) {
  if (state.useTestnet == null) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}testnet=${state.useTestnet ? "true" : "false"}`;
}

function hexChainIdToNumber(hex) {
  return Number.parseInt(hex, 16);
}

async function getConnectedChainId() {
  if (!window.ethereum) return null;
  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  return hexChainIdToNumber(chainIdHex);
}

async function syncModeFromWalletChain() {
  if (!window.ethereum || state.walletType !== "evm") return false;
  const chainId = await getConnectedChainId();
  state.connectedChainId = chainId;
  const nextUseTestnet = TESTNET_CHAIN_IDS.has(chainId);
  const changed = state.useTestnet !== nextUseTestnet;
  state.useTestnet = nextUseTestnet;
  updateNetworkBadge();
  return changed;
}

function updateNetworkBadge() {
  const label = state.useTestnet ? (state.connectedChainId === COSTON2_CHAIN_ID ? "Coston2 testnet" : "testnet") : "mainnet";
  $("networkBadge").textContent = state.connectedChainId ? label + " | chain " + state.connectedChainId : label;
  const switchBtn = $("switchChainBtn");
  if (switchBtn) {
    const switchingToTestnet = !state.useTestnet;
    const shouldShow = state.walletType === "evm" && (switchingToTestnet
      ? state.connectedChainId !== COSTON2_CHAIN_ID
      : state.connectedChainId !== MAINNET_CHAIN.chainId);
    switchBtn.classList.toggle("hidden", !shouldShow);
    switchBtn.querySelector("span:last-child").textContent = switchingToTestnet
      ? "Switch to Coston2"
      : "Switch to Flare Mainnet";
  }
}

async function reloadChainData() {
  const chainsData = await API.chains();
  state.useTestnet = chainsData.useTestnet;
  state.chains = chainsData.chains;
  $("bridgeSrc").innerHTML = "";
  $("bridgeDst").innerHTML = "";
  updateNetworkBadge();
  setBridgeWidget();
  setChainTable();
}

async function connectMetaMask() {
  if (!window.ethereum) {
    toast("MetaMask not installed", "error");
    return null;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) throw new Error("No accounts returned");
    const addr = accounts[0].toLowerCase();
    if (!EVM_HEX.test(addr)) throw new Error("Invalid address");
    state.address = addr;
    state.walletType = "evm";
    window.WalletStore.setEvm(addr, "metamask");
    await syncModeFromWalletChain();
    setupEvmListeners();
    updateNetworkBadge();
    toast(`Connected ${Format.shortAddr(addr)}`, "check_circle");
    return addr;
  } catch (e) {
    toast(`Connection failed: ${e.message}`, "error");
    return null;
  }
}

function setupEvmListeners() {
  if (!window.ethereum) return;
  window.ethereum.removeAllListeners?.("accountsChanged");
  window.ethereum.on?.("accountsChanged", (accounts) => {
    if (!accounts || !accounts.length) {
      disconnectWallet();
    } else {
      state.address = accounts[0].toLowerCase();
      window.WalletStore.setEvm(state.address, "metamask");
      syncModeFromWalletChain().then(async (changed) => {
        if (changed) {
          state.portfolio = null;
          await reloadChainData();
          await loadSystemData();
        }
        updateWalletUI();
        loadPortfolioData();
      });
    }
  });
  window.ethereum.removeAllListeners?.("chainChanged");
  window.ethereum.on?.("chainChanged", async () => {
    const changed = await syncModeFromWalletChain();
    if (changed) {
      state.portfolio = null;
      await reloadChainData();
      await loadSystemData();
    }
    if (state.address) loadPortfolioData();
    updateNetworkBadge();
  });
}

function persistWallet() {
  // Wallet persistence now handled by WalletStore
  // This function kept for backward compatibility
}

function loadPersistedWallet() {
  // Load from centralized WalletStore if available
  const persisted = window.WalletStore?.getEvm?.();
  if (persisted && window.ethereum) {
    // Eagerly request without popup: only reconnect if already authorized
    window.ethereum
      .request({ method: "eth_accounts" })
      .then(async (accounts) => {
        if (accounts && accounts.length) {
          const addr = accounts[0].toLowerCase();
          state.address = addr;
          state.walletType = "evm";
          window.WalletStore.setEvm(addr, "metamask");
          await syncModeFromWalletChain();
          setupEvmListeners();
          await reloadChainData();
          updateWalletUI();
          loadPortfolioData();
        }
      })
      .catch(() => {});
  }
}

function disconnectWallet() {
  state.address = "";
  state.walletType = null;
  state.connectedChainId = null;
  state.portfolio = null;
  window.WalletStore?.clearEvm?.();
  updateWalletUI();
  resetPortfolioUI();
  toast("Disconnected", "logout");
}

function updateWalletUI() {
  if (state.address) {
    $("walletPill").classList.remove("hidden");
    $("walletPill").classList.add("flex");
    $("walletAddr").textContent = Format.shortAddr(state.address);
    $("walletMenuAddr").textContent = state.address;
    $("connectWalletBtn").textContent = Format.shortAddr(state.address);
    $("totalValueTrend").textContent = "loaded";
  } else {
    $("walletPill").classList.add("hidden");
    $("walletPill").classList.remove("flex");
    $("connectWalletBtn").textContent = "Connect Wallet";
    $("totalValueTrend").textContent = "connect wallet";
  }
}

function openWalletModal() { $("walletModal").classList.remove("hidden"); }
function closeWalletModal() { $("walletModal").classList.add("hidden"); }

// ============ UI binding ============

function setStatCards() {
  const price = state.priceUsd;
  const reserves = state.reserves;
  const portfolio = state.portfolio;

  // Card 1: Total portfolio value (user's FXRP × price). Falls back to supply × price if no wallet.
  if (price != null) {
    const fxrp = portfolio ? Number(portfolio.totalFxrp) : 0;
    const usd = fxrp * price;
    $("totalValue").textContent = Format.usdCompact(usd > 0 ? usd : 0);
    $("totalValueTrend").textContent = portfolio
      ? `${Format.number(fxrp, 2)} FXRP`
      : "connect wallet";
  }

  // Card 2: Total FXRP supply (canonical, from reserves)
  if (reserves) {
    $("totalSupply").textContent = Format.number(reserves.fxrpTotalSupply, 2);
  }

  // Card 3: Core vault ratio (status color)
  if (reserves) {
    const ratio = Number(reserves.backingRatio);
    $("coreRatio").textContent = ratio.toFixed(4) + "x";
    const el = $("coreRatio");
    const sub = $("ratioSub");
    el.classList.remove("text-primary", "text-error", "text-secondary");
    if (ratio >= 1.0) {
      el.classList.add("text-primary");
      sub.textContent = `Target: 1.00x — Overcollateralized`;
    } else if (ratio >= 0.95) {
      el.classList.add("text-secondary");
      sub.textContent = `Target: 1.00x — Undercollateralized`;
    } else {
      el.classList.add("text-error");
      sub.textContent = `Critical — ${Format.number(reserves.coreVaultXrpBalance, 0)} XRP vault`;
    }
  }

  // Card 4: FTSO XRP price
  if (price != null) {
    $("ftsoPrice").textContent = Format.usd(price, 4);
    $("ftsoTrend").textContent = "FTSO";
  }
}

function setChainTable() {
  const tbody = $("chainTableBody");
  const { portfolio, priceUsd, chains } = state;
  if (!portfolio || !chains.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-on-surface-variant">${
      state.address ? "Loading balances…" : "Connect a wallet to view balances."
    }</td></tr>`;
    return;
  }
  const total = Number(portfolio.totalFxrp) || 0;
  const rows = portfolio.chains
    .map((c) => {
      const chain = chains.find((x) => x.id === c.chainId) || { logoColor: "#353534", name: c.chainName };
      const bal = Number(c.balance);
      const usd = bal * (priceUsd || 0);
      const pct = total > 0 ? bal / total : 0;
      const abbr = Format.chainAbbr(chain.name);
      const barColor = pct > 0.5 ? "bg-primary" : pct > 0.1 ? "bg-secondary-container" : "bg-outline";
      return `<tr class="zebra-row hover:bg-surface-variant/20 transition-colors border-b border-outline-variant/10">
        <td class="p-3 pl-widget-padding flex items-center gap-2">
          <div class="w-6 h-6 rounded-full border border-outline flex items-center justify-center text-[10px] font-bold" style="background:${chain.logoColor}22;color:${chain.logoColor}">${abbr}</div>
          ${c.chainName}${chain.isAdapter ? ' <span class="text-[10px] text-on-surface-variant">(adapter)</span>' : ""}
        </td>
        <td class="p-3 text-right">${Format.number(bal, 2)}</td>
        <td class="p-3 text-right text-on-surface-variant">${Format.usdCompact(usd)}</td>
        <td class="p-3 pr-widget-padding text-right">
          <div class="flex items-center justify-end gap-2">
            <span>${Format.percent(pct)}</span>
            <div class="w-16 h-1 bg-surface-variant rounded-full overflow-hidden">
              <div class="h-full ${barColor}" style="width:${Math.min(pct * 100, 100)}%"></div>
            </div>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  tbody.innerHTML = rows || `<tr><td colspan="4" class="p-6 text-center text-on-surface-variant">No balances.</td></tr>`;
}

function setBridgeWidget() {
  const src = $("bridgeSrc");
  const dst = $("bridgeDst");
  if (!state.chains.length || !src.options.length) {
    for (const c of state.chains) {
      src.add(new Option(c.name + (c.isAdapter ? " (OFT Adapter)" : ""), c.id));
      dst.add(new Option(c.name, c.id));
    }
    // Defaults: Flare → Base
    src.value = state.chains.find((c) => c.isAdapter)?.id ?? state.chains[0]?.id;
    dst.value = state.chains.find((c) => c.id === "base")?.id ?? state.chains[1]?.id;
  }
  updateBridgeBadges();
  updateBridgeBalance();
}

function updateBridgeBadges() {
  const src = state.chains.find((c) => c.id === $("bridgeSrc").value);
  const dst = state.chains.find((c) => c.id === $("bridgeDst").value);
  if (src) {
    $("srcChainBadge").textContent = Format.chainAbbr(src.name);
    $("srcChainBadge").style.background = src.logoColor + "22";
    $("srcChainBadge").style.color = src.logoColor;
  }
  if (dst) {
    $("dstChainBadge").textContent = Format.chainAbbr(dst.name);
    $("dstChainBadge").style.background = dst.logoColor + "22";
    $("dstChainBadge").style.color = dst.logoColor;
  }
}

function updateBridgeBalance() {
  const srcId = $("bridgeSrc").value;
  const chain = state.portfolio?.chains.find((c) => c.chainId === srcId);
  $("bridgeBalance").textContent = chain ? `Bal: ${Format.number(chain.balance, 2)}` : "Bal: —";
}

function setBackingChart() {
  const chart = $("backingChart");
  const labels = $("backingChartLabels");
  if (!state.reserves) return;
  const supplies = state.reserves.chainSupplies || [];
  if (!supplies.length) return;

  // FXRP minted (purple) = per-chain totalSupply; XRP locked (green) = proportional to vault backing.
  const vault = Number(state.reserves.coreVaultXrpBalance) || 0;
  const totalSupply = Number(state.reserves.fxrpTotalSupply) || 1;
  const max = Math.max(...supplies.map((c) => Number(c.totalSupply) || 0), 1);

  const bars = supplies
    .map((c, i) => {
      const supply = Number(c.totalSupply) || 0;
      const h = Math.max((supply / max) * 100, 2); // min 2% visible
      const isLast = i === supplies.length - 1;
      const glow = isLast ? "shadow-[0_0_10px_rgba(208,255,220,0.5)]" : "";
      // green bar = XRP locked backing this chain's supply (proportional)
      const lockedH = Math.max((supply / max) * 100 * (vault / totalSupply), 2);
      return `<div class="w-4 flex items-end justify-center relative group" title="${c.chainName}: ${Format.number(supply, 2)} FXRP">
        <div class="w-full bg-secondary-container absolute bottom-0 opacity-80 group-hover:opacity-100 transition-opacity" style="height:${h}%"></div>
        <div class="w-1.5 bg-primary absolute bottom-0 z-10 ${glow}" style="height:${lockedH}%"></div>
      </div>`;
    })
    .join("");

  // Keep grid lines (first child) and replace bars
  const grid = chart.querySelector(".absolute");
  chart.innerHTML = "";
  if (grid) chart.appendChild(grid);
  chart.insertAdjacentHTML("beforeend", bars);

  labels.innerHTML = supplies.map((c) => `<span>${Format.chainAbbr(c.chainName)}</span>`).join("");
}

function setRelayerTable() {
  const tbody = $("relayerBody");
  const ex = state.executor;
  if (!ex) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-on-surface-variant">Checking relayer status…</td></tr>`;
    return;
  }
  if (!ex.online) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-on-surface-variant">Relayer offline — start with <code class="font-mono">npm run executor</code></td></tr>`;
    return;
  }
  const count = ex.journal?.count ?? 0;
  const badge = (online) =>
    online
      ? `<div class="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-2 py-0.5 rounded text-label-sm border border-primary/20"><span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>Healthy</div>`
      : `<div class="inline-flex items-center gap-1.5 bg-error/10 text-error px-2 py-0.5 rounded text-label-sm border border-error/20"><span class="w-1.5 h-1.5 rounded-full bg-error"></span>Degraded</div>`;
  tbody.innerHTML = `
    <tr class="border-b border-outline-variant/10 hover:bg-surface-variant/20 transition-colors">
      <td class="p-2 font-mono text-on-surface">fxrp-executor</td>
      <td class="p-2">${badge(true)}</td>
      <td class="p-2 text-right text-on-surface-variant">${count.toLocaleString()}</td>
    </tr>`;
}

function resetPortfolioUI() {
  state.portfolio = null;
  $("totalValue").textContent = "$0.00";
  $("totalValueTrend").textContent = "connect wallet";
  setChainTable();
  updateBridgeBalance();
}

// ============ Data loading ============

async function loadPortfolioData() {
  if (!state.address) return;
  $("totalValueTrend").textContent = "loading…";
  try {
    const [portfolio, price] = await Promise.all([
      API.portfolio(state.address),
      API.ftsoPrice(),
    ]);
    state.portfolio = portfolio;
    state.priceUsd = Number(price.priceUsd);
    setStatCards();
    setChainTable();
    setBridgeWidget();
  } catch (e) {
    toast(`Portfolio load failed: ${e.message}`, "error");
    $("totalValueTrend").textContent = "error";
  }
}

async function loadSystemData() {
  try {
    const [price, reserves, executor] = await Promise.all([
      API.ftsoPrice(),
      API.reserves(),
      API.executor(),
    ]);
    state.priceUsd = Number(price.priceUsd);
    state.reserves = reserves;
    state.executor = executor;
    setStatCards();
    setBackingChart();
    setRelayerTable();
  } catch (e) {
    console.warn("System data load failed:", e.message);
  }
}

// ============ Bridge interactions ============

let routeTimer = null;
function scheduleRouteUpdate() {
  clearTimeout(routeTimer);
  $("estReceive").textContent = "…";
  $("networkFee").textContent = "…";
  routeTimer = setTimeout(updateRoute, 350);
}

async function updateRoute() {
  const amount = $("bridgeAmount").value.trim();
  const src = $("bridgeSrc").value;
  const dst = $("bridgeDst").value;
  if (!amount || !state.address || src === dst) {
    $("estReceive").textContent = "—";
    $("networkFee").textContent = "—";
    return;
  }
  try {
    const data = await API.bridgePrepare({
      srcChain: src,
      dstChain: dst,
      amount,
      recipient: state.address,
    });
    $("estReceive").textContent = `${Format.number(amount, 2)} FXRP`;
    const nativeFeeWei = BigInt(data.quote.nativeFee || 0);
    const feeEth = Number(nativeFeeWei) / 1e18;
    const srcChain = state.chains.find((c) => c.id === src);
    const sym = srcChain?.nativeSymbol || "ETH";
    $("networkFee").textContent = `${feeEth.toFixed(5)} ${sym}`;
  } catch (e) {
    $("estReceive").textContent = "—";
    $("networkFee").textContent = e.message.slice(0, 40);
  }
}

async function signBridgeTransaction(call, from) {
  return window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: call.to,
      value: "0x" + BigInt(call.value || 0).toString(16),
      data: call.data,
    }],
  });
}

async function switchToChain(chain) {
  if (!window.ethereum) throw new Error("MetaMask not installed");
  const chainIdHex = "0x" + Number(chain.chainId).toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainIdHex,
        chainName: chain.name,
        nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
        rpcUrls: [chain.rpc].filter(Boolean),
        blockExplorerUrls: [chain.explorer].filter(Boolean),
      }],
    });
  }
  state.connectedChainId = await getConnectedChainId();
  state.useTestnet = TESTNET_CHAIN_IDS.has(state.connectedChainId);
  updateNetworkBadge();
}

async function ensureWalletOnSourceChain(srcChain) {
  if (!window.ethereum) throw new Error("MetaMask not installed");
  const current = await getConnectedChainId();
  state.connectedChainId = current;
  if (current === srcChain.chainId) return;
  await switchToChain(srcChain);
}

async function prepareCalldata() {
  const amount = $("bridgeAmount").value.trim();
  const src = $("bridgeSrc").value;
  const dst = $("bridgeDst").value;
  if (!amount) { toast("Enter an amount", "error"); return; }
  if (!state.address) { toast("Connect a wallet first", "error"); return; }
  if (state.walletType !== "evm" || !window.ethereum) { toast("Connect MetaMask to sign the bridge transaction", "error"); return; }
  if (src === dst) { toast("Source and destination must differ", "error"); return; }
  $("prepareBtn").disabled = true;
  $("prepareBtn").textContent = "Preparing...";
  try {
    const data = await API.bridgePrepare({
      srcChain: src, dstChain: dst, amount, recipient: state.address,
    });
    const srcChain = state.chains.find((c) => c.id === src);
    if (!srcChain) throw new Error("Unknown source chain");
    await ensureWalletOnSourceChain(srcChain);
    $("prepareBtn").textContent = "Approve 1/2...";
    const approveHash = await signBridgeTransaction(data.calls[0], state.address);
    $("prepareBtn").textContent = "Send 2/2...";
    const sendHash = await signBridgeTransaction(data.calls[1], state.address);
    showResult(
      `Bridge submitted: ${data.srcChain.name} -> ${data.dstChain.name}`,
      {
        amount: data.amount,
        recipient: data.recipient,
        approveTx: approveHash,
        sendTx: sendHash,
        note: "Transactions were submitted from your connected wallet. Track final delivery in the source and destination explorers.",
      },
    );
    toast("Bridge transactions submitted", "check_circle");
    state.bridgeTransfers.push({ amount: data.amount, recipient: data.recipient, srcName: data.srcChain.name, dstName: data.dstChain.name, srcChain: data.srcChain.id, dstChain: data.dstChain.id, testnet: state.useTestnet, approveTx: approveHash, sendTx: sendHash, status: "pending", createdAt: Date.now() });
    saveBridgeTransfers();
    renderBridgeTransfers();
    pollBridgeTransfers();
    loadPortfolioData();
  } catch (e) {
    showResult("Bridge error", e.message);
  } finally {
    $("prepareBtn").disabled = false;
    $("prepareBtn").textContent = "Prepare & Sign";
  }
}

// ============ Redeem widget (standard + gasless) ============

const redeem = {
  mode: "standard", // "standard" | "gasless"
  destMode: "exchange", // "exchange" | "custom"
  exchanges: [],
  selectedExchange: null, // exchange object
  lastResult: null, // { kind: "standard"|"gasless", data }
};

const XRPL_RE = /^r[a-zA-Z0-9]{20,40}$/;

function setRedeemMode(mode) {
  redeem.mode = mode;
  const std = $("redeemModeStandard");
  const gas = $("redeemModeGasless");
  const desc = $("redeemModeDesc");
  const xrplWrap = $("redeemXrplWrap");
  const submitBtn = $("redeemSubmitBtn");
  if (mode === "standard") {
    std.classList.add("bg-primary", "text-on-primary");
    std.classList.remove("text-on-surface-variant");
    gas.classList.remove("bg-primary", "text-on-primary");
    gas.classList.add("text-on-surface-variant");
    desc.textContent = "Burn existing FXRP on Flare and receive XRP. Sign the calldata in your EVM wallet (MetaMask). Pays Flare gas.";
    xrplWrap.classList.add("hidden");
    submitBtn.classList.add("hidden");
  } else {
    gas.classList.add("bg-primary", "text-on-primary");
    gas.classList.remove("text-on-surface-variant");
    std.classList.remove("bg-primary", "text-on-primary");
    std.classList.add("text-on-surface-variant");
    desc.textContent = "No FLR needed. Sign a 1-drop XRPL Payment; the relayer pays Flare gas and executes the redeem. Best for smart-account holders.";
    xrplWrap.classList.remove("hidden");
    submitBtn.classList.remove("hidden");
  }
}

function setRedeemDestMode(mode) {
  redeem.destMode = mode;
  const ex = $("redeemDestExchange");
  const cu = $("redeemDestCustom");
  const grid = $("redeemExchangeGrid");
  const wrap = $("redeemCustomWrap");
  if (mode === "exchange") {
    ex.classList.add("border-primary/50", "bg-primary/5", "text-primary-fixed-dim");
    ex.classList.remove("border-outline-variant", "text-on-surface-variant");
    cu.classList.remove("border-primary/50", "bg-primary/5", "text-primary-fixed-dim");
    cu.classList.add("border-outline-variant", "text-on-surface-variant");
    grid.classList.remove("hidden");
    wrap.classList.add("hidden");
  } else {
    cu.classList.add("border-primary/50", "bg-primary/5", "text-primary-fixed-dim");
    cu.classList.remove("border-outline-variant", "text-on-surface-variant");
    ex.classList.remove("border-primary/50", "bg-primary/5", "text-primary-fixed-dim");
    ex.classList.add("border-outline-variant", "text-on-surface-variant");
    grid.classList.add("hidden");
    wrap.classList.remove("hidden");
    redeem.selectedExchange = null;
    updateTagVisibility(null);
  }
}

function renderExchangeGrid() {
  const grid = $("redeemExchangeGrid");
  if (!grid || !redeem.exchanges.length) return;
  grid.innerHTML = redeem.exchanges.map((ex) => {
    const selected = redeem.selectedExchange && redeem.selectedExchange.id === ex.id;
    const cls = selected
      ? "border-primary bg-primary/10"
      : "border-outline-variant hover:border-primary/50";
    return `<button data-exchange-id="${ex.id}" class="ex-card ${cls} flex items-center gap-2 p-2 rounded border bg-surface-container-low transition-colors text-left">
      <span class="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style="background:${ex.color}33;color:${ex.color}">${ex.initials}</span>
      <div class="min-w-0">
        <p class="text-label-sm font-label-sm font-bold text-on-surface truncate">${ex.name}</p>
        <p class="text-[10px] font-mono text-on-surface-variant truncate">${ex.depositAddress.slice(0, 10)}…</p>
      </div>
    </button>`;
  }).join("");
  grid.querySelectorAll(".ex-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.exchangeId;
      redeem.selectedExchange = redeem.exchanges.find((e) => e.id === id);
      renderExchangeGrid();
      updateTagVisibility(redeem.selectedExchange);
    });
  });
}

function updateTagVisibility(exchange) {
  const wrap = $("redeemTagWrap");
  if (redeem.destMode === "exchange" && exchange && exchange.requiresTag) {
    wrap.classList.remove("hidden");
  } else if (redeem.destMode === "custom") {
    // custom: show tag field so user can optionally provide one
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
}

async function loadExchanges() {
  try {
    const data = await API.exchanges();
    redeem.exchanges = data.exchanges || [];
    renderExchangeGrid();
  } catch (e) {
    console.warn("exchanges load failed:", e.message);
  }
}

function buildRedeemRequest() {
  const amount = ($("redeemAmount").value || "").trim();
  if (!amount || Number(amount) <= 0) throw new Error("Enter a FXRP amount to redeem");
  const base = { amountXrp: String(amount) };
  const tagRaw = ($("redeemTag").value || "").trim();

  if (redeem.destMode === "exchange") {
    if (!redeem.selectedExchange) throw new Error("Select an exchange");
    base.exchangeId = redeem.selectedExchange.id;
    if (redeem.selectedExchange.requiresTag) {
      if (!tagRaw) throw new Error(`${redeem.selectedExchange.name} requires a destination tag`);
      base.destinationTag = Number(tagRaw);
    }
  } else {
    const addr = ($("redeemCustomAddr").value || "").trim();
    if (!XRPL_RE.test(addr)) throw new Error("Enter a valid XRPL r-address");
    base.redeemerXrplAddress = addr;
    if (tagRaw) base.destinationTag = Number(tagRaw);
  }

  if (redeem.mode === "standard") {
    if (state.address && /^0x[a-fA-F0-9]{40}$/.test(state.address)) {
      base.callerAddress = state.address;
    }
    return { kind: "standard", body: base };
  } else {
    const xrpl = ($("redeemXrplAddr").value || "").trim();
    if (!XRPL_RE.test(xrpl)) throw new Error("Enter your XRPL address for gasless redeem");
    const dest = redeem.destMode === "exchange"
      ? redeem.selectedExchange.depositAddress
      : ($("redeemCustomAddr").value || "").trim();
    const gaslessBody = {
      xrplAddress: xrpl,
      amountXrp: String(amount),
      destinationAddress: dest,
    };
    if (redeem.destMode === "exchange" && redeem.selectedExchange.requiresTag && tagRaw) {
      gaslessBody.destinationTag = Number(tagRaw);
    } else if (redeem.destMode === "custom" && tagRaw) {
      gaslessBody.destinationTag = Number(tagRaw);
    }
    return { kind: "gasless", body: gaslessBody };
  }
}

async function prepareRedeem() {
  let req;
  try {
    req = buildRedeemRequest();
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  $("redeemResult").classList.add("hidden");
  $("redeemWarnings").classList.add("hidden");
  $("redeemPrepareBtn").textContent = "Preparing…";
  $("redeemPrepareBtn").disabled = true;
  try {
    let data;
    if (req.kind === "standard") {
      data = await API.prepareRedeem(req.body);
      redeem.lastResult = { kind: "standard", data };
      renderRedeemStandard(data);
    } else {
      data = await API.prepareGaslessRedeem(req.body);
      redeem.lastResult = { kind: "gasless", data };
      renderRedeemGasless(data);
    }
    if (data.warnings && data.warnings.length) {
      $("redeemWarnings").textContent = data.warnings.join("; ");
      $("redeemWarnings").classList.remove("hidden");
    }
    $("redeemResult").classList.remove("hidden");
    toast("Redeem prepared", "check_circle");
  } catch (e) {
    toast(`Redeem failed: ${e.message}`, "error");
  } finally {
    $("redeemPrepareBtn").textContent = "Prepare Redeem";
    $("redeemPrepareBtn").disabled = false;
  }
}

function renderRedeemStandard(data) {
  $("redeemFn").textContent = data.function;
  $("redeemTarget").textContent = data.to;
  $("redeemCalldata").textContent = data.data;
  $("redeemPaymentWrap").classList.add("hidden");
  $("redeemNote").textContent = data.note || "";
  $("redeemSubmitBtn").classList.add("hidden");
}

function renderRedeemGasless(data) {
  $("redeemFn").textContent = "Gasless redeem (1-drop XRPL Payment)";
  $("redeemTarget").textContent = data.payment.Destination;
  $("redeemCalldata").textContent = data.memoHex || "—";
  $("redeemPaymentWrap").classList.remove("hidden");
  $("redeemPaymentJson").textContent = JSON.stringify(data.payment, null, 2);
  $("redeemNote").textContent = data.note || "";
  $("redeemSubmitBtn").classList.remove("hidden");
}

async function submitGaslessRedeem() {
  if (!redeem.lastResult || redeem.lastResult.kind !== "gasless") {
    toast("Prepare a gasless redeem first", "error");
    return;
  }
  $("redeemSubmitBtn").textContent = "Submitting…";
  $("redeemSubmitBtn").disabled = true;
  try {
    const data = await API.submitGaslessRedeem(redeem.lastResult.data);
    toast("Submitted to relayer", "check_circle");
    showResult("Gasless Redeem Submitted", JSON.stringify(data, null, 2));
  } catch (e) {
    toast(`Submit failed: ${e.message}`, "error");
  } finally {
    $("redeemSubmitBtn").textContent = "Submit to Relayer";
    $("redeemSubmitBtn").disabled = false;
  }
}

function copyRedeemCalldata() {
  if (!redeem.lastResult) return;
  let text;
  if (redeem.lastResult.kind === "standard") {
    text = redeem.lastResult.data.data;
  } else {
    text = JSON.stringify(redeem.lastResult.data.payment, null, 2);
  }
  navigator.clipboard?.writeText(text);
  toast("Copied", "content_copy");
}

// ============ Decode Memo widget ============

async function decodeMemo() {
  const hex = ($("decodeMemoInput").value || "").trim();
  if (!hex) { toast("Paste a memo hex first", "error"); return; }
  $("decodeMemoResult").classList.add("hidden");
  $("decodeMemoError").classList.add("hidden");
  try {
    const data = await API.decodeMemo({ memoHex: hex });
    $("dmOpcode").textContent = data.opcode;
    $("dmWalletId").textContent = data.walletId;
    $("dmExecFee").textContent = data.executorFeeUba;
    $("dmLength").textContent = data.userOpEncodedLengthBytes + " bytes";
    $("dmUserOp").textContent = data.userOpEncoded;
    $("decodeMemoResult").classList.remove("hidden");
  } catch (e) {
    $("decodeMemoError").textContent = e.message;
    $("decodeMemoError").classList.remove("hidden");
  }
}

// ============ Init + events ============

async function init() {
  // Wire static events
  $("connectWalletBtn").addEventListener("click", openWalletModal);
  $("closeWalletModal").addEventListener("click", closeWalletModal);
  $("walletMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("walletMenu").classList.toggle("hidden");
  });
  document.addEventListener("click", () => $("walletMenu").classList.add("hidden"));
  $("copyAddrBtn").addEventListener("click", () => {
    navigator.clipboard?.writeText(state.address);
    toast("Address copied", "content_copy");
  });
  $("disconnectBtn").addEventListener("click", disconnectWallet);
  $("switchChainBtn").addEventListener("click", async () => {
    const button = $("switchChainBtn");
    const targetChain = state.useTestnet ? MAINNET_CHAIN : COSTON2_CHAIN;
    button.disabled = true;
    try {
      await switchToChain(targetChain);
      toast(`Switched to ${targetChain.name}. Reloading portfolio...`, "check_circle");
      window.location.reload();
    } catch (e) {
      toast(`Chain switch failed: ${e.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
  $("closeResultModal").addEventListener("click", () => $("resultModal").classList.add("hidden"));
  $("copyResultBtn").addEventListener("click", () => {
    navigator.clipboard?.writeText($("resultBody").textContent);
    toast("Copied", "content_copy");
  });

  // Wallet modal selections
  document.querySelectorAll("[data-wallet]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.dataset.wallet;
      if (type === "metamask") {
        const addr = await connectMetaMask();
        if (addr) {
          closeWalletModal();
          updateWalletUI();
          await loadPortfolioData();
        }
      } else if (type === "xaman") {
        toast("Xaman requires API keys (see WALLET_CONNECTION_GUIDE.md)", "info");
      }
    });
  });
  $("manualLoadBtn").addEventListener("click", () => {
    const addr = $("manualAddress").value.trim().toLowerCase();
    if (!EVM_HEX.test(addr)) { toast("Enter a valid 0x address", "error"); return; }
    state.address = addr;
    state.walletType = "manual";
    closeWalletModal();
    updateWalletUI();
    loadPortfolioData();
  });
  $("manualAddress").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("manualLoadBtn").click();
  });

  // Bridge widget events
  $("bridgeSrc").addEventListener("change", () => { updateBridgeBadges(); updateBridgeBalance(); scheduleRouteUpdate(); });
  $("bridgeDst").addEventListener("change", scheduleRouteUpdate);
  $("bridgeAmount").addEventListener("input", scheduleRouteUpdate);
  $("maxBtn").addEventListener("click", () => {
    const srcId = $("bridgeSrc").value;
    const chain = state.portfolio?.chains.find((c) => c.chainId === srcId);
    if (chain) $("bridgeAmount").value = chain.balance;
    scheduleRouteUpdate();
  });
  $("prepareBtn").addEventListener("click", prepareCalldata);
  $("refreshTransfersBtn").addEventListener("click", pollBridgeTransfers);

  // Tab toggle (Bridge active; Redeem links to gateway dashboard for now)
  $("tabRedeem").addEventListener("click", () => {
    toast("Redeem FXRP → see the Mint Gateway dashboard", "info");
  });

  // Redeem widget events
  $("redeemModeStandard").addEventListener("click", () => setRedeemMode("standard"));
  $("redeemModeGasless").addEventListener("click", () => setRedeemMode("gasless"));
  $("redeemDestExchange").addEventListener("click", () => setRedeemDestMode("exchange"));
  $("redeemDestCustom").addEventListener("click", () => setRedeemDestMode("custom"));
  $("redeemPrepareBtn").addEventListener("click", prepareRedeem);
  $("redeemCopyBtn").addEventListener("click", copyRedeemCalldata);
  $("redeemSubmitBtn").addEventListener("click", submitGaslessRedeem);

  // Decode memo widget events
  $("decodeMemoBtn").addEventListener("click", decodeMemo);
  $("dmCopyBtn").addEventListener("click", () => {
    navigator.clipboard?.writeText($("dmUserOp").textContent);
    toast("UserOp copied", "content_copy");
  });

  // Load exchanges for redeem widget
  loadExchanges();

  // Load chains + status first
  try {
    const [chainsData, status] = await Promise.all([API.chains(), API.status()]);
    state.useTestnet = chainsData.useTestnet;
    state.chains = chainsData.chains;
    updateNetworkBadge();
    setBridgeWidget();
    setChainTable();
  } catch (e) {
    toast(`Failed to load chains: ${e.message}`, "error");
  }

  // System-wide data (price, reserves, executor) loads independently of wallet
  await loadSystemData();

  // Reconnect EVM wallet if previously authorized (no popup)
  loadPersistedWallet();

  // Restore and monitor bridge deliveries across page reloads
  startBridgePolling();

  // Periodic refresh of system data (price/reserves/executor)
  state.pollTimer = setInterval(loadSystemData, 60_000);
}

document.addEventListener("DOMContentLoaded", init);

// Omnichain FXRP portfolio dashboard frontend.
// Read-only data binding + bridge calldata preparation. No key handling.
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
  chains: () => apiGet("/chains", { ttl: CACHE_TTL.chains }),
  portfolio: (addr) => fetchWithRetry(`/portfolio?address=${encodeURIComponent(addr)}`),
  ftsoPrice: () => fetchWithRetry("/ftso-price"),
  reserves: () => apiGet("/reserves", { ttl: CACHE_TTL.reserves }),
  executor: () => apiGet("/executor-status", { ttl: CACHE_TTL.executor }),
  bridgePrepare: (body) =>
    fetchJson("/bridge-prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

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
    persistWallet();
    setupEvmListeners();
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
      persistWallet();
      updateWalletUI();
      loadPortfolioData();
    }
  });
}

function persistWallet() {
  if (state.walletType === "evm") {
    try { localStorage.setItem("fxrp_wallet", JSON.stringify({ type: "evm" })); } catch {}
  }
}

function loadPersistedWallet() {
  try {
    const w = JSON.parse(localStorage.getItem("fxrp_wallet") || "{}");
    if (w.type === "evm" && window.ethereum) {
      // Eagerly request without popup: only reconnect if already authorized
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts) => {
          if (accounts && accounts.length) {
            state.address = accounts[0].toLowerCase();
            state.walletType = "evm";
            setupEvmListeners();
            updateWalletUI();
            loadPortfolioData();
          }
        })
        .catch(() => {});
    }
  } catch {}
}

function disconnectWallet() {
  state.address = "";
  state.walletType = null;
  state.portfolio = null;
  try { localStorage.removeItem("fxrp_wallet"); } catch {}
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

async function prepareCalldata() {
  const amount = $("bridgeAmount").value.trim();
  const src = $("bridgeSrc").value;
  const dst = $("bridgeDst").value;
  if (!amount) { toast("Enter an amount", "error"); return; }
  if (!state.address) { toast("Connect a wallet first", "error"); return; }
  if (src === dst) { toast("Source and destination must differ", "error"); return; }
  $("prepareBtn").disabled = true;
  $("prepareBtn").textContent = "Preparing…";
  try {
    const data = await API.bridgePrepare({
      srcChain: src, dstChain: dst, amount, recipient: state.address,
    });
    const calls = data.calls
      .map((c, i) => {
        const label = i === 0 ? "1. Approve OFT" : "2. Send via LayerZero";
        return `${label}\n  to:   ${c.to}\n  value: ${c.value} wei${i === 1 ? " (native LZ fee)" : ""}\n  data:  ${c.data}`;
      })
      .join("\n\n");
    showResult(
      `Bridge: ${data.srcChain.name} → ${data.dstChain.name}`,
      `Amount: ${data.amount} FXRP\nRecipient: ${data.recipient}\n\n${calls}\n\nNote: ${data.note}`,
    );
  } catch (e) {
    showResult("Bridge error", e.message);
  } finally {
    $("prepareBtn").disabled = false;
    $("prepareBtn").textContent = "Prepare Calldata";
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

  // Tab toggle (Bridge active; Redeem links to gateway dashboard for now)
  $("tabRedeem").addEventListener("click", () => {
    toast("Redeem FXRP → see the Mint Gateway dashboard", "info");
  });

  // Load chains + status first
  try {
    const [chainsData, status] = await Promise.all([API.chains(), API.status()]);
    state.chains = chainsData.chains;
    $("networkBadge").textContent = chainsData.useTestnet ? "testnet" : status.network || "mainnet";
    setBridgeWidget();
    setChainTable();
  } catch (e) {
    toast(`Failed to load chains: ${e.message}`, "error");
  }

  // System-wide data (price, reserves, executor) loads independently of wallet
  await loadSystemData();

  // Reconnect EVM wallet if previously authorized (no popup)
  loadPersistedWallet();

  // Periodic refresh of system data (price/reserves/executor)
  state.pollTimer = setInterval(loadSystemData, 60_000);
}

document.addEventListener("DOMContentLoaded", init);

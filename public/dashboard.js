// Cross-chain FXRP dashboard frontend.
// Read-only: fetches balances and prepares bridge/redeem transactions. No signing.

const $ = (id) => document.getElementById(id);
let chains = [];
let exchanges = [];
let currentAddress = "";

// --- localStorage helpers for saved exchange destination tags ---

function getSavedTags() {
  try { return JSON.parse(localStorage.getItem("fxrp_exchange_tags") || "{}"); }
  catch { return {}; }
}

function saveTag(exchangeId, tag) {
  const tags = getSavedTags();
  tags[exchangeId] = tag;
  localStorage.setItem("fxrp_exchange_tags", JSON.stringify(tags));
}

function getSavedTag(exchangeId) {
  const tags = getSavedTags();
  return tags[exchangeId] || "";
}

// --- Init ---

async function init() {
  const res = await fetch("/chains");
  const data = await res.json();
  chains = data.chains;

  $("modeBadge").textContent = data.useTestnet ? "testnet" : "mainnet";

  // Populate bridge chain dropdowns
  const src = $("bridgeSrc");
  const dst = $("bridgeDst");
  for (const c of chains) {
    src.add(new Option(`${c.name}${c.isAdapter ? " (OFT Adapter)" : ""}`, c.id));
    dst.add(new Option(c.name, c.id));
  }
  // Default: Flare → Base
  src.value = chains[0]?.id ?? "flare";
  dst.value = "base";

  // Load exchange registry
  try {
    const exRes = await fetch("/exchanges");
    const exData = await exRes.json();
    exchanges = exData.exchanges || [];
    populateExchangeDropdown();
  } catch {
    console.warn("Failed to load exchange registry");
  }

  // Fetch XRP/USD price from FTSO on page load (independent of portfolio)
  fetchFtsoPrice();

  // Wire events
  $("loadBtn").addEventListener("click", loadPortfolio);
  $("evmAddress").addEventListener("keydown", (e) => { if (e.key === "Enter") loadPortfolio(); });
  $("bridgeBtn").addEventListener("click", () => togglePanel("bridgeCard"));
  $("redeemBtn").addEventListener("click", () => togglePanel("redeemCard"));
  $("reservesBtn").addEventListener("click", () => { togglePanel("reservesCard"); loadReserves(); });
  $("bridgePrepareBtn").addEventListener("click", prepareBridge);
  $("redeemPrepareBtn").addEventListener("click", prepareRedeem);
  $("reservesRefreshBtn").addEventListener("click", loadReserves);
  $("redeemExchange").addEventListener("change", onExchangeChange);
  document.querySelectorAll('input[name="redeemMode"]').forEach((r) => {
    r.addEventListener("change", onRedeemModeChange);
  });
  document.querySelectorAll(".close-btn").forEach((b) => {
    b.addEventListener("click", () => $(b.dataset.target).hidden = true);
  });

  // Auto-fill recipient with the loaded address
  $("bridgeRecipient").placeholder = "0x… (defaults to your address)";
}

function populateExchangeDropdown() {
  const sel = $("redeemExchange");
  // Keep the "personal r-address" option, add exchanges
  sel.innerHTML = '<option value="">— Personal r-address —</option>';
  for (const ex of exchanges) {
    sel.add(new Option(`${ex.name} (min ${ex.minDepositXrp} XRP)`, ex.id));
  }
}

function onExchangeChange() {
  const exId = $("redeemExchange").value;
  const warning = $("exchangeWarning");
  if (!exId) {
    // Personal address mode
    $("redeemToRaddr").value = "";
    $("redeemToRaddr").readOnly = false;
    $("redeemDestTag").value = "";
    $("tagReqLabel").textContent = "optional";
    $("tagReqLabel").className = "opt-tag";
    warning.hidden = true;
    return;
  }

  const ex = exchanges.find((e) => e.id === exId);
  if (!ex) return;

  // Auto-fill the exchange deposit address
  $("redeemToRaddr").value = ex.depositAddress;
  $("redeemToRaddr").readOnly = true;

  // Restore saved tag
  const savedTag = getSavedTag(exId);
  $("redeemDestTag").value = savedTag;

  // Tag is required for exchanges
  $("tagReqLabel").textContent = "required";
  $("tagReqLabel").className = "req-tag";

  // Show min deposit warning
  warning.hidden = false;
  warning.innerHTML = `
    <strong>${ex.name}</strong> deposit address auto-filled.
    Enter your destination tag (find it on your exchange deposit page).
    Minimum deposit: <strong>${ex.minDepositXrp} XRP</strong>.
    <a href="${ex.depositUrl}" target="_blank" rel="noopener">Verify on exchange ↗</a>
  `;
}

function onRedeemModeChange() {
  const mode = document.querySelector('input[name="redeemMode"]:checked').value;
  const isStandalone = mode === "standalone";
  document.querySelectorAll(".standalone-only").forEach((el) => el.hidden = !isStandalone);
  document.querySelectorAll(".mint-only").forEach((el) => el.hidden = isStandalone);
}

function togglePanel(id) {
  $(id).hidden = !$(id).hidden;
}

// --- Portfolio ---

async function loadPortfolio() {
  const addr = $("evmAddress").value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    $("searchHint").textContent = "Enter a valid 0x address.";
    return;
  }
  currentAddress = addr;
  $("searchHint").textContent = "Querying all chains in parallel…";
  $("loadBtn").disabled = true;

  try {
    const res = await fetch(`/portfolio?address=${encodeURIComponent(addr)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderPortfolio(data);
    fetchFtsoPrice(data.totalFxrp);
    $("searchHint").textContent = `Loaded. ${data.chainsWithBalance} chain(s) with balance.`;
  } catch (e) {
    $("searchHint").textContent = `Error: ${e.message}`;
  } finally {
    $("loadBtn").disabled = false;
  }
}

async function fetchFtsoPrice(totalFxrp) {
  try {
    const res = await fetch("/ftso-price");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    $("xrpPrice").textContent = `$${Number(data.priceUsd).toFixed(4)}`;
    if (totalFxrp && Number(totalFxrp) > 0) {
      const usdValue = Number(totalFxrp) * Number(data.priceUsd);
      $("xrpValue").textContent = `≈ $${usdValue.toFixed(2)}`;
    } else {
      $("xrpValue").textContent = `FTSO · block ${data.timestamp}`;
    }
  } catch {
    $("xrpPrice").textContent = "—";
    $("xrpValue").textContent = "FTSO unavailable";
  }
}

function renderPortfolio(portfolio) {
  $("summaryCard").hidden = false;
  $("totalFxrp").textContent = formatNum(portfolio.totalFxrp);
  $("totalSub").textContent = `across ${portfolio.chainCount} chains`;
  $("chainsWithBalance").textContent = portfolio.chainsWithBalance;

  // Auto-fill bridge recipient
  $("bridgeRecipient").value = portfolio.address;
  const grid = $("chainGrid");
  grid.innerHTML = "";

  for (const c of portfolio.chains) {
    const card = document.createElement("div");
    card.className = "chain-card";
    if (!c.error && BigInt(c.balanceUba) > 0n) card.classList.add("has-balance");
    if (c.error) card.classList.add("unavailable");

    const initials = c.chainName.slice(0, 2).toUpperCase();
    const chainConfig = chains.find((ch) => ch.id === c.chainId);
    const color = chainConfig?.logoColor ?? "#888";

    card.innerHTML = `
      <div class="chain-header">
        <div class="chain-badge" style="background:${color}">${initials}</div>
        <div>
          <div class="chain-name">${c.chainName}</div>
          <div class="chain-type">${c.isAdapter ? "OFT Adapter" : "OFT Native"}</div>
        </div>
      </div>
      <div class="chain-balance">${formatNum(c.balance)} <span class="unit">FXRP</span></div>
      <div class="chain-supply">${c.error ? "" : `Supply: ${formatNum(c.totalSupply)} FXRP`}</div>
      ${c.error ? `<div class="chain-error">${c.error}</div>` : ""}
      <div class="chain-actions">
        <button data-chain="${c.chainId}" data-action="bridge" ${c.error || BigInt(c.balanceUba) === 0n ? "disabled" : ""}>Bridge from</button>
        <a href="${c.explorer}/address/${c.tokenAddress}" target="_blank" rel="noopener" style="font-size:0.75rem;color:var(--text-dim);text-decoration:none;align-self:center;">Explorer ↗</a>
      </div>
    `;
    grid.appendChild(card);
  }

  // Wire bridge-from buttons
  grid.querySelectorAll("button[data-action='bridge']").forEach((b) => {
    b.addEventListener("click", () => {
      $("bridgeSrc").value = b.dataset.chain;
      togglePanel("bridgeCard");
      $("bridgeCard").scrollIntoView({ behavior: "smooth" });
    });
  });
}

// --- Bridge ---

async function prepareBridge() {
  const body = {
    srcChain: $("bridgeSrc").value,
    dstChain: $("bridgeDst").value,
    amount: $("bridgeAmount").value.trim(),
    recipient: $("bridgeRecipient").value.trim() || currentAddress,
  };

  if (!body.amount || !body.recipient) {
    showResult("bridgeResult", "Error", "Fill in all fields.");
    return;
  }

  $("bridgePrepareBtn").disabled = true;
  $("bridgeFee").textContent = "Quoting LayerZero fee…";

  try {
    const res = await fetch("/bridge-prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const nativeFeeEther = formatEther(data.quote.nativeFee);
    $("bridgeFee").textContent = `LZ fee: ${nativeFeeEther} ${getChainSymbol(data.srcChain.id)} (native)`;

    const callsFormatted = data.calls.map((c, i) => {
      const label = i === 0 ? "1. Approve OFT" : "2. Send via LayerZero";
      return `<div class="result-label">${label}</div>
        <div><strong>To:</strong> ${c.to}</div>
        <div><strong>Value:</strong> ${c.value} wei${i === 1 ? " (native LZ fee)" : ""}</div>
        <pre>${c.data}</pre>`;
    }).join("");

    showResult("bridgeResult", `Bridge: ${data.srcChain.name} → ${data.dstChain.name}`, `
      <div><strong>Amount:</strong> ${data.amount} FXRP</div>
      <div><strong>Recipient:</strong> ${data.recipient || currentAddress}</div>
      ${callsFormatted}
      <div class="result-label" style="margin-top:0.75rem">Note</div>
      <div>${data.note}</div>
    `);
  } catch (e) {
    showResult("bridgeResult", "Error", e.message);
  } finally {
    $("bridgePrepareBtn").disabled = false;
  }
}

// --- Redeem (standalone or mint+redeem) ---

async function prepareRedeem() {
  const mode = document.querySelector('input[name="redeemMode"]:checked').value;
  const amount = $("redeemAmount").value.trim();
  const toRaddr = $("redeemToRaddr").value.trim();
  const destTag = $("redeemDestTag").value.trim();
  const exId = $("redeemExchange").value;

  if (!amount || !toRaddr) {
    showResult("redeemResult", "Error", "Fill in all required fields.");
    return;
  }

  // Save tag if exchange selected
  if (exId && destTag) {
    saveTag(exId, destTag);
  }

  $("redeemPrepareBtn").disabled = true;
  $("redeemFee").textContent = "Preparing…";

  try {
    if (mode === "standalone") {
      // Standalone redeem — existing FXRP, EVM wallet signs
      const caller = $("redeemCaller").value.trim() || currentAddress;
      const body = {
        amountXrp: amount,
        redeemerXrplAddress: toRaddr,
        exchangeId: exId || undefined,
        destinationTag: destTag ? parseInt(destTag, 10) : undefined,
        callerAddress: caller || undefined,
      };

      const res = await fetch("/prepare-redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const exchInfo = data.exchange
        ? `<div><strong>Exchange:</strong> ${data.exchange.name} (<a href="${data.exchange.depositUrl}" target="_blank" rel="noopener">verify ↗</a>)</div>`
        : "";

      const warningsHtml = data.warnings?.length
        ? `<div class="exchange-warning">⚠ ${data.warnings.join("; ")}</div>`
        : "";

      showResult("redeemResult", `Redeem calldata — ${data.function}`, `
        <div><strong>AssetManager:</strong> ${data.to}</div>
        <div><strong>Amount:</strong> ${data.amountXrp} FXRP (${data.amountUba} UBA)</div>
        <div><strong>Destination:</strong> ${data.redeemerXrplAddress}</div>
        ${data.destinationTag !== null && data.destinationTag !== undefined ? `<div><strong>Destination tag:</strong> ${data.destinationTag}</div>` : ""}
        ${exchInfo}
        ${warningsHtml}
        <div class="result-label" style="margin-top:0.5rem">Calldata (sign on Flare)</div>
        <pre>${data.data}</pre>
        <div class="result-label">Note</div>
        <div>${data.note}</div>
      `);
      $("redeemFee").textContent = "";
    } else {
      // Mint + redeem (atomic, XRPL wallet signs)
      const xrplAddr = $("redeemXrpl").value.trim();
      if (!xrplAddr) {
        showResult("redeemResult", "Error", "XRPL source address is required for mint+redeem.");
        return;
      }
      const action = destTag
        ? { type: "redeem_with_tag", redeemerXrplAddress: toRaddr, destinationTag: parseInt(destTag, 10), fxrpAmountXrp: amount }
        : { type: "redeem", redeemerXrplAddress: toRaddr, fxrpAmountXrp: amount };

      const res = await fetch("/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xrplAddress: xrplAddr, amountXrp: amount, action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      showResult("redeemResult", "Unsigned XRPL Payment (mint + redeem)", `
        <div><strong>Kind:</strong> ${data.kind}</div>
        <div><strong>Action:</strong> ${data.action}</div>
        <div><strong>Personal account:</strong> ${data.personalAccount}</div>
        <div><strong>Destination (Core Vault):</strong> ${data.payment.Destination}</div>
        <div><strong>Amount:</strong> ${data.payment.Amount} drops</div>
        <div class="result-label" style="margin-top:0.5rem">Memo (hex)</div>
        <pre>${data.memoHex}</pre>
        <div class="result-label">Note</div>
        <div>${data.note}</div>
      `);
      $("redeemFee").textContent = "";
    }
  } catch (e) {
    showResult("redeemResult", "Error", e.message);
    $("redeemFee").textContent = "";
  } finally {
    $("redeemPrepareBtn").disabled = false;
  }
}

// --- Proof of reserves ---

async function loadReserves() {
  $("reservesRefreshBtn").disabled = true;
  $("reservesTimestamp").textContent = "Querying Flare + XRPL…";

  try {
    const res = await fetch("/reserves");
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    $("reservesCard").hidden = false;

    $("reservesFxrpSupply").textContent = `${formatNum(data.fxrpTotalSupply)} FXRP`;
    $("reservesVaultBalance").textContent = `${formatNum(data.coreVaultXrpBalance)} XRP`;
    $("reservesVaultAddr").textContent = `Core Vault: ${data.coreVaultAddress.slice(0, 12)}…`;

    const ratio = parseFloat(data.backingRatio);
    const ratioPct = (ratio * 100).toFixed(2);
    $("reservesRatio").textContent = `${ratioPct}%`;

    const statusEl = $("reservesStatus");
    const statusColors = {
      healthy: { text: "✅ Healthy", color: "#4ade80" },
      warning: { text: "⚠ Warning", color: "#fbbf24" },
      critical: { text: "🔴 Critical", color: "#f87171" },
      unknown: { text: "? Unknown", color: "#94a3b8" },
    };
    const sc = statusColors[data.status] || statusColors.unknown;
    statusEl.textContent = sc.text;
    statusEl.style.color = sc.color;
    $("reservesRatio").style.color = sc.color;

    $("reservesBridged").textContent = `${formatNum(data.bridgedTotal)} FXRP`;
    $("reservesTimestamp").textContent = `Updated ${new Date(data.timestamp).toLocaleTimeString()}`;

    // Render per-chain distribution
    const distEl = $("reservesDistribution");
    distEl.innerHTML = '<div class="result-label" style="margin-bottom:0.5rem">Omnichain supply distribution</div>';
    for (const c of data.chainSupplies) {
      const pct = parseFloat(data.fxrpTotalSupply) > 0
        ? (parseFloat(c.totalSupply) / parseFloat(data.fxrpTotalSupply) * 100).toFixed(2)
        : "0";
      const badge = c.isCanonical
        ? '<span class="src-tag" style="margin-left:0.5rem">canonical</span>'
        : "";
      const errTag = c.error ? `<span style="color:#f87171;font-size:0.75rem"> (${c.error})</span>` : "";
      distEl.innerHTML += `
        <div class="reserve-chain-row">
          <span class="chain-name-sm">${c.chainName}${badge}${errTag}</span>
          <span class="chain-supply-sm">${formatNum(c.totalSupply)} FXRP</span>
          <span class="chain-pct-sm">${pct}%</span>
        </div>
      `;
    }

    // Show circulating on Flare
    distEl.innerHTML += `
      <div class="reserve-chain-row" style="margin-top:0.5rem;border-top:1px solid var(--border);padding-top:0.5rem">
        <span class="chain-name-sm">Flare circulating (not locked in OFT)</span>
        <span class="chain-supply-sm">${formatNum(data.flareCirculating)} FXRP</span>
        <span class="chain-pct-sm"></span>
      </div>
    `;
  } catch (e) {
    $("reservesTimestamp").textContent = `Error: ${e.message}`;
  } finally {
    $("reservesRefreshBtn").disabled = false;
  }
}

// --- Helpers ---

function formatNum(s) {
  const n = parseFloat(s);
  if (n === 0) return "0";
  if (n < 0.000001) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatEther(weiStr) {
  // Convert wei string to ether with 6 decimal places
  const wei = BigInt(weiStr);
  const ether = Number(wei) / 1e18;
  return ether.toFixed(6);
}

function getChainSymbol(chainId) {
  return chains.find((c) => c.id === chainId)?.nativeSymbol ?? "";
}

function showResult(elementId, label, html) {
  const el = $(elementId);
  el.hidden = false;
  el.innerHTML = `<div class="result-label">${label}</div>${html}`;
}

init();

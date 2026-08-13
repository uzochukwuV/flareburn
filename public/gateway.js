// gateway.js — FXRP Mint Gateway frontend (dynamic data binding)
// Read-only data + payment calldata preparation (no signing). Vanilla JS, no deps.

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  if (!$("xrplAddressInput")) return; // not on gateway page

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    selectedAction: "mint_only",
    resolvedAddress: null,
    accountState: null, // { personalAccount, nonce, fxrpBalance }
    status: null, // /status response
    vaults: [],
    lastQuote: null,
    lastPrepared: null,
  };

  const XRPL_RE = /^r[a-zA-Z0-9]{20,40}$/;
  const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
  const LS_KEY = "gateway.xrplAddress";

  // ---------------------------------------------------------------------------
  // API helpers (with retry + cache)
  // ---------------------------------------------------------------------------
  const cache = new Map();
  function withTtl(key, ttlMs) {
    const e = cache.get(key);
    if (e && Date.now() - e.t < ttlMs) return e.v;
    return undefined;
  }
  function setTtl(key, v) {
    cache.set(key, { v, t: Date.now() });
  }

  async function apiGet(path, ttlMs = 0) {
    if (ttlMs) {
      const c = withTtl(path, ttlMs);
      if (c !== undefined) return c;
    }
    const v = await fetchJson(path);
    if (ttlMs) setTtl(path, v);
    return v;
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function fetchJson(path, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(path);
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: text }; }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
    throw lastErr;
  }

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function fmtNum(n, dp = 2) {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtXrp(n) {
    return `-${fmtNum(n, 6)} XRP`;
  }
  function fmtFxrp(n) {
    return `${fmtNum(n, 6)} FXRP`;
  }
  function fmtPrice(usd) {
    return `$${fmtNum(usd, 4)}`;
  }
  function shortAddr(addr, n = 6) {
    if (!addr) return "—";
    return `${addr.slice(0, n + 2)}…${addr.slice(-4)}`;
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastTimer;
  function toast(msg, ms = 2500) {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
  }

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("Copied");
    }
  }

  // ---------------------------------------------------------------------------
  // Init: load /status + /ftso-price + /vaults
  // ---------------------------------------------------------------------------
  async function loadSystem() {
    try {
      state.status = await apiGet("/status", 60_000);
    } catch (e) { console.warn("status:", e.message); }
    try {
      const price = await apiGet("/ftso-price", 30_000);
      const el = $("xrpPrice");
      if (el && price.priceUsd) el.textContent = fmtPrice(price.priceUsd);
    } catch (e) { console.warn("ftso-price:", e.message); }
    await loadVaults();
  }

  async function loadVaults() {
    try {
      const data = await apiGet("/vaults", 60_000);
      state.vaults = data.vaults || [];
      const sel = $("vaultSelect");
      if (sel) {
        sel.innerHTML = '<option value="">Select a vault...</option>' +
          state.vaults.map((v) =>
            `<option value="${v.vaultId}">${v.name} — ${fmtNum(v.fxrpBalance, 2)} FXRP</option>`
          ).join("");
      }
    } catch (e) { console.warn("vaults:", e.message); }
  }

  // ---------------------------------------------------------------------------
  // Address resolution
  // ---------------------------------------------------------------------------
  async function resolveAddress() {
    const input = $("xrplAddressInput");
    const addr = (input.value || "").trim();
    if (!XRPL_RE.test(addr)) {
      toast("Invalid XRPL address (must start with r)");
      setAccountStatus(null);
      return;
    }
    const btn = $("resolveBtn");
    btn.textContent = "Resolving…";
    btn.disabled = true;
    try {
      const data = await apiGet(`/personal-account?xrplAddress=${encodeURIComponent(addr)}`);
      state.accountState = data;
      state.resolvedAddress = addr;
      setAccountStatus(data);
      window.WalletStore?.setXrpl?.(addr);
      toast("Smart account resolved");
      // Auto-prepare if amount already set
      schedulePrepare();
    } catch (e) {
      toast(`Resolve failed: ${e.message}`);
      setAccountStatus(null);
    } finally {
      btn.textContent = "Resolve";
      btn.disabled = false;
    }
  }

  function setAccountStatus(data) {
    const dot = $("accountStatusDot");
    const text = $("accountStatusText");
    const nonce = $("currentNonce");
    if (data) {
      dot.className = "w-2 h-2 rounded-full bg-primary";
      text.className = "text-data-md font-data-md text-primary-fixed-dim";
      text.textContent = "Active / Validated";
      nonce.textContent = Number(data.nonce).toLocaleString();
    } else {
      dot.className = "w-2 h-2 rounded-full bg-on-surface-variant";
      text.className = "text-data-md font-data-md text-on-surface-variant";
      text.textContent = "Not resolved";
      nonce.textContent = "—";
    }
  }

  // ---------------------------------------------------------------------------
  // Quote
  // ---------------------------------------------------------------------------
  let quoteTimer;
  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(runQuote, 400);
  }

  async function runQuote() {
    const amount = ($("mintAmountInput").value || "").trim();
    if (!amount || Number(amount) <= 0) {
      $("mintingFee").textContent = "—";
      $("executorFee").textContent = "—";
      $("receiveAmount").textContent = "—";
      state.lastQuote = null;
      return;
    }
    try {
      const q = await apiPost("/quote", { paymentXrp: String(amount) });
      state.lastQuote = q;
      $("mintingFee").textContent = fmtXrp(q.mintingFeeXrp);
      $("executorFee").textContent = fmtXrp(q.executorFeeXrp);
      if (q.fxpReceivedXrp === null || q.fxpReceivedXrp === undefined) {
        $("receiveAmount").textContent = "Below minimum";
      } else {
        $("receiveAmount").textContent = fmtFxrp(q.fxpReceivedXrp);
      }
      schedulePrepare();
    } catch (e) {
      $("mintingFee").textContent = "—";
      $("executorFee").textContent = "—";
      $("receiveAmount").textContent = e.message;
      state.lastQuote = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Action selection
  // ---------------------------------------------------------------------------
  function selectAction(action) {
    state.selectedAction = action;
    document.querySelectorAll(".action-btn").forEach((btn) => {
      const active = btn.dataset.action === action;
      // toggle active styles
      if (active) {
        btn.classList.add("border-primary/50", "bg-primary/5");
        btn.classList.remove("border-outline-variant/30");
      } else {
        btn.classList.remove("border-primary/50", "bg-primary/5");
        btn.classList.add("border-outline-variant/30");
      }
    });

    // show/hide action-specific fields
    const fieldsWrap = $("actionFields");
    const allFieldSets = document.querySelectorAll(".action-fields");
    allFieldSets.forEach((f) => f.classList.add("hidden"));
    if (action === "mint_only") {
      fieldsWrap.classList.add("hidden");
    } else {
      fieldsWrap.classList.remove("hidden");
      const map = { transfer: "transferFields", redeem: "redeemFields", vault_deposit: "vaultFields" };
      const target = $(map[action]);
      if (target) target.classList.remove("hidden");
    }
    schedulePrepare();
  }

  // ---------------------------------------------------------------------------
  // Build action payload from the selected action + inputs
  // ---------------------------------------------------------------------------
  function buildActionPayload() {
    const a = state.selectedAction;
    if (a === "mint_only") return { type: "mint_only" };
    if (a === "transfer") {
      const to = ($("transferToFlare").value || "").trim();
      const amt = ($("transferFxrpAmount").value || "").trim();
      if (!EVM_RE.test(to)) throw new Error("Invalid Flare recipient (must be 0x…)");
      if (!amt || Number(amt) <= 0) throw new Error("Enter a FXRP transfer amount");
      return { type: "transfer", toFlareAddress: to, fxrpAmountXrp: String(amt) };
    }
    if (a === "redeem") {
      const dest = ($("redeemXrplAddress").value || "").trim();
      const tag = ($("redeemDestinationTag").value || "").trim();
      const amt = ($("redeemFxrpAmount").value || "").trim();
      if (!XRPL_RE.test(dest)) throw new Error("Invalid redeemer XRPL address (must be r…)");
      if (!amt || Number(amt) <= 0) throw new Error("Enter a FXRP redeem amount");
      const base = { redeemerXrplAddress: dest, fxrpAmountXrp: String(amt) };
      if (tag !== "") {
        const t = Number(tag);
        if (!Number.isInteger(t) || t < 0 || t > 0xffffffff) throw new Error("Destination tag must be 0..4294967295");
        return { type: "redeem_with_tag", ...base, destinationTag: t };
      }
      return { type: "redeem", ...base };
    }
    if (a === "vault_deposit") {
      const vaultId = $("vaultSelect").value;
      const amt = ($("vaultFxrpAmount").value || "").trim();
      if (!vaultId) throw new Error("Select a vault");
      if (!amt || Number(amt) <= 0) throw new Error("Enter a FXRP deposit amount");
      return { type: "vault_deposit", vaultId: Number(vaultId), fxrpAmountXrp: String(amt) };
    }
    throw new Error("Unknown action");
  }

  // ---------------------------------------------------------------------------
  // Prepare payment
  // ---------------------------------------------------------------------------
  let prepareTimer;
  function schedulePrepare() {
    // only auto-prepare when a quote has been fetched and address resolved
    if (!state.resolvedAddress || !state.lastQuote) return;
    clearTimeout(prepareTimer);
    prepareTimer = setTimeout(runPrepare, 500);
  }

  async function runPrepare() {
    const addr = state.resolvedAddress;
    if (!addr) { toast("Resolve an address first"); return; }
    const amount = ($("mintAmountInput").value || "").trim();
    if (!amount || Number(amount) <= 0) return;
    let action;
    try { action = buildActionPayload(); } catch (e) { toast(e.message); return; }

    const statusEl = $("prepareStatus");
    statusEl.textContent = "Preparing…";
    try {
      const data = await apiPost("/prepare-payment", {
        xrplAddress: addr,
        amountXrp: String(amount),
        action,
      });
      state.lastPrepared = data;
      renderPrepared(data);
      statusEl.textContent = "Ready";
    } catch (e) {
      statusEl.textContent = "Error";
      $("paymentJson").textContent = e.message;
      $("memoHex").textContent = "—";
      $("callsPreviewWrap").classList.add("hidden");
      $("prepareNote").textContent = "";
      state.lastPrepared = null;
    }
  }

  function renderPrepared(data) {
    // Payment JSON
    $("paymentJson").textContent = JSON.stringify(data.payment, null, 2);
    // Memo hex
    $("memoHex").textContent = data.memoHex || "—";
    $("memoHex").title = data.memoHex || "";
    // Calls preview
    const wrap = $("callsPreviewWrap");
    const cont = $("callsPreview");
    if (data.callsPreview && data.callsPreview.length) {
      wrap.classList.remove("hidden");
      cont.innerHTML = data.callsPreview.map((c, i) => {
        const valEth = c.value !== "0" ? ` (value: ${c.value})` : "";
        return `<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-2">
          <div class="text-label-sm font-label-sm text-primary-fixed-dim">Call ${i + 1}: ${shortAddr(c.target, 8)}${valEth}</div>
          <div class="text-label-sm font-label-sm text-on-surface-variant font-mono break-all mt-1">${(c.data || "").slice(0, 80)}${(c.data || "").length > 80 ? "…" : ""}</div>
        </div>`;
      }).join("");
    } else {
      wrap.classList.add("hidden");
    }
    // Note
    $("prepareNote").textContent = data.note || "";
  }

  // ---------------------------------------------------------------------------
  // Wallet connection (XRPL — manual address entry, Xaman stubbed)
  // ---------------------------------------------------------------------------
  function openWalletModal() {
    $(
"walletModal").classList.remove("hidden");
    const saved = window.WalletStore?.getXrpl?.();
    if (saved && !$("walletAddressInput").value) $("walletAddressInput").value = saved;
  }
  function closeWalletModal() {
    $("walletModal").classList.add("hidden");
  }
  function loadWalletAddress() {
    const addr = ($("walletAddressInput").value || "").trim();
    if (!XRPL_RE.test(addr)) { toast("Invalid XRPL address"); return; }
    $("xrplAddressInput").value = addr;
    closeWalletModal();
    resolveAddress();
    // update connect button label
    $("connectWalletBtn").textContent = shortAddr(addr);
  }
  function xamanStub() {
    toast("Xaman requires VITE_XAMAN_API_KEY/SECRET — enter address manually for now");
  }

  // ---------------------------------------------------------------------------
  // Sign (no signing — copy the payment JSON for the user to sign in their XRPL wallet)
  // ---------------------------------------------------------------------------
  function signAction() {
    if (!state.lastPrepared) { toast("Prepare the payment first"); return; }
    const json = JSON.stringify(state.lastPrepared.payment, null, 2);
    copyText(json);
    toast("Payment JSON copied — sign it in your XRPL wallet (Xaman/Ledger)");
  }

  // ---------------------------------------------------------------------------
  // Wire up DOM events
  // ---------------------------------------------------------------------------
  function wire() {
    $("resolveBtn").addEventListener("click", resolveAddress);
    $("xrplAddressInput").addEventListener("keydown", (e) => { if (e.key === "Enter") resolveAddress(); });
    $("mintAmountInput").addEventListener("input", () => { scheduleQuote(); });
    $("prepareBtn").addEventListener("click", runPrepare);
    $("copyPaymentBtn").addEventListener("click", () => {
      const txt = $("paymentJson").textContent;
      if (txt && txt !== "Resolve an address and enter an amount, then click Prepare Payment.") copyText(txt);
    });
    $("copyMemoBtn").addEventListener("click", () => {
      const txt = $("memoHex").textContent;
      if (txt && txt !== "—") copyText(txt);
    });
    $("signBtn").addEventListener("click", signAction);

    // action buttons
    document.querySelectorAll(".action-btn").forEach((btn) => {
      btn.addEventListener("click", () => selectAction(btn.dataset.action));
    });

    // wallet modal
    $("connectWalletBtn").addEventListener("click", openWalletModal);
    $("walletModalClose").addEventListener("click", closeWalletModal);
    $("walletModal").addEventListener("click", (e) => { if (e.target.id === "walletModal") closeWalletModal(); });
    $("walletLoadBtn").addEventListener("click", loadWalletAddress);
    $("walletAddressInput").addEventListener("keydown", (e) => { if (e.key === "Enter") loadWalletAddress(); });
    $("xamanConnectBtn").addEventListener("click", xamanStub);

    // auto-resolve on action field changes (triggers prepare)
    ["transferToFlare", "transferFxrpAmount", "redeemXrplAddress", "redeemDestinationTag", "redeemFxrpAmount", "vaultSelect", "vaultFxrpAmount"]
      .forEach((id) => { const el = $(id); if (el) el.addEventListener("input", schedulePrepare); });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    wire();
    selectAction("mint_only");
    await loadSystem();
    // auto-resolve saved address
    const saved = window.WalletStore?.getXrpl?.();
    if (saved && XRPL_RE.test(saved)) {
      $("xrplAddressInput").value = saved;
      $("connectWalletBtn").textContent = shortAddr(saved);
      resolveAddress();
    }
    // initial quote with the default amount
    scheduleQuote();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

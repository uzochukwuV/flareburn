// wallet.js — centralized browser-side wallet state
// Shared across landing page (index.html), gateway (gateway.html), and portfolio (portfolio.html)
// Persists both EVM and XRPL wallet addresses to localStorage
// Each page connects independently; this is just the shared store

(() => {
  "use strict";

  // ============ Centralized wallet state ============
  const store = {
    evm: null,     // { address, walletType: "metamask" | "manual" }
    xrpl: null,    // { address }
    listeners: [],
  };

  const LS_WALLET = "flareburn_wallet";
  const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
  const XRPL_RE = /^r[a-zA-Z0-9]{20,40}$/;

  // ============ Persistence ============
  function persist() {
    const data = {
      evm: store.evm,
      xrpl: store.xrpl,
    };
    try {
      localStorage.setItem(LS_WALLET, JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to persist wallet state:", e);
    }
  }

  function restore() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_WALLET) || "{}");
      if (data.evm && data.evm.address && EVM_RE.test(data.evm.address)) {
        store.evm = data.evm;
      }
      if (data.xrpl && data.xrpl.address && XRPL_RE.test(data.xrpl.address)) {
        store.xrpl = data.xrpl;
      }
    } catch (e) {
      console.warn("Failed to restore wallet state:", e);
    }
  }

  // ============ Getters ============
  function getEvm() {
    return store.evm?.address || null;
  }

  function getXrpl() {
    return store.xrpl?.address || null;
  }

  function getAll() {
    return {
      evm: store.evm?.address || null,
      xrpl: store.xrpl?.address || null,
    };
  }

  // ============ Setters ============
  function setEvm(address, walletType = "metamask") {
    if (!address) {
      store.evm = null;
    } else if (EVM_RE.test(address.toLowerCase())) {
      store.evm = { address: address.toLowerCase(), walletType };
    } else {
      throw new Error(`Invalid EVM address: ${address}`);
    }
    persist();
    notify();
  }

  function setXrpl(address) {
    if (!address) {
      store.xrpl = null;
    } else if (XRPL_RE.test(address)) {
      store.xrpl = { address };
    } else {
      throw new Error(`Invalid XRPL address: ${address}`);
    }
    persist();
    notify();
  }

  function clearEvm() {
    store.evm = null;
    persist();
    notify();
  }

  function clearXrpl() {
    store.xrpl = null;
    persist();
    notify();
  }

  function clearAll() {
    store.evm = null;
    store.xrpl = null;
    try {
      localStorage.removeItem(LS_WALLET);
    } catch {}
    notify();
  }

  // ============ Event listeners ============
  function onWalletChange(callback) {
    if (typeof callback === "function") {
      store.listeners.push(callback);
    }
  }

  function notify() {
    const state = getAll();
    store.listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (e) {
        console.warn("Wallet change listener error:", e);
      }
    });
  }

  // ============ Export to global ============
  window.WalletStore = {
    getEvm,
    getXrpl,
    getAll,
    setEvm,
    setXrpl,
    clearEvm,
    clearXrpl,
    clearAll,
    onWalletChange,
    restore,
  };

  // Restore on load
  restore();
  // Notify any listeners immediately (in case this script loads late)
  notify();
})();

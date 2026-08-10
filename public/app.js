// XRP→Flare gateway frontend. No keys, no signing — only displays unsigned
// Payment objects and memos for the user to review and sign in their XRPL wallet.

const $ = (id) => document.getElementById(id);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");

const api = (path, opts) =>
  fetch(path, opts).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  });

// --- network status -------------------------------------------------------

async function loadStatus() {
  try {
    const s = await api("/status");
    const pill = $("netPill");
    pill.classList.add("live");
    pill.dataset.network = s.network;
    $("netLabel").textContent = `${s.network} · Core Vault ${s.directMinting.coreVaultAddress.slice(0, 8)}…`;
    window.__coreVault = s.directMinting.coreVaultAddress;
    window.__fxrpToken = s.fxrpToken.address;
    window.__assetManager = s.contracts.assetManager;
  } catch (e) {
    $("netLabel").textContent = "rpc offline";
  }
}

// --- step 1: smart account ------------------------------------------------

$("btnAccount").addEventListener("click", async () => {
  const xrplAddress = $("xrplAddress").value.trim();
  if (!/^r[a-zA-Z0-9]{20,40}$/.test(xrplAddress)) {
    alert("Enter a valid XRPL r-address.");
    return;
  }
  try {
    const res = await api(`/personal-account?xrplAddress=${encodeURIComponent(xrplAddress)}`);
    $("paAddress").textContent = res.personalAccount;
    $("paNonce").textContent = res.nonce;
    $("paBalance").textContent = `${res.fxrpBalance} FXRP`;
    show($("accountResult"));
  } catch (e) {
    alert("Could not resolve smart account: " + e.message);
  }
});

// --- step 2: action fields ------------------------------------------------

const ACTION_FIELDS = {
  mint_only: "",
  transfer: `
    <label>Flare recipient (0x…)</label>
    <input id="f_toFlareAddress" type="text" placeholder="0x…" />
    <label>FXRP amount</label>
    <input id="f_fxrpAmountXrp" type="text" inputmode="decimal" placeholder="e.g. 9.5" />`,
  redeem: `
    <label>Redeem to XRPL address (r…)</label>
    <input id="f_redeemerXrplAddress" type="text" placeholder="r…" />
    <label>FXRP amount to redeem</label>
    <input id="f_fxrpAmountXrp" type="text" inputmode="decimal" placeholder="e.g. 9.5" />`,
  redeem_with_tag: `
    <label>Exchange XRPL address (r…)</label>
    <input id="f_redeemerXrplAddress" type="text" placeholder="r…" />
    <label>Destination tag</label>
    <input id="f_destinationTag" type="text" inputmode="numeric" placeholder="e.g. 123456" />
    <label>FXRP amount to redeem</label>
    <input id="f_fxrpAmountXrp" type="text" inputmode="decimal" placeholder="e.g. 9.5" />`,
  vault_deposit: `
    <label>Vault</label>
    <select id="f_vaultId">
      <option value="">Loading vaults…</option>
    </select>
    <span id="vaultBalance" class="hint"></span>
    <label>FXRP amount to deposit</label>
    <input id="f_fxrpAmountXrp" type="text" inputmode="decimal" placeholder="e.g. 9.5" />`,
  bridge: `
    <label>Destination chain</label>
    <select id="f_dstChain">
      <option value="">Loading chains…</option>
    </select>
    <label>Recipient on destination (0x…)</label>
    <input id="f_recipientAddress" type="text" placeholder="0x…" />
    <label>FXRP amount to bridge</label>
    <input id="f_fxrpAmountXrp" type="text" inputmode="decimal" placeholder="e.g. 9.5" />`,
};

function selectedAction() {
  return document.querySelector('input[name="action"]:checked').value;
}

function renderActionFields() {
  const fields = $("actionFields");
  fields.innerHTML = ACTION_FIELDS[selectedAction()] || "";
  if (selectedAction() !== "mint_only") hide(fields) || show(fields);
  selectedAction() === "mint_only" ? hide(fields) : show(fields);
  // Populate bridge destination chain dropdown
  if (selectedAction() === "bridge") loadBridgeChains();
  // Populate vault dropdown
  if (selectedAction() === "vault_deposit") loadVaults();
}

async function loadVaults() {
  try {
    const res = await api("/vaults");
    const select = $("f_vaultId");
    if (!select) return;
    select.innerHTML = "";
    for (const v of res.vaults) {
      const label = `${v.name} (${v.fxrpBalance} FXRP)`;
      select.add(new Option(label, String(v.vaultId)));
    }
    select.addEventListener("change", () => {
      const opt = select.selectedOptions[0];
      const bal = $("vaultBalance");
      if (bal) bal.textContent = opt ? opt.text : "";
    });
    if (select.selectedOptions[0] && $("vaultBalance")) {
      $("vaultBalance").textContent = select.selectedOptions[0].text;
    }
  } catch {
    // ignore — dropdown stays empty
  }
}

async function loadBridgeChains() {
  try {
    const res = await api("/bridge-chains");
    const select = $("f_dstChain");
    if (!select) return;
    select.innerHTML = "";
    for (const c of res.chains) {
      select.add(new Option(c.name, c.id));
    }
  } catch {
    // ignore — dropdown stays empty
  }
}
document.querySelectorAll('input[name="action"]').forEach((r) =>
  r.addEventListener("change", renderActionFields),
);
renderActionFields();

// --- step 3: quote --------------------------------------------------------

$("btnQuote").addEventListener("click", async () => {
  const paymentXrp = $("amountXrp").value.trim();
  if (!paymentXrp) { alert("Enter an XRP amount."); return; }
  try {
    const res = await api("/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentXrp }),
    });
    $("qMintFee").textContent = `${res.mintingFeeXrp} XRP`;
    $("qExecFee").textContent = `${res.executorFeeXrp} XRP`;
    $("qReceive").textContent =
      res.fxpReceivedXrp === null
        ? "⚠ below minimum fee floor"
        : `${res.fxpReceivedXrp} FXRP`;
    show($("quoteResult"));
  } catch (e) {
    alert("Quote failed: " + e.message);
  }
});

// --- step 4: prepare payment ---------------------------------------------

function buildActionPayload() {
  const type = selectedAction();
  const v = (id) => ($(id) ? $(id).value.trim() : "");
  switch (type) {
    case "mint_only":
      return { type };
    case "transfer":
      return {
        type,
        toFlareAddress: v("f_toFlareAddress"),
        fxrpAmountXrp: v("f_fxrpAmountXrp"),
      };
    case "redeem":
      return {
        type,
        redeemerXrplAddress: v("f_redeemerXrplAddress"),
        fxrpAmountXrp: v("f_fxrpAmountXrp"),
      };
    case "redeem_with_tag":
      return {
        type,
        redeemerXrplAddress: v("f_redeemerXrplAddress"),
        destinationTag: Number(v("f_destinationTag")),
        fxrpAmountXrp: v("f_fxrpAmountXrp"),
      };
    case "vault_deposit":
      return {
        type,
        vaultId: Number(v("f_vaultId")),
        fxrpAmountXrp: v("f_fxrpAmountXrp"),
      };
    case "bridge":
      return {
        type,
        dstChain: v("f_dstChain"),
        recipientAddress: v("f_recipientAddress"),
        fxrpAmountXrp: v("f_fxrpAmountXrp"),
      };
  }
}

$("btnPrepare").addEventListener("click", async () => {
  const xrplAddress = $("xrplAddress").value.trim();
  const amountXrp = $("amountXrp").value.trim();
  if (!xrplAddress) { alert("Resolve your smart account first."); return; }
  if (!amountXrp) { alert("Enter an XRP amount."); return; }

  const action = buildActionPayload();
  try {
    const res = await api("/prepare-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xrplAddress, amountXrp, action }),
    });
    renderPrepareResult(res);
  } catch (e) {
    alert("Prepare failed: " + e.message);
  }
});

function renderPrepareResult(res) {
  const el = $("prepareResult");
  const paymentJson = JSON.stringify(res.payment, null, 2);
  const calls = res.callsPreview
    ? res.callsPreview
        .map((c, i) => `  [${i}] → ${c.target}\n      data: ${c.data}`)
        .join("\n")
    : "(none — plain mint)";
  el.innerHTML = `
    <button class="copy-btn" onclick="copyText(${JSON.stringify(paymentJson)})">copy payment</button>
    <span class="label">kind:</span> ${res.kind}
    ${res.action ? `\n<span class="label">action:</span> ${res.action}` : ""}
    ${res.personalAccount ? `\n<span class="label">personal account:</span> ${res.personalAccount}` : ""}
    ${res.nonce ? `\n<span class="label">nonce:</span> ${res.nonce}` : ""}
    <span class="label">memo (MemoData, hex):</span> ${res.memoHex}
    <span class="label">calls:</span>\n${calls}
    <span class="warn">⚠ Review carefully. Sign this Payment in your XRPL wallet (Xaman, etc.).</span>
    <span class="warn">⚠ Do not add a destination tag${res.action ? " — it would break the smart-account flow" : ""}.</span>
    <span class="label">payment JSON:</span>\n${paymentJson}`;
  show(el);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => console.log("copied"),
    () => alert("copy failed"),
  );
}
window.copyText = copyText;

loadStatus();

/**
 * Tests for the exchange-friendly redemption router + proof-of-reserves.
 *
 * Run: npm run test:exchange
 */

import { ethers } from "ethers";
import {
  getExchanges,
  getExchange,
  getExchangeByAddress,
  validateRedemption,
  isValidXrplAddress,
  isValidDestinationTag,
} from "../lib/exchange-registry.js";
import { buildRedeemWithTagCall, buildRedeemAmountCall } from "../lib/action-builders.js";
import { FlareClient, NETWORKS } from "../lib/flare-client.js";
import { computeProofOfReserves } from "../lib/proof-of-reserves.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

// Known Coston2 AssetManager for calldata verification.
const COSTON2_ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

async function main() {
  console.log("\n=== Unit: Exchange Registry ===\n");

  const exchanges = getExchanges(true);
  assert(exchanges.length >= 5, `registry has ≥5 active exchanges (got ${exchanges.length})`);

  const binance = getExchange("binance");
  assert(binance !== undefined, "getExchange('binance') found");
  assert(binance!.requiresTag === true, "Binance requires tag");
  assert(binance!.minDepositXrp > 0, "Binance has positive min deposit");
  assert(binance!.depositAddress.startsWith("r"), "Binance deposit address is r-prefixed");

  const byAddress = getExchangeByAddress("rEb8TK3gBgk5auZkwc6sHnwrGVJH8DukL7");
  assert(byAddress?.id === "binance", "getExchangeByAddress resolves Binance");
  assert(getExchangeByAddress("rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX") === undefined, "unknown address returns undefined");

  const inactive = getExchanges(false).filter((e) => !e.active);
  assert(inactive.length >= 1, `registry has ≥1 inactive exchange (got ${inactive.length})`);

  console.log("\n=== Unit: Address + Tag Validation ===\n");

  assert(isValidXrplAddress("rDsbeomae4FXwgQTJp9RH64vSsziqWYF8u"), "valid r-address accepted");
  assert(!isValidXrplAddress("0x1234"), "0x address rejected");
  assert(!isValidXrplAddress("rShort"), "too-short r-address rejected");
  assert(!isValidXrplAddress(""), "empty string rejected");

  assert(isValidDestinationTag(12345), "numeric tag accepted");
  assert(isValidDestinationTag("12345"), "string tag accepted");
  assert(!isValidDestinationTag(-1), "negative tag rejected");
  assert(!isValidDestinationTag(0x100000000), "tag > uint32 rejected");
  assert(!isValidDestinationTag("abc"), "non-numeric string tag rejected");

  console.log("\n=== Unit: Redemption Validation ===\n");

  // Exchange with tag missing → error
  const noTag = validateRedemption(binance, "100", undefined);
  assert(noTag.errors.length > 0, "Binance without tag → error");
  assert(noTag.errors[0].includes("requires a destination tag"), "error message mentions tag");

  // Exchange with tag → OK
  const withTag = validateRedemption(binance, "100", 12345);
  assert(withTag.errors.length === 0, "Binance with tag → no errors");

  // Below minimum → warning
  const belowMin = validateRedemption(binance, "5", 12345);
  assert(belowMin.warnings.length > 0, "below minimum → warning");
  assert(belowMin.warnings[0].includes("minimum"), "warning mentions minimum");

  // No exchange (personal address) → no errors, no warnings
  const personal = validateRedemption(undefined, "100", undefined);
  assert(personal.errors.length === 0, "personal address without tag → no errors");
  assert(personal.warnings.length === 0, "personal address → no warnings");

  console.log("\n=== Unit: Redeem Calldata (redeemWithTag) ===\n");

  const call = buildRedeemWithTagCall(
    COSTON2_ASSET_MANAGER,
    100_000000n, // 100 XRP in UBA (6 decimals)
    "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DukL7", // Binance
    12345,
  );
  assert(call.target === COSTON2_ASSET_MANAGER, "calldata target = AssetManager");
  assert(call.value === 0n, "calldata value = 0");

  // Decode the calldata to verify
  const iface = new ethers.Interface([
    "function redeemWithTag(uint256 amountUBA, string redeemerUnderlyingAddressString, address executor, uint32 destinationTag) returns (uint256)",
  ]);
  const decoded = iface.decodeFunctionData("redeemWithTag", call.data);
  assert(decoded[0] === 100_000000n, "decoded amount = 100 XRP (UBA)");
  assert(decoded[1] === "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DukL7", "decoded r-address = Binance");
  assert(Number(decoded[3]) === 12345, "decoded destination tag = 12345");

  // Verify the selector matches the on-chain function
  const expectedSelector = iface.getFunction("redeemWithTag")!.selector;
  const actualSelector = call.data.slice(0, 10);
  assert(actualSelector === expectedSelector, `redeemWithTag selector matches (${actualSelector})`);

  console.log("\n=== Unit: Redeem Calldata (redeemAmount, no tag) ===\n");

  const callNoTag = buildRedeemAmountCall(
    COSTON2_ASSET_MANAGER,
    50_000000n,
    "rDsbeomae4FXwgQTJp9RH64vSsziqWYF8u",
  );
  const iface2 = new ethers.Interface([
    "function redeemAmount(uint256 amountUBA, string redeemerUnderlyingAddressString, address executor) returns (uint256)",
  ]);
  const decoded2 = iface2.decodeFunctionData("redeemAmount", callNoTag.data);
  assert(decoded2[0] === 50_000000n, "decoded amount = 50 XRP (UBA)");
  assert(decoded2[1] === "rDsbeomae4FXwgQTJp9RH64vSsziqWYF8u", "decoded r-address");

  console.log("\n=== Integration: Proof of Reserves (Coston2) ===\n");

  try {
    const flare = new FlareClient(NETWORKS.coston2.rpc, "coston2");
    const reserves = await computeProofOfReserves(flare, false);

    assert(reserves.network === "coston2", `network = coston2 (got ${reserves.network})`);
    assert(reserves.fxrpTotalSupplyDrops.length > 0, "FXRP total supply fetched");
    assert(parseFloat(reserves.fxrpTotalSupply) >= 0, `FXRP supply ≥ 0 (got ${reserves.fxrpTotalSupply})`);
    assert(reserves.coreVaultAddress.startsWith("r"), `Core Vault is r-address (got ${reserves.coreVaultAddress.slice(0, 12)}…)`);
    assert(reserves.chainSupplies.length >= 1, `chain supplies fetched (got ${reserves.chainSupplies.length} chains)`);

    // The canonical chain (Flare adapter) should be present
    const canonical = reserves.chainSupplies.find((c) => c.isCanonical);
    assert(canonical !== undefined, "canonical Flare chain found in distribution");

    // Bridged total should be ≥ 0
    assert(parseFloat(reserves.bridgedTotal) >= 0, `bridged total ≥ 0 (got ${reserves.bridgedTotal})`);

    // Flare circulating should be ≤ total supply
    assert(
      parseFloat(reserves.flareCirculating) <= parseFloat(reserves.fxrpTotalSupply),
      `flare circulating ≤ total supply`,
    );

    console.log(`  ℹ FXRP supply: ${reserves.fxrpTotalSupply}`);
    console.log(`  ℹ Core Vault: ${reserves.coreVaultXrpBalance} XRP at ${reserves.coreVaultAddress.slice(0, 16)}…`);
    console.log(`  ℹ Backing ratio: ${reserves.backingRatio} (${reserves.status})`);
    console.log(`  ℹ Bridged: ${reserves.bridgedTotal} FXRP`);
    console.log(`  ℹ Flare circulating: ${reserves.flareCirculating} FXRP`);
    console.log(`  ℹ Chains: ${reserves.chainSupplies.map((c) => `${c.chainName}=${c.totalSupply}`).join(", ")}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("fetch failed") || msg.includes("ENOTFOUND") || msg.includes("ECONNREFUSED")) {
      console.log(`  ⚠ proof-of-reserves skipped (network restricted): ${msg.slice(0, 80)}`);
      assert(true, "proof-of-reserves test skipped (network restricted)");
    } else {
      assert(false, `proof-of-reserves failed: ${msg}`);
    }
  }

  console.log("\n" + (failed === 0 ? "\x1b[32m✅ ALL PASSED\x1b[0m" : "\x1b[31m❌ SOME FAILED\x1b[0m") + ` — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

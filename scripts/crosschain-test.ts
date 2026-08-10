/**
 * Cross-chain client tests — verifies multi-chain balance fetching and OFT
 * bridge calldata preparation against live mainnet RPCs.
 *
 * Run: npm run test:crosschain
 */
import { ethers } from "ethers";
import { MAINNET_CHAINS, FXRP_DECIMALS } from "../lib/chains.js";
import { getPortfolio, buildBridgeCallsData, getChainBalance } from "../lib/crosschain-client.js";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

console.log("=== chain registry ===");

assert(MAINNET_CHAINS.length === 7, `7 mainnet chains registered, got ${MAINNET_CHAINS.length}`);

const flare = MAINNET_CHAINS.find((c) => c.id === "flare")!;
assert(flare?.isAdapter === true, "Flare is OFT Adapter (locks tokens)");
assert(flare?.lzEid === 30295, `Flare LZ V2 EID = 30295, got ${flare?.lzEid}`);

const base = MAINNET_CHAINS.find((c) => c.id === "base")!;
assert(base?.isAdapter === false, "Base is native OFT (mint/burn)");
assert(base?.lzEid === 30184, `Base LZ V2 EID = 30184, got ${base?.lzEid}`);

const monad = MAINNET_CHAINS.find((c) => c.id === "monad")!;
assert(monad?.available === false, "Monad marked unavailable (no stable public RPC)");

// Verify all chains have distinct EIDs
const eids = MAINNET_CHAINS.map((c) => c.lzEid);
const uniqueEids = new Set(eids);
assert(uniqueEids.size === eids.length, "All chain EIDs are unique");

// Verify all OFT addresses are valid checksummed addresses
for (const c of MAINNET_CHAINS) {
  assert(ethers.isAddress(c.oftAddress), `${c.name} OFT address is valid`);
}

console.log("\n=== single-chain balance fetch (Base) ===");

// Fetch balance for the zero address on Base (should be 0, but supply should be real)
const zeroAddr = "0x0000000000000000000000000000000000000000";
try {
  const bal = await getChainBalance(base, zeroAddr);
  assert(!bal.error, `Base balance fetch succeeded${bal.error ? `: ${bal.error}` : ""}`);
  assert(BigInt(bal.balanceUba) === 0n, `Zero address has 0 balance, got ${bal.balanceUba}`);
  assert(parseFloat(bal.totalSupply) > 0, `Base has non-zero FXRP supply, got ${bal.totalSupply}`);
  console.log(`  ℹ Base FXRP supply: ${bal.totalSupply}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Base balance fetch threw: ${msg}`);
  failed++;
}

console.log("\n=== single-chain balance fetch (Flare OFT Adapter) ===");

try {
  const bal = await getChainBalance(flare, zeroAddr);
  assert(!bal.error, `Flare balance fetch succeeded${bal.error ? `: ${bal.error}` : ""}`);
  assert(parseFloat(bal.totalSupply) > 0, `Flare has non-zero FXRP supply, got ${bal.totalSupply}`);
  console.log(`  ℹ Flare FXRP supply: ${bal.totalSupply}`);
  // The adapter should have resolved the underlying token address (different from adapter)
  assert(bal.tokenAddress !== flare.oftAddress, `Adapter resolved underlying token: ${bal.tokenAddress}`);
  console.log(`  ℹ Underlying FXRP token on Flare: ${bal.tokenAddress}`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Flare balance fetch threw: ${msg}`);
  failed++;
}

console.log("\n=== portfolio (parallel multi-chain fetch) ===");

try {
  // Use the OFT contract address itself — it won't have a balance, but all chains should respond
  const portfolio = await getPortfolio("0xCE6170EA245dC8D1f275A710a062b70f125F0110", false);

  assert(portfolio.chains.length === 7, `Portfolio has 7 chain entries, got ${portfolio.chains.length}`);

  const successful = portfolio.chains.filter((c) => !c.error);
  assert(successful.length >= 4, `At least 4 chains responded successfully, got ${successful.length}`);

  // Total should be a valid decimal string
  assert(/^\d+(\.\d+)?$/.test(portfolio.totalFxrp), `Total FXRP is a valid number: ${portfolio.totalFxrp}`);

  // Every successful chain should have a valid tokenAddress and supply
  for (const c of successful) {
    assert(ethers.isAddress(c.tokenAddress), `${c.chainName}: token address valid`);
    assert(/^\d+$/.test(c.balanceUba), `${c.chainName}: balanceUba is numeric`);
    assert(parseFloat(c.totalSupply) >= 0, `${c.chainName}: totalSupply non-negative`);
  }

  console.log(`  ℹ Total FXRP: ${portfolio.totalFxrp}`);
  console.log(`  ℹ Chains with balance: ${portfolio.chainsWithBalance}`);
  for (const c of portfolio.chains) {
    const status = c.error ? "✗" : "✓";
    console.log(`    ${status} ${c.chainName.padEnd(12)} bal=${c.balance.padEnd(12)} supply=${c.totalSupply.slice(0, 15)}`);
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Portfolio fetch threw: ${msg}`);
  failed++;
}

console.log("\n=== bridge calldata (Base → BSC) ===");

try {
  const recipient = "0x1111111111111111111111111111111111111111";
  const callData = await buildBridgeCallsData(base, MAINNET_CHAINS.find((c) => c.id === "bsc")!, "100", recipient);

  // Should produce 2 calls: approve + send
  assert(typeof callData.approve.data === "string" && callData.approve.data.startsWith("0x"), "Approve call has hex data");
  assert(typeof callData.send.data === "string" && callData.send.data.startsWith("0x"), "Send call has hex data");

  // Approve selector = 0x095ea7b3 (ERC-20 approve(address,uint256))
  assert(callData.approve.data.slice(0, 10) === "0x095ea7b3", `Approve selector = 0x095ea7b3, got ${callData.approve.data.slice(0, 10)}`);

  // Send selector for OFT.send = varies, but should be a valid selector
  assert(callData.send.data.slice(0, 10).length === 10, `Send has valid selector: ${callData.send.data.slice(0, 10)}`);

  // Approve target should be the FXRP token address on Base
  assert(callData.approve.to === base.oftAddress, `Approve targets FXRP token, got ${callData.approve.to}`);

  // Send target should be the OFT address
  assert(callData.send.to === base.oftAddress, `Send targets OFT contract, got ${callData.send.to}`);

  // Native fee should be non-zero (LayerZero messaging costs gas)
  const nativeFee = BigInt(callData.send.value);
  assert(nativeFee > 0n, `Native LZ fee is non-zero: ${nativeFee} wei`);

  // Amount should be 100 FXRP = 100 * 10^6 = 100000000
  assert(callData.quote.amountUba === "100000000", `Amount in UBA = 100000000, got ${callData.quote.amountUba}`);

  console.log(`  ℹ Native LZ fee: ${ethers.formatEther(nativeFee)} ETH`);
  console.log(`  ℹ Approve data: ${callData.approve.data.slice(0, 40)}...`);
  console.log(`  ℹ Send data: ${callData.send.data.slice(0, 40)}...`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Bridge calldata test threw: ${msg}`);
  failed++;
}

console.log("\n=== bridge calldata (Flare → Base, via OFT Adapter) ===");

try {
  const recipient = "0x1111111111111111111111111111111111111111";
  const callData = await buildBridgeCallsData(flare, base, "50", recipient);

  // On Flare (adapter), the approve should target the underlying FXRP token,
  // not the adapter address itself
  assert(callData.approve.to !== flare.oftAddress, `Flare approve targets underlying token (not adapter): ${callData.approve.to}`);
  assert(callData.send.to === flare.oftAddress, `Flare send targets the OFT adapter: ${callData.send.to}`);

  // The send value should carry the native LZ fee
  const sendValue = BigInt(callData.send.value);
  assert(sendValue > 0n, `Flare send carries native LZ fee: ${sendValue} wei`);

  // Amount = 50 FXRP = 50000000
  assert(callData.quote.amountUba === "50000000", `Amount = 50000000 UBA, got ${callData.quote.amountUba}`);

  // Destination EID should be Base's
  assert(callData.quote.dstChain.lzEid === 30184, `Destination EID = 30184 (Base), got ${callData.quote.dstChain.lzEid}`);

  console.log(`  ℹ Approve target (underlying FXRP): ${callData.approve.to}`);
  console.log(`  ℹ Send target (OFT adapter): ${callData.send.to}`);
  console.log(`  ℹ Native LZ fee: ${ethers.formatEther(sendValue)} FLR`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Flare bridge calldata test threw: ${msg}`);
  failed++;
}

console.log(`\n${failed === 0 ? "✅ ALL PASSED" : "❌ SOME FAILED"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

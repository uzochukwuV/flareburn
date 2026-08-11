/**
 * Smoke test — verifies the memo builder produces correct byte layouts and the
 * Flare client can reach the Coston2 RPC + resolve contracts. No signing.
 *
 * Run: npm run smoke
 */
import { FlareClient } from "../lib/flare-client.js";
import {
  buildCallData,
  buildMemoCustomInstruction,
  buildPackedUserOp,
  decodeMemoCustomInstruction,
  buildDirectMintingMemo,
  OPCODE,
  type Call,
} from "../lib/memo-builder.js";
import { buildTransferCall } from "../lib/action-builders.js";
import { quoteMint, dropsToXrp, xrpToDrops } from "../lib/quote.js";

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

console.log("\n=== memo builder unit tests ===");

// 1. Plain direct minting memo (32 bytes, recipient only).
const recipient = "0x0123456789abcdef0123456789abcdef01234567";
const plainMemo = buildDirectMintingMemo(recipient);
assert(plainMemo.length === 64, `plain memo is 32 bytes (64 hex chars), got ${plainMemo.length}`);
assert(plainMemo.startsWith("4642505266410018"), "plain memo starts with DIRECT_MINTING prefix");
assert(plainMemo.endsWith(recipient.slice(2).toLowerCase()), "plain memo ends with recipient address");

// 2. callData for a single transfer call.
const fxrp = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const to = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const transferCall = buildTransferCall(fxrp, to, 1_000_000n);
const callData = buildCallData([transferCall]);
assert(callData.startsWith("0x"), "callData is 0x-prefixed");
assert(callData.length > 10, "callData is non-trivial");

// 3. PackedUserOperation encode.
const sender = "0xcccccccccccccccccccccccccccccccccccccccc";
const userOp = buildPackedUserOp(sender, 0n, [transferCall]);
assert(userOp.sender === sender, "userOp.sender preserved");
assert(userOp.nonce === 0n, "userOp.nonce preserved");
assert(userOp.callData === callData, "userOp.callData matches");

// 4. Full 0xFF memo: header + abi.encode(userOp).
const memoHex = buildMemoCustomInstruction({
  walletId: 0,
  executorFeeUba: 0n,
  userOp,
});
const memoBytes = memoHex.length / 2;
assert(memoBytes >= 10, `0xFF memo is at least 10 bytes, got ${memoBytes}`);
assert(memoHex.startsWith("ff"), "0xFF memo starts with opcode 0xff");

// 5. Round-trip decode.
const decoded = decodeMemoCustomInstruction(memoHex);
assert(decoded.opcode === OPCODE.MEMO_FIELD_CUSTOM_INSTRUCTION, "decoded opcode is 0xff");
assert(decoded.walletId === 0, "decoded walletId is 0");
assert(decoded.executorFeeUba === 0n, "decoded executorFeeUba is 0");

// 6. executor fee encoding (non-zero, big-endian).
const memoWithFee = buildMemoCustomInstruction({
  walletId: 5,
  executorFeeUba: 1_000_000n, // 1 XRP in drops
  userOp,
});
const decodedFee = decodeMemoCustomInstruction(memoWithFee);
assert(decodedFee.walletId === 5, "decoded walletId is 5");
assert(decodedFee.executorFeeUba === 1_000_000n, "decoded executorFeeUba is 1000000 (1 XRP)");

// 7. Quote math.
const settings = {
  minimumFeeUba: 100_000n, // 0.1 XRP
  feeBIPS: 25n, // 0.25%
  executorFeeUba: 100_000n, // 0.1 XRP
  othersCanExecuteAfterSeconds: 7200n,
  hourlyLimitUba: 100_000_000_000n,
  dailyLimitUba: 500_000_000_000n,
  largeMintingThresholdUba: 100_000_000_000n,
  largeMintingDelaySeconds: 3600n,
  feeReceiver: "0x0000000000000000000000000000000000000001",
  paymentAddress: "rXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};
const q = quoteMint(10_000_000n, settings); // want 10 FXRP
// fee = 10 * 0.0025 = 0.025 XRP = 25000 drops, but floor is 100000 → 100000
assert(q.mintingFee === 100_000n, `minting fee floored to 100000, got ${q.mintingFee}`);
assert(q.totalToSend === 10_000_000n + 100_000n + 100_000n, "total = desired + fee + executor");

// 8. drops/xrp conversion.
assert(dropsToXrp(1_000_000n) === "1", "1000000 drops = 1 XRP");
assert(dropsToXrp(1_500_000n) === "1.5", "1500000 drops = 1.5 XRP");
assert(xrpToDrops("10.5") === 10_500_000n, "10.5 XRP = 10500000 drops");

console.log("\n=== Flare client integration (Coston2) ===");
const network = (process.env.FLARE_NETWORK ?? "coston2") as
  | "flare"
  | "coston2"
  | "songbird"
  | "coston";
const rpc = process.env.FLARE_RPC_URL;
const flare = new FlareClient(rpc, network);
try {
  const contracts = await flare.resolveContracts();
  assert(ethers_isAddress(contracts.assetManager), `AssetManager resolved: ${contracts.assetManager}`);
  assert(ethers_isAddress(contracts.fxrpToken), `FXRP token resolved: ${contracts.fxrpToken}`);

  const settingsChain = await flare.getDirectMintingSettings();
  assert(settingsChain.paymentAddress.startsWith("r"), `Core Vault is an r-address: ${settingsChain.paymentAddress}`);
  console.log(`  ℹ Core Vault: ${settingsChain.paymentAddress}`);
  console.log(`  ℹ minting fee BIPS: ${settingsChain.feeBIPS}, min fee: ${dropsToXrp(settingsChain.minimumFeeUba)} XRP`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Flare client integration failed: ${msg}`);
  failed++;
}

console.log("\n=== Gasless redeem payment builder ===");
try {
  const { prepareGaslessRedeemPayment } = await import("../lib/payment.js");
  const { buildRedeemAmountCall } = await import("../lib/action-builders.js");

  const personalAccount = "0x1234567890123456789012345678901234567890";
  const assetManager = "0xab552A648c74d49e10027ab8A618A3aD4901c5be";
  const calls = [buildRedeemAmountCall(assetManager, 10_000_000n, "rDest1234567890123456789")];
  const { payment, memoHex } = prepareGaslessRedeemPayment({
    operatorXrplAddress: "rOperator1234567890123456789",
    senderXrplAddress: "rSender1234567890123456789",
    personalAccount,
    nonce: 5n,
    calls,
    executorFeeUba: 0n,
  });

  assert(payment.TransactionType === "Payment", "gasless payment is a Payment tx");
  assert(payment.Amount === "1", "gasless payment is 1 drop (minimal)");
  assert(payment.Destination === "rOperator1234567890123456789", "destination is operator address");
  assert(payment.Memos?.length === 1, "has one memo");
  assert(memoHex.startsWith("ff"), "memo starts with 0xFF opcode");

  // Verify the memo decodes correctly.
  const decoded = decodeMemoCustomInstruction(memoHex);
  assert(decoded.opcode === OPCODE.MEMO_FIELD_CUSTOM_INSTRUCTION, "decoded opcode is 0xFF");
  assert(decoded.walletId === 0, "walletId is 0");
  assert(decoded.executorFeeUba === 0n, "executor fee is 0");
  console.log(`  ℹ memo length: ${memoHex.length / 2} bytes`);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`  ✗ Gasless redeem builder failed: ${msg}`);
  failed++;
}

console.log(`\n${failed === 0 ? "✅ ALL PASSED" : "❌ SOME FAILED"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

function ethers_isAddress(a: unknown): boolean {
  return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
}

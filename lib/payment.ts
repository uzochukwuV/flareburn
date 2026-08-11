/**
 * Payment preparation — turn a user's intent into a signed-ready XRPL Payment
 * object targeting the FAssets Core Vault, with a memo carrying the 0xFF
 * memo-field custom instruction (mint + action) or a plain direct-mint memo.
 *
 * This module produces a JSON Payment object (xrpl.js shape) and the exact memo
 * bytes. Signing is always done by the user's XRPL wallet — never by this code.
 */

import { xrpToDrops } from "xrpl";
import type { Payment } from "xrpl";
import {
  type Call,
  type MemoCustomInstruction,
  buildMemoCustomInstruction,
  buildPackedUserOp,
} from "./memo-builder.js";

export interface PrepareMintAndActionInput {
  /** Core Vault XRPL r-address (from AssetManager.directMintingPaymentAddress()). */
  coreVaultAddress: string;
  /** The sender's XRPL r-address (signer of the Payment). */
  senderXrplAddress: string;
  /** Sender's Flare personal account (smart account) — FXRP mints here. */
  personalAccount: string;
  /** Current memo-instruction nonce of the personal account. */
  nonce: bigint;
  /** XRP amount to send, as a decimal string (e.g. "10.5"). */
  amountXrp: string;
  /** The action calls to execute atomically after minting. */
  calls: Call[];
  /** Wallet ID assigned by the operator (0 if not registered). */
  walletId?: number;
  /**
   * Executor fee in UBA. For the 0xFF (memo-field) single-actor variant the
   * executor fee is typically 0 because any indexer can finalize; set
   * explicitly only if coordinating with a specific executor.
   */
  executorFeeUba?: bigint;
  /** XRPL tx fee in drops (default "12"). */
  memosFeeDrops?: string;
  /** Optional destination tag — DO NOT set for smart-account (0xFF) flows. */
  destinationTag?: number;
}

/** Build a mint+action XRPL Payment with the 0xFF memo instruction. */
export function prepareMintAndActionPayment(
  input: PrepareMintAndActionInput,
): { payment: Payment; memoHex: string; userOpHash: string } {
  if (input.destinationTag !== undefined) {
    throw new Error(
      "Smart-account (0xFF) flows must NOT use a destination tag — it credits the tag-holder instead of the smart account.",
    );
  }
  const userOp = buildPackedUserOp(input.personalAccount, input.nonce, input.calls);
  const instr: MemoCustomInstruction = {
    walletId: input.walletId ?? 0,
    executorFeeUba: input.executorFeeUba ?? 0n,
    userOp,
  };
  const memoHex = buildMemoCustomInstruction(instr);

  const payment: Payment = {
    TransactionType: "Payment",
    Account: input.senderXrplAddress,
    Destination: input.coreVaultAddress,
    Amount: xrpToDrops(input.amountXrp),
    Fee: input.memosFeeDrops ?? "12",
    Memos: [{ Memo: { MemoData: memoHex } }],
    // No DestinationTag — see guard above.
  };
  return { payment, memoHex, userOpHash: userOp.callData };
}

export interface PrepareGaslessRedeemInput {
  /** Operator XRPL r-address (the payment destination for proof-based instructions). */
  operatorXrplAddress: string;
  /** The sender's XRPL r-address (signer of the Payment). */
  senderXrplAddress: string;
  /** Sender's Flare personal account (smart account) — holds the FXRP to redeem. */
  personalAccount: string;
  /** Current memo-instruction nonce of the personal account. */
  nonce: bigint;
  /** Redeem action calls (typically a single buildRedeemAmountCall or buildRedeemWithTagCall). */
  calls: Call[];
  /** Wallet ID assigned by the operator (0 if not registered). */
  walletId?: number;
  /** Executor fee in UBA (tip for the relayer that executes the instruction). */
  executorFeeUba?: bigint;
  /** XRPL tx fee in drops (default "12"). */
  memosFeeDrops?: string;
}

/**
 * Build a gasless-redeem XRPL Payment with a 0xFF memo instruction.
 *
 * Unlike prepareMintAndActionPayment (which sends XRP to the Core Vault to
 * mint FXRP), this creates a 1-drop self-payment to the operator's XRPL
 * address carrying a 0xFF memo with a redeem-only UserOp. The user needs no
 * FLR — the executor/relayer calls executeInstruction on Flare and pays gas.
 */
export function prepareGaslessRedeemPayment(
  input: PrepareGaslessRedeemInput,
): { payment: Payment; memoHex: string; userOpHash: string } {
  const userOp = buildPackedUserOp(input.personalAccount, input.nonce, input.calls);
  const instr: MemoCustomInstruction = {
    walletId: input.walletId ?? 0,
    executorFeeUba: input.executorFeeUba ?? 0n,
    userOp,
  };
  const memoHex = buildMemoCustomInstruction(instr);

  const payment: Payment = {
    TransactionType: "Payment",
    Account: input.senderXrplAddress,
    Destination: input.operatorXrplAddress,
    Amount: "1", // 1 drop — minimal payment, just to carry the memo
    Fee: input.memosFeeDrops ?? "12",
    Memos: [{ Memo: { MemoData: memoHex } }],
  };
  return { payment, memoHex, userOpHash: userOp.callData };
}

/**
 * XRPL payment monitor — watches the XRPL for Payment transactions targeting
 * the FAssets Core Vault address, then classifies each by memo type so the
 * executor knows which AssetManager entry point to call.
 *
 * Memo routing:
 *   - DIRECT_MINTING prefix (0x4642505266410018 / ...0021)  → executeDirectMinting
 *   - 0xFF (memo-field custom instruction)                   → executeDirectMinting (full userOp inline)
 *   - 0xFE (custom instruction, hash-commit)                 → executeDirectMintingWithData(proof, userOpData)
 *   - 0xE0 (skip memo), 0xE1 (fast-forward nonce)           → executeDirectMintingWithData(proof, "0x")
 *   - 0xE2 (replace executor fee)                            → executeDirectMinting
 *   - No memo + no destination tag                            → executeDirectMinting (smart-account path)
 *   - Destination tag set (no memo)                           → executeDirectMinting (MintingTagManager path)
 *
 * Sources:
 *   https://dev.flare.network/smart-accounts/memo-field-custom-instruction
 *   https://dev.flare.network/fassets/developer-guides/fassets-mint (direct minting memo)
 *   https://xrpl.org/subscribe.html (account transactions stream)
 */

import { Client, type AccountTxTransaction } from "xrpl";
import { ethers } from "ethers";
import {
  OPCODE,
  DIRECT_MINTING_PREFIX,
  DIRECT_MINTING_EX_PREFIX,
} from "./memo-builder.js";

/** Which AssetManager entry point the executor should call. */
export type ExecuteMode =
  | "executeDirectMinting" // plain memo, 0xFF, 0xE2, or no-memo/tag paths
  | "executeDirectMintingWithData"; // 0xFE (needs userOpData) or 0xE0/0xE1 (data="0x")

/** Classified routing for a detected Core Vault payment. */
export interface DetectedPayment {
  /** XRPL transaction hash (0x-prefixed 32 bytes). */
  transactionId: string;
  /** Sender XRPL r-address. */
  sourceAddress: string;
  /** Amount received by the Core Vault, in drops (XRP smallest unit). */
  receivedAmountDrops: bigint;
  /** First memo MemoData as hex string (0x-prefixed), or "0x" if none. */
  firstMemoData: string;
  /** Destination tag if present, else undefined. */
  destinationTag: number | undefined;
  /** Ledger index. */
  ledgerIndex: number;
  /** Classified routing. */
  mode: ExecuteMode;
  /** Human-readable memo type. */
  memoType:
    | "plain_direct_mint"
    | "memo_field_custom_instruction" // 0xFF
    | "custom_instruction" // 0xFE
    | "skip_memo" // 0xE0
    | "fast_forward_nonce" // 0xE1
    | "replace_executor_fee" // 0xE2
    | "destination_tag" // tag-based minting
    | "smart_account_default" // no memo, no tag
    | "unknown";
}

/** XRPL network endpoints. */
export const XRPL_ENDPOINTS = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
} as const;

export interface XrplMonitorConfig {
  /** Core Vault r-address (from AssetManager.directMintingPaymentAddress()). */
  coreVaultAddress: string;
  /** XRPL websocket endpoint. */
  endpoint: string;
  /** Poll interval for account_tx fallback (ms). */
  pollIntervalMs?: number;
}

/**
 * Classify a memo's first byte to determine the execute mode and memo type.
 * Pure function — no I/O. Exported for unit testing.
 */
export function classifyMemo(
  memoDataHex: string,
  hasDestinationTag: boolean,
): { mode: ExecuteMode; memoType: DetectedPayment["memoType"] } {
  const clean = memoDataHex.startsWith("0x") ? memoDataHex : "0x" + memoDataHex;
  const bytes = ethers.getBytes(clean);

  if (bytes.length === 0) {
    // No memo at all.
    return hasDestinationTag
      ? { mode: "executeDirectMinting", memoType: "destination_tag" }
      : { mode: "executeDirectMinting", memoType: "smart_account_default" };
  }

  const firstByte = bytes[0];

  // Plain direct-minting memos start with an 8-byte prefix, not a single opcode.
  if (bytes.length >= 8) {
    const prefixHex = ethers.hexlify(bytes.slice(0, 8));
    if (prefixHex.toLowerCase() === DIRECT_MINTING_PREFIX.toLowerCase()) {
      return { mode: "executeDirectMinting", memoType: "plain_direct_mint" };
    }
    if (prefixHex.toLowerCase() === DIRECT_MINTING_EX_PREFIX.toLowerCase()) {
      return { mode: "executeDirectMinting", memoType: "plain_direct_mint" };
    }
  }

  // Single-byte opcodes.
  switch (firstByte) {
    case OPCODE.MEMO_FIELD_CUSTOM_INSTRUCTION: // 0xFF
      return { mode: "executeDirectMinting", memoType: "memo_field_custom_instruction" };
    case OPCODE.CUSTOM_INSTRUCTION: // 0xFE
      return { mode: "executeDirectMintingWithData", memoType: "custom_instruction" };
    case OPCODE.SKIP_MEMO: // 0xE0
      return { mode: "executeDirectMintingWithData", memoType: "skip_memo" };
    case OPCODE.FAST_FORWARD_NONCE: // 0xE1
      return { mode: "executeDirectMintingWithData", memoType: "fast_forward_nonce" };
    case OPCODE.REPLACE_EXECUTOR_FEE: // 0xE2
      return { mode: "executeDirectMinting", memoType: "replace_executor_fee" };
    default:
      return { mode: "executeDirectMinting", memoType: "unknown" };
  }
}

/**
 * Extract a DetectedPayment from an XRPL account_tx transaction object.
 * Returns null if the transaction is not a Payment to the Core Vault.
 */
export function parseCoreVaultPayment(
  tx: AccountTxTransaction,
  coreVaultAddress: string,
): DetectedPayment | null {
  const txData = (tx.tx_json ?? tx.tx ?? tx) as any;
  if (txData.TransactionType !== "Payment") return null;

  const destination = txData.Destination;
  if (!destination || destination !== coreVaultAddress) return null;

  const amount = txData.Amount ?? txData.DeliverMax;
  if (typeof amount !== "string") return null; // only handle native XRP (drops string)

  const memos = txData.Memos ?? [];
  const firstMemo = memos[0]?.Memo?.MemoData;
  const firstMemoData = firstMemo ? "0x" + firstMemo : "0x";

  const destinationTag = txData.DestinationTag != null ? Number(txData.DestinationTag) : undefined;
  const hash = txData.hash ?? tx.hash;
  if (!hash || !hash.match(/^[0-9A-Fa-f]{64}$/)) return null;

  const { mode, memoType } = classifyMemo(firstMemoData, destinationTag !== undefined);

  return {
    transactionId: "0x" + hash.toLowerCase(),
    sourceAddress: txData.Account,
    receivedAmountDrops: BigInt(amount),
    firstMemoData,
    destinationTag,
    ledgerIndex: Number(tx.ledger_index ?? 0),
    mode,
    memoType,
  };
}

/**
 * XRPL payment monitor. Connects via websocket and subscribes to the Core Vault
 * account's transaction stream. Emits DetectedPayment events for each incoming
 * Payment.
 *
 * Falls back to account_tx polling if the websocket stream is unavailable.
 */
export class XrplMonitor {
  private client: Client;
  private config: XrplMonitorConfig;
  private running = false;
  private lastLedgerIndex = 0;
  private handler: ((payment: DetectedPayment) => void) | null = null;

  constructor(config: XrplMonitorConfig) {
    this.config = config;
    this.client = new Client(config.endpoint);
  }

  /** Register a callback for each detected Core Vault payment. */
  onPayment(handler: (payment: DetectedPayment) => void): void {
    this.handler = handler;
  }

  /** Start monitoring. Connects to XRPL and subscribes to the Core Vault account. */
  async start(): Promise<void> {
    if (this.running) return;
    await this.client.connect();
    this.running = true;
    console.log(`[xrpl-monitor] connected to ${this.config.endpoint}`);
    console.log(`[xrpl-monitor] watching Core Vault: ${this.config.coreVaultAddress}`);

    // Subscribe to transactions for the Core Vault account.
    await this.client.request({
      command: "subscribe",
      accounts: [this.config.coreVaultAddress],
      streams: ["transactions"],
    });

    this.client.on("transaction", (tx) => {
      const detected = parseCoreVaultPayment(tx as unknown as AccountTxTransaction, this.config.coreVaultAddress);
      if (detected && this.handler) {
        const ledger = detected.ledgerIndex;
        if (ledger > this.lastLedgerIndex) this.lastLedgerIndex = ledger;
        console.log(`[xrpl-monitor] detected payment: ${detected.transactionId.slice(0, 18)}… (${detected.memoType}, ${detected.receivedAmountDrops} drops)`);
        this.handler(detected);
      }
    });
  }

  /**
   * Poll account_tx for the Core Vault since a given ledger index.
   * Useful as a fallback or for backfilling missed payments.
   */
  async pollSince(ledgerIndex: number): Promise<DetectedPayment[]> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }
    const resp = await this.client.request({
      command: "account_tx",
      account: this.config.coreVaultAddress,
      ledger_index_min: ledgerIndex,
      binary: false,
      forward: true,
    });
    const txs = (resp.result as any).transactions ?? [];
    const detected: DetectedPayment[] = [];
    for (const tx of txs) {
      const d = parseCoreVaultPayment(tx as AccountTxTransaction, this.config.coreVaultAddress);
      if (d) detected.push(d);
    }
    return detected;
  }

  /** Get the last seen ledger index. */
  getLastLedgerIndex(): number {
    return this.lastLedgerIndex;
  }

  /** Stop monitoring and disconnect. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.client.disconnect();
    console.log("[xrpl-monitor] disconnected");
  }
}

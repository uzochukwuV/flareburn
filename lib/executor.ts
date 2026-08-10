/**
 * Executor service — the relayer that finalizes FXRP direct mints on Flare.
 *
 * For each XRPL Payment detected targeting the Core Vault:
 *   1. Wait for XRPL finality (3 confirmations, ~12s — handled by FDC)
 *   2. Prepare an XRPPayment attestation request via the FDC verifier API
 *   3. Submit the request to FdcHub on Flare (pay the attestation fee)
 *   4. Wait for the voting round to finalize (~90-180s)
 *   5. Fetch the Merkle proof from the DA Layer
 *   6. Call executeDirectMinting(proof) or executeDirectMintingWithData(proof, data)
 *   7. If DirectMintingDelayed, retry after executionAllowedAt
 *
 * Safety:
 *   - DRY_RUN=true (default): simulates the full flow without broadcasting the
 *     executeDirectMinting transaction. The FDC attestation request is still
 *     submitted on-chain (it's a real on-chain request that costs FLR), but the
 *     final execute step is skipped. Set DRY_RUN=false to broadcast.
 *   - Private keys are read from EXECUTOR_PRIVATE_KEY env var; never logged.
 *   - A persistent journal (JSON file) tracks processed transaction IDs to avoid
 *     duplicate execution across restarts.
 *
 * Sources:
 *   https://dev.flare.network/fassets/developer-guides/fassets-mint (direct minting flow)
 *   https://dev.flare.network/fdc/overview (FDC lifecycle)
 *   https://dev.flare.network/smart-accounts/custom-instruction (0xFE executor behavior)
 *   IAssetManager.sol (executeDirectMinting, executeDirectMintingWithData, directMintingDelayState)
 */

import { ethers } from "ethers";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type NetworkName,
  NETWORKS,
  FLARE_CONTRACTS_REGISTRY_ADDRESS,
} from "./flare-client.js";
import {
  type FdcConfig,
  prepareXrpPaymentRequest,
  submitAttestationRequest,
  calculateAttestationFee,
  waitForFinalization,
  fetchProof,
  proofToTuple,
} from "./fdc-client.js";
import {
  type DetectedPayment,
  XrplMonitor,
  XRPL_ENDPOINTS,
  parseCoreVaultPayment,
  classifyMemo,
} from "./xrpl-monitor.js";
import { OPCODE, decodeMemoCustomInstruction } from "./memo-builder.js";

/** Minimal ABI for the AssetManager execute entry points. */
const EXECUTOR_ASSET_MANAGER_ABI = [
  {
    type: "function",
    name: "executeDirectMinting",
    stateMutability: "payable",
    inputs: [
      {
        name: "_payment",
        type: "tuple",
        components: [
          { name: "merkleProof", type: "bytes32[]" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "attestationType", type: "bytes32" },
              { name: "sourceId", type: "bytes32" },
              { name: "votingRound", type: "uint64" },
              { name: "lowestUsedTimestamp", type: "uint64" },
              {
                name: "requestBody",
                type: "tuple",
                components: [
                  { name: "transactionId", type: "bytes32" },
                  { name: "proofOwner", type: "address" },
                ],
              },
              {
                name: "responseBody",
                type: "tuple",
                components: [
                  { name: "blockNumber", type: "uint64" },
                  { name: "blockTimestamp", type: "uint64" },
                  { name: "sourceAddress", type: "string" },
                  { name: "sourceAddressHash", type: "bytes32" },
                  { name: "receivingAddressHash", type: "bytes32" },
                  { name: "intendedReceivingAddressHash", type: "bytes32" },
                  { name: "spentAmount", type: "int256" },
                  { name: "intendedSpentAmount", type: "int256" },
                  { name: "receivedAmount", type: "int256" },
                  { name: "intendedReceivedAmount", type: "int256" },
                  { name: "hasMemoData", type: "bool" },
                  { name: "firstMemoData", type: "bytes" },
                  { name: "hasDestinationTag", type: "bool" },
                  { name: "destinationTag", type: "uint256" },
                  { name: "status", type: "uint8" },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeDirectMintingWithData",
    stateMutability: "payable",
    inputs: [
      {
        name: "_payment",
        type: "tuple",
        components: [
          { name: "merkleProof", type: "bytes32[]" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "attestationType", type: "bytes32" },
              { name: "sourceId", type: "bytes32" },
              { name: "votingRound", type: "uint64" },
              { name: "lowestUsedTimestamp", type: "uint64" },
              {
                name: "requestBody",
                type: "tuple",
                components: [
                  { name: "transactionId", type: "bytes32" },
                  { name: "proofOwner", type: "address" },
                ],
              },
              {
                name: "responseBody",
                type: "tuple",
                components: [
                  { name: "blockNumber", type: "uint64" },
                  { name: "blockTimestamp", type: "uint64" },
                  { name: "sourceAddress", type: "string" },
                  { name: "sourceAddressHash", type: "bytes32" },
                  { name: "receivingAddressHash", type: "bytes32" },
                  { name: "intendedReceivingAddressHash", type: "bytes32" },
                  { name: "spentAmount", type: "int256" },
                  { name: "intendedSpentAmount", type: "int256" },
                  { name: "receivedAmount", type: "int256" },
                  { name: "intendedReceivedAmount", type: "int256" },
                  { name: "hasMemoData", type: "bool" },
                  { name: "firstMemoData", type: "bytes" },
                  { name: "hasDestinationTag", type: "bool" },
                  { name: "destinationTag", type: "uint256" },
                  { name: "status", type: "uint8" },
                ],
              },
            ],
          },
        ],
      },
      { name: "_data", type: "bytes" },
    ],
    outputs: [],
  },
  "function directMintingDelayState(bytes32 _transactionId) view returns (uint8 _delayState, uint256 _allowedAt, uint256 _startedAt)",
  "function directMintingPaymentAddress() view returns (string)",
] as const;

const REGISTRY_ABI = [
  "function getContractAddressByName(string) view returns (address)",
] as const;

/** Delay state enum values from IDirectMinting. */
export enum DirectMintingDelayState {
  NotDelayed = 0,
  Delayed = 1,
  Executed = 2,
}

/** Journal entry tracking the state of a processed XRPL payment. */
export interface JournalEntry {
  transactionId: string;
  detectedAt: string;
  sourceAddress: string;
  receivedAmountDrops: string;
  memoType: string;
  mode: string;
  status: "detected" | "attestation_requested" | "proof_fetched" | "executed" | "delayed" | "failed";
  votingRoundId?: string;
  proofTxHash?: string;
  executeTxHash?: string;
  executeAllowedAt?: string;
  error?: string;
}

export interface ExecutorConfig {
  network: NetworkName;
  flareRpcUrl: string;
  xrplEndpoint: string;
  coreVaultAddress: string;
  /** Executor EVM private key (funds the executeDirectMinting gas + attestation fee). */
  privateKey: string;
  /** If true, skips the final executeDirectMinting broadcast (FDC request still submitted). */
  dryRun: boolean;
  /** Path to the JSON journal file for crash recovery. */
  journalPath: string;
  /** FDC verifier API key. */
  verifierApiKey?: string;
  /** Address that will own the proof (defaults to executor address). */
  proofOwner?: string;
}

/**
 * The executor service. Orchestrates the full mint-finalization pipeline.
 */
export class Executor {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private registry: ethers.Contract;
  private monitor: XrplMonitor;
  private config: ExecutorConfig;
  private journal: Map<string, JournalEntry> = new Map();
  private running = false;
  private assetManagerAddress?: string;
  private fdcHubAddress?: string;
  private relayAddress?: string;
  private executorAddress: string;

  constructor(config: ExecutorConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.flareRpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);
    this.registry = new ethers.Contract(
      FLARE_CONTRACTS_REGISTRY_ADDRESS,
      REGISTRY_ABI,
      this.provider,
    );
    this.monitor = new XrplMonitor({
      coreVaultAddress: config.coreVaultAddress,
      endpoint: config.xrplEndpoint,
    });
    this.executorAddress = this.signer.address;
  }

  /** Get the executor's EVM address (for proofOwner, config display). */
  get address(): string {
    return this.executorAddress;
  }

  /** Resolve AssetManager, FdcHub, and Relay addresses from the registry. */
  async resolveContracts(): Promise<{
    assetManager: string;
    fdcHub: string;
    relay: string;
  }> {
    if (this.assetManagerAddress && this.fdcHubAddress && this.relayAddress) {
      return {
        assetManager: this.assetManagerAddress,
        fdcHub: this.fdcHubAddress,
        relay: this.relayAddress,
      };
    }
    const [assetManager, fdcHub, relay] = await Promise.all([
      this.registry.getContractAddressByName("AssetManagerFXRP"),
      this.registry.getContractAddressByName("FdcHub"),
      this.registry.getContractAddressByName("Relay"),
    ]);
    this.assetManagerAddress = assetManager;
    this.fdcHubAddress = fdcHub;
    this.relayAddress = relay;
    return { assetManager, fdcHub, relay };
  }

  /** Load the journal from disk (for crash recovery). */
  async loadJournal(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.journalPath, "utf-8");
      const entries: JournalEntry[] = JSON.parse(data);
      for (const e of entries) {
        this.journal.set(e.transactionId, e);
      }
      console.log(`[executor] loaded ${this.journal.size} journal entries from ${this.config.journalPath}`);
    } catch {
      console.log(`[executor] no existing journal at ${this.config.journalPath}, starting fresh`);
    }
  }

  /** Persist the journal to disk. */
  async saveJournal(): Promise<void> {
    const entries = Array.from(this.journal.values());
    const dir = path.dirname(this.config.journalPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.config.journalPath, JSON.stringify(entries, null, 2));
  }

  /** Check if a transaction has already been processed. */
  isProcessed(transactionId: string): boolean {
    const entry = this.journal.get(transactionId);
    return entry?.status === "executed" || entry?.status === "delayed";
  }

  /**
   * Process a single detected payment through the full FDC → execute pipeline.
   * This is the core method. It is idempotent — calling it twice for the same
   * transactionId is a no-op if the first call succeeded.
   */
  async processPayment(payment: DetectedPayment): Promise<JournalEntry> {
    const entry: JournalEntry = {
      transactionId: payment.transactionId,
      detectedAt: new Date().toISOString(),
      sourceAddress: payment.sourceAddress,
      receivedAmountDrops: payment.receivedAmountDrops.toString(),
      memoType: payment.memoType,
      mode: payment.mode,
      status: "detected",
    };

    if (this.isProcessed(payment.transactionId)) {
      const existing = this.journal.get(payment.transactionId)!;
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… already ${existing.status}, skipping`);
      return existing;
    }

    this.journal.set(payment.transactionId, entry);
    await this.saveJournal();

    try {
      const contracts = await this.resolveContracts();
      const fdcConfig: FdcConfig = {
        network: this.config.network,
        verifierApiKey: this.config.verifierApiKey,
      };
      const proofOwner = this.config.proofOwner ?? this.executorAddress;

      // Step 1: Prepare attestation request via verifier.
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… preparing FDC request (${payment.memoType})`);
      const abiEncodedRequest = await prepareXrpPaymentRequest(
        fdcConfig,
        payment.transactionId,
        proofOwner,
      );

      // Step 2: Calculate fee + submit attestation request to FdcHub.
      // Parse attestationType (bytes32) and sourceId (bytes32) from the encoded
      // request — the verifier returns the correctly-encoded values.
      const reqBytes = ethers.getBytes(abiEncodedRequest);
      const attTypeFromReq = ethers.hexlify(reqBytes.slice(0, 32));
      const sourceIdFromReq = ethers.hexlify(reqBytes.slice(32, 64));
      const fee = await calculateAttestationFee(
        this.provider,
        contracts.fdcHub,
        attTypeFromReq,
        sourceIdFromReq,
      );
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… attestation fee: ${ethers.formatEther(fee)} FLR`);

      const { votingRoundId, txHash } = await submitAttestationRequest(
        this.provider,
        this.signer,
        contracts.fdcHub,
        abiEncodedRequest,
        fee,
      );
      entry.votingRoundId = votingRoundId.toString();
      entry.proofTxHash = txHash;
      entry.status = "attestation_requested";
      await this.saveJournal();
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… attestation submitted, round ${votingRoundId}`);

      // Step 3: Wait for finalization.
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… waiting for round ${votingRoundId} finalization`);
      await waitForFinalization(this.provider, contracts.relay, votingRoundId);

      // Step 4: Fetch proof from DA Layer.
      const proof = await fetchProof(fdcConfig, votingRoundId, abiEncodedRequest);
      entry.status = "proof_fetched";
      await this.saveJournal();
      console.log(`[executor] ${payment.transactionId.slice(0, 18)}… proof fetched (memo: ${proof.data.responseBody.hasMemoData ? "yes" : "no"}, tag: ${proof.data.responseBody.hasDestinationTag})`);

      // Step 5: Execute the mint on Flare.
      if (this.config.dryRun) {
        console.log(`[executor] ${payment.transactionId.slice(0, 18)}… DRY_RUN — skipping executeDirectMinting broadcast`);
        entry.status = "executed";
        entry.executeTxHash = "dry_run";
        await this.saveJournal();
        return entry;
      }

      const receipt = await this.executeMint(contracts.assetManager, proof, payment);
      entry.executeTxHash = receipt.txHash;
      entry.status = receipt.delayed ? "delayed" : "executed";
      if (receipt.delayed && receipt.allowedAt) {
        entry.executeAllowedAt = receipt.allowedAt.toString();
        console.log(`[executor] ${payment.transactionId.slice(0, 18)}… DELAYED, allowed at ${new Date(Number(receipt.allowedAt) * 1000).toISOString()}`);
      } else {
        console.log(`[executor] ${payment.transactionId.slice(0, 18)}… EXECUTED: ${receipt.txHash}`);
      }
      await this.saveJournal();
      return entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      entry.status = "failed";
      entry.error = msg;
      await this.saveJournal();
      console.error(`[executor] ${payment.transactionId.slice(0, 18)}… FAILED: ${msg}`);
      throw err;
    }
  }

  /**
   * Call executeDirectMinting or executeDirectMintingWithData on the AssetManager.
   * Handles DirectMintingDelayed by waiting and retrying.
   *
   * For 0xFE (custom instruction) memos, the executor must supply the full
   * PackedUserOperation bytes as _data — these are delivered off-chain by the
   * user. This implementation supports 0xFF (inline) and recovery opcodes only;
   * 0xFE requires an off-chain userOp delivery channel (not implemented here).
   */
  private async executeMint(
    assetManagerAddress: string,
    proof: Awaited<ReturnType<typeof fetchProof>>,
    payment: DetectedPayment,
  ): Promise<{ txHash: string; delayed: boolean; allowedAt?: bigint }> {
    const am = new ethers.Contract(assetManagerAddress, EXECUTOR_ASSET_MANAGER_ABI, this.signer);
    const proofTuple = proofToTuple(proof);

    // Determine which entry point + _data to use.
    let tx: ethers.TransactionResponse;
    if (payment.mode === "executeDirectMintingWithData") {
      // For 0xE0/0xE1 recovery opcodes, _data = "0x" (no user operation runs).
      // For 0xFE, _data = full PackedUserOperation (delivered off-chain — not supported here).
      if (payment.memoType === "custom_instruction") {
        throw new Error(
          "0xFE custom instruction requires off-chain userOp delivery — not supported by this executor. " +
            "The user must deliver the PackedUserOperation bytes to the executor out-of-band.",
        );
      }
      tx = await am.executeDirectMintingWithData(proofTuple, "0x");
    } else {
      tx = await am.executeDirectMinting(proofTuple);
    }

    const receipt = await tx.wait();
    if (!receipt) throw new Error("executeDirectMinting tx produced no receipt");

    // Check for DirectMintingDelayed event in logs.
    const delayedEvent = receipt.logs.find(
      (log) => log.topics[0] === ethers.id("DirectMintingDelayed(bytes32,uint256,uint256)"),
    );

    if (delayedEvent) {
      // The mint was delayed, not executed. Wait for executionAllowedAt and retry.
      const allowedAt = await this.getDelayAllowedAt(payment.transactionId);
      if (allowedAt && allowedAt > BigInt(Math.floor(Date.now() / 1000))) {
        const waitSeconds = Number(allowedAt) - Math.floor(Date.now() / 1000);
        console.log(`[executor] waiting ${waitSeconds}s for delay to expire…`);
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      }
      // Retry the same call with the same proof.
      const retryTx = payment.mode === "executeDirectMintingWithData"
        ? await am.executeDirectMintingWithData(proofTuple, "0x")
        : await am.executeDirectMinting(proofTuple);
      const retryReceipt = await retryTx.wait();
      if (!retryReceipt) throw new Error("retry executeDirectMinting tx produced no receipt");
      return { txHash: retryTx.hash, delayed: false };
    }

    return { txHash: tx.hash, delayed: false };
  }

  /** Query directMintingDelayState for a transaction. */
  async getDelayAllowedAt(transactionId: string): Promise<bigint | null> {
    if (!this.assetManagerAddress) return null;
    const am = new ethers.Contract(this.assetManagerAddress, EXECUTOR_ASSET_MANAGER_ABI, this.provider);
    const [, allowedAt] = await am.directMintingDelayState(transactionId) as [bigint, bigint, bigint];
    return allowedAt;
  }

  /** Start the executor: load journal, resolve contracts, start monitoring. */
  async start(): Promise<void> {
    if (this.running) return;
    console.log(`[executor] starting (network=${this.config.network}, dryRun=${this.config.dryRun})`);
    console.log(`[executor] executor address: ${this.executorAddress}`);

    await this.loadJournal();
    const contracts = await this.resolveContracts();
    console.log(`[executor] AssetManager: ${contracts.assetManager}`);
    console.log(`[executor] FdcHub: ${contracts.fdcHub}`);
    console.log(`[executor] Relay: ${contracts.relay}`);

    // Check executor FLR balance.
    const balance = await this.provider.getBalance(this.executorAddress);
    console.log(`[executor] FLR balance: ${ethers.formatEther(balance)}`);
    if (balance === 0n) {
      console.warn(`[executor] ⚠️  executor has 0 FLR — cannot submit attestation requests or execute mints`);
    }

    this.monitor.onPayment((payment) => {
      // Fire-and-forget; errors are logged inside processPayment.
      this.processPayment(payment).catch(() => {});
    });

    await this.monitor.start();
    this.running = true;
    console.log("[executor] monitoring started — waiting for Core Vault payments");
  }

  /** Stop the executor. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.monitor.stop();
    await this.saveJournal();
    console.log("[executor] stopped");
  }

  /** Process a single transaction by hash (manual trigger / backfill). */
  async processTransactionHash(txHash: string): Promise<JournalEntry> {
    // Ensure the monitor client is connected.
    if (!this.monitor["client"].isConnected()) {
      await this.monitor["client"].connect();
    }
    const resp = await this.monitor["client"].request({
      command: "tx",
      transaction: txHash,
      binary: false,
    });
    const detected = parseCoreVaultPayment(
      resp.result as unknown as any,
      this.config.coreVaultAddress,
    );
    if (!detected) {
      throw new Error(`transaction ${txHash} is not a Core Vault payment`);
    }
    return this.processPayment(detected);
  }
}

/**
 * Build an ExecutorConfig from environment variables.
 * Throws if required vars are missing.
 */
export function configFromEnv(): ExecutorConfig {
  const network = (process.env.FLARE_NETWORK ?? "coston2") as NetworkName;
  if (!NETWORKS[network]) {
    throw new Error(`Unknown FLARE_NETWORK: ${network}`);
  }
  const privateKey = process.env.EXECUTOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("EXECUTOR_PRIVATE_KEY env var is required");
  }
  const xrplEndpoint =
    process.env.XRPL_ENDPOINT ??
    (network === "flare" || network === "songbird" ? XRPL_ENDPOINTS.mainnet : XRPL_ENDPOINTS.testnet);
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS ?? "";
  if (!coreVaultAddress) {
    throw new Error(
      "CORE_VAULT_ADDRESS env var is required (run `npm run smoke` to resolve it from AssetManager.directMintingPaymentAddress())",
    );
  }
  const dryRun = process.env.DRY_RUN !== "false";
  const journalPath = process.env.JOURNAL_PATH ?? path.join(process.cwd(), "executor-journal.json");

  return {
    network,
    flareRpcUrl: process.env.FLARE_RPC_URL ?? NETWORKS[network].rpc,
    xrplEndpoint,
    coreVaultAddress,
    privateKey,
    dryRun,
    journalPath,
    verifierApiKey: process.env.VERIFIER_API_KEY,
    proofOwner: process.env.PROOF_OWNER,
  };
}

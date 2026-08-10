/**
 * Flare Data Connector (FDC) client — manages the attestation lifecycle for
 * XRPPayment proofs used by direct minting.
 *
 * Lifecycle:
 *   1. prepareRequest  — POST to verifier API → get abiEncodedRequest (+ MIC)
 *   2. requestAttestation — FdcHub.requestAttestation(data, {value: fee}) on Flare
 *   3. wait for finalization — Relay.isFinalized(200, votingRoundId)
 *   4. fetchProof — POST to DA Layer → get merkleProof + response data
 *   5. assemble Proof struct for executeDirectMinting
 *
 * The XRPPayment attestation (type 0x08) confirms an XRPL Payment transaction,
 * exposing sourceAddress, memoData, destinationTag, receivedAmount, status.
 * Requires 3 XRPL confirmations (~12s). Round finalization ~90-180s.
 *
 * Sources:
 *   https://dev.flare.network/fdc/overview
 *   https://dev.flare.network/fdc/guides/hardhat (XRPPayment attestation type)
 *   IXRPPayment.sol, IFdcHub.sol, IRelay.sol (flare-periphery-contract-artifacts)
 */

import { ethers } from "ethers";

/** FDC protocol ID for Relay.isFinalized (200 = FDC). */
export const FDC_PROTOCOL_ID = 200n;

/** Attestation type ID for XRPPayment (type 0x08, left-padded to bytes32). */
export const ATTESTATION_TYPE_XRP_PAYMENT = ethers.zeroPadValue("0x08", 32);

/** Source IDs for XRPL networks. */
export const XRP_SOURCES = {
  mainnet: "XRP",
  testnet: "testXRP",
} as const;

/** Verifier API endpoints (official Flare-hosted). */
export const VERIFIER_URLS = {
  coston2: "https://coston2.verifier.api.flare.network",
  coston: "https://coston.verifier.api.flare.network",
  flare: "https://flare.verifier.api.flare.network",
  songbird: "https://songbird.verifier.api.flare.network",
} as const;

/** DA Layer API endpoints (official Flare-hosted). */
export const DA_LAYER_URLS = {
  coston2: "https://coston2-da-layer.flare.network",
  coston: "https://coston-da-layer.flare.network",
  flare: "https://flare-da-layer.flare.network",
  songbird: "https://songbird-da-layer.flare.network",
} as const;

/** Default verifier API key (placeholder; rate-limited). Replace for production. */
const DEFAULT_VERIFIER_API_KEY = "00000000-0000-0000-0000-000000000000";

/** Voting epoch duration in seconds (~90s on all Flare networks). */
export const VOTING_EPOCH_SECONDS = 90;

/** Minimal ABIs for FDC contract interactions. */
const FDC_HUB_ABI = [
  "function requestAttestation(bytes _data) payable",
  "function calculateAttestationFee(bytes32 _attestationType, bytes32 _sourceId) view returns (uint256)",
] as const;

const RELAY_ABI = [
  "function isFinalized(uint256 _protocolId, uint256 _votingRoundId) view returns (bool)",
] as const;

const FDC_VERIFICATION_ABI = [
  "function verifyXRPPayment(bytes32[] proof_merkleProof, bytes attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, bytes32 requestBody_transactionId, address requestBody_proofOwner, uint64 responseBody_blockNumber, uint64 responseBody_blockTimestamp, string responseBody_sourceAddress, bytes32 responseBody_sourceAddressHash, bytes32 responseBody_receivingAddressHash, bytes32 responseBody_intendedReceivingAddressHash, int256 responseBody_spentAmount, int256 responseBody_intendedSpentAmount, int256 responseBody_receivedAmount, int256 responseBody_intendedReceivedAmount, bool responseBody_hasMemoData, bytes responseBody_firstMemoData, bool responseBody_hasDestinationTag, uint256 responseBody_destinationTag, uint8 responseBody_status) view returns (bool)",
] as const;

/**
 * The full IXRPPayment.Proof struct, decoded from the DA Layer response.
 * This is passed directly to AssetManager.executeDirectMinting(proof).
 */
export interface XRPPaymentProof {
  merkleProof: string[];
  data: {
    attestationType: string;
    sourceId: string;
    votingRound: number;
    lowestUsedTimestamp: number;
    requestBody: {
      transactionId: string;
      proofOwner: string;
    };
    responseBody: {
      blockNumber: number;
      blockTimestamp: number;
      sourceAddress: string;
      sourceAddressHash: string;
      receivingAddressHash: string;
      intendedReceivingAddressHash: string;
      spentAmount: bigint;
      intendedSpentAmount: bigint;
      receivedAmount: bigint;
      intendedReceivedAmount: bigint;
      hasMemoData: boolean;
      firstMemoData: string;
      hasDestinationTag: boolean;
      destinationTag: bigint;
      status: number;
    };
  };
}

export interface FdcConfig {
  network: keyof typeof VERIFIER_URLS;
  verifierApiKey?: string;
  /** Override the verifier URL (e.g. for a self-hosted verifier). */
  verifierUrl?: string;
  /** Override the DA Layer URL. */
  daLayerUrl?: string;
}

/**
 * Prepare an XRPPayment attestation request via the verifier API.
 * Returns the abiEncodedRequest (includes a message integrity code).
 */
export async function prepareXrpPaymentRequest(
  config: FdcConfig,
  transactionId: string,
  proofOwner: string,
): Promise<string> {
  const baseUrl = config.verifierUrl ?? VERIFIER_URLS[config.network];
  const apiKey = config.verifierApiKey ?? DEFAULT_VERIFIER_API_KEY;

  if (!transactionId.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error(`transactionId must be a 0x-prefixed 32-byte hash, got: ${transactionId}`);
  }
  if (!ethers.isAddress(proofOwner)) {
    throw new Error(`proofOwner must be a valid EVM address: ${proofOwner}`);
  }

  const body = {
    attestationType: "0x08",
    sourceId: config.network === "flare" || config.network === "songbird" ? "XRP" : "testXRP",
    requestBody: {
      transactionId,
      proofOwner,
    },
  };

  const url = `${baseUrl}/verifier/xrp/XRPPayment/prepareRequest`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-apikey": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`verifier prepareRequest failed (${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { data?: { abiEncodedRequest?: string }; abiEncodedRequest?: string };
  const encoded = json.data?.abiEncodedRequest ?? json.abiEncodedRequest;
  if (typeof encoded !== "string" || !encoded.startsWith("0x")) {
    throw new Error(`verifier returned unexpected response: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return encoded;
}

/**
 * Submit an attestation request to FdcHub on-chain.
 * Returns the voting round ID in which the request was submitted.
 *
 * The voting round is derived from the block timestamp of the tx receipt:
 *   roundId = floor((blockTimestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds)
 * On Coston2, firstVotingRoundStartTs = 0 and epoch = 90s, so roundId ≈ blockTimestamp / 90.
 */
export async function submitAttestationRequest(
  provider: ethers.Provider,
  signer: ethers.Signer,
  fdcHubAddress: string,
  abiEncodedRequest: string,
  fee: bigint,
): Promise<{ votingRoundId: bigint; txHash: string; blockTimestamp: number }> {
  const hub = new ethers.Contract(fdcHubAddress, FDC_HUB_ABI, signer);
  const tx = await hub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await tx.wait();
  if (!receipt) throw new Error("requestAttestation tx produced no receipt");

  const blockTimestamp = (await provider.getBlock(receipt.blockNumber))?.timestamp ?? 0;
  if (blockTimestamp === 0) throw new Error(`could not read block ${receipt.blockNumber} timestamp`);

  // On Coston2/Flare, firstVotingRoundStartTs = 0, epoch = 90s.
  const votingRoundId = BigInt(blockTimestamp) / BigInt(VOTING_EPOCH_SECONDS);

  return { votingRoundId, txHash: tx.hash, blockTimestamp };
}

/**
 * Calculate the attestation fee for a given attestation type + source.
 */
export async function calculateAttestationFee(
  provider: ethers.Provider,
  fdcHubAddress: string,
  attestationType: string,
  sourceId: string,
): Promise<bigint> {
  const hub = new ethers.Contract(fdcHubAddress, FDC_HUB_ABI, provider);
  return (await hub.calculateAttestationFee(attestationType, sourceId)) as bigint;
}

/**
 * Poll Relay.isFinalized until the voting round is finalized.
 * FDC protocol ID = 200.
 */
export async function waitForFinalization(
  provider: ethers.Provider,
  relayAddress: string,
  votingRoundId: bigint,
  timeoutMs = 600_000,
  pollIntervalMs = 10_000,
): Promise<boolean> {
  const relay = new ethers.Contract(relayAddress, RELAY_ABI, provider);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const finalized = (await relay.isFinalized(FDC_PROTOCOL_ID, votingRoundId)) as boolean;
    if (finalized) return true;
    if (Date.now() > deadline) {
      throw new Error(`voting round ${votingRoundId} not finalized within ${timeoutMs / 1000}s`);
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Fetch the attestation proof from the DA Layer after the voting round is finalized.
 * Returns the raw proof JSON (merkleProof + data).
 */
export async function fetchProof(
  config: FdcConfig,
  votingRoundId: bigint,
  abiEncodedRequest: string,
): Promise<XRPPaymentProof> {
  const baseUrl = config.daLayerUrl ?? DA_LAYER_URLS[config.network];
  const apiKey = config.verifierApiKey ?? DEFAULT_VERIFIER_API_KEY;

  const url = `${baseUrl}/api/v1/fdc/proof-by-request-round-raw`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-apikey": apiKey,
    },
    body: JSON.stringify({
      votingRoundId: Number(votingRoundId),
      requestBytes: abiEncodedRequest,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DA Layer proof fetch failed (${resp.status}): ${text}`);
  }

  const json = (await resp.json()) as { data?: any };
  const rawData = json.data ?? json;
  return decodeProofResponse(rawData);
}

/**
 * Decode the DA Layer response into a typed XRPPaymentProof.
 * The response contains merkleProof (hex array) + data (nested response struct).
 */
export function decodeProofResponse(raw: any): XRPPaymentProof {
  const merkleProof: string[] = (raw.merkleProof ?? raw.proof ?? []).map((p: any) =>
    typeof p === "string" ? p : ethers.hexlify(p),
  );

  const d = raw.data ?? raw;
  const rb = d.responseBody ?? d.ResponseBody ?? {};

  return {
    merkleProof,
    data: {
      attestationType: d.attestationType ?? d.AttestationType ?? "0x08",
      sourceId: d.sourceId ?? d.SourceId ?? "0x00",
      votingRound: Number(d.votingRound ?? d.VotingRound ?? 0),
      lowestUsedTimestamp: Number(d.lowestUsedTimestamp ?? d.LowestUsedTimestamp ?? 0),
      requestBody: {
        transactionId: d.requestBody?.transactionId ?? d.requestBody?.TransactionId ?? "0x00",
        proofOwner: d.requestBody?.proofOwner ?? d.requestBody?.ProofOwner ?? ethers.ZeroAddress,
      },
      responseBody: {
        blockNumber: Number(rb.blockNumber ?? rb.BlockNumber ?? 0),
        blockTimestamp: Number(rb.blockTimestamp ?? rb.BlockTimestamp ?? 0),
        sourceAddress: rb.sourceAddress ?? rb.SourceAddress ?? "",
        sourceAddressHash: rb.sourceAddressHash ?? rb.SourceAddressHash ?? ethers.ZeroHash,
        receivingAddressHash: rb.receivingAddressHash ?? rb.ReceivingAddressHash ?? ethers.ZeroHash,
        intendedReceivingAddressHash: rb.intendedReceivingAddressHash ?? rb.IntendedReceivingAddressHash ?? ethers.ZeroHash,
        spentAmount: BigInt(rb.spentAmount ?? rb.SpentAmount ?? 0),
        intendedSpentAmount: BigInt(rb.intendedSpentAmount ?? rb.IntendedSpentAmount ?? 0),
        receivedAmount: BigInt(rb.receivedAmount ?? rb.ReceivedAmount ?? 0),
        intendedReceivedAmount: BigInt(rb.intendedReceivedAmount ?? rb.IntendedReceivedAmount ?? 0),
        hasMemoData: Boolean(rb.hasMemoData ?? rb.HasMemoData ?? false),
        firstMemoData: rb.firstMemoData ?? rb.FirstMemoData ?? "0x",
        hasDestinationTag: Boolean(rb.hasDestinationTag ?? rb.HasDestinationTag ?? false),
        destinationTag: BigInt(rb.destinationTag ?? rb.DestinationTag ?? 0),
        status: Number(rb.status ?? rb.Status ?? 0),
      },
    },
  };
}

/**
 * Convert an XRPPaymentProof into the ethers tuple format expected by
 * AssetManager.executeDirectMinting(proof).
 */
export function proofToTuple(proof: XRPPaymentProof) {
  return {
    merkleProof: proof.merkleProof,
    data: {
      attestationType: proof.data.attestationType,
      sourceId: proof.data.sourceId,
      votingRound: proof.data.votingRound,
      lowestUsedTimestamp: proof.data.lowestUsedTimestamp,
      requestBody: {
        transactionId: proof.data.requestBody.transactionId,
        proofOwner: proof.data.requestBody.proofOwner,
      },
      responseBody: {
        blockNumber: proof.data.responseBody.blockNumber,
        blockTimestamp: proof.data.responseBody.blockTimestamp,
        sourceAddress: proof.data.responseBody.sourceAddress,
        sourceAddressHash: proof.data.responseBody.sourceAddressHash,
        receivingAddressHash: proof.data.responseBody.receivingAddressHash,
        intendedReceivingAddressHash: proof.data.responseBody.intendedReceivingAddressHash,
        spentAmount: proof.data.responseBody.spentAmount,
        intendedSpentAmount: proof.data.responseBody.intendedSpentAmount,
        receivedAmount: proof.data.responseBody.receivedAmount,
        intendedReceivedAmount: proof.data.responseBody.intendedReceivedAmount,
        hasMemoData: proof.data.responseBody.hasMemoData,
        firstMemoData: proof.data.responseBody.firstMemoData,
        hasDestinationTag: proof.data.responseBody.hasDestinationTag,
        destinationTag: proof.data.responseBody.destinationTag,
        status: proof.data.responseBody.status,
      },
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Proof-of-reserves — verifies that FXRP supply is fully backed by XRP locked
 * in the FAssets Core Vault.
 *
 * The proof compares two independent data sources:
 *
 *   1. **FXRP total supply** (EVM, on-chain): The canonical FXRP ERC-20
 *      totalSupply on Flare. Every FXRP token was minted by locking XRP, so
 *      this equals the total XRP backing obligation.
 *
 *   2. **XRPL Core Vault balance** (XRPL, cross-chain): The actual XRP held
 *      by the Core Vault r-address on the XRPL. This is the physical reserve.
 *
 * If the system is healthy, these should be ~1:1 (the vault balance ≥ FXRP
 * supply, modulo fees and timing). A deficit would indicate under-collateralization.
 *
 * Additionally, this module reports the **omnichain supply distribution** —
 * how FXRP is split across Flare and all LayerZero-connected OFT chains — to
 * verify that bridged supplies reconcile with the canonical Flare supply.
 *
 * Data sources:
 *   - Flare RPC: FXRP ERC-20 totalSupply, OFT adapter locked balance
 *   - XRPL API: Core Vault account_info (actual XRP balance in drops)
 *   - Cross-chain RPCs: per-chain OFT totalSupply (reconciliation)
 *
 * Future enhancement: Use FDC `ConfirmedBlockHeightExists` + `XRPPayment`
 * attestations to cryptographically prove the XRPL balance rather than
 * trusting the XRPL API response directly. The FDC client infrastructure
 * exists in fdc-client.ts.
 */

import { ethers } from "ethers";
import { Client } from "xrpl";
import {
  type ChainConfig,
  FXRP_DECIMALS,
  getChains,
} from "./chains.js";
import { FlareClient, NETWORKS, type NetworkName } from "./flare-client.js";

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
] as const;

const OFT_ADAPTER_ABI = [
  "function token() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
] as const;

/** XRPL endpoints for account_info queries (xrpl.js uses websocket). */
const XRPL_ENDPOINTS = {
  mainnet: "wss://xrplcluster.com",
  testnet: "wss://s.altnet.rippletest.net:51233",
} as const;

export interface ChainSupplyInfo {
  chainId: string;
  chainName: string;
  totalSupply: string;
  totalSupplyUba: string;
  isAdapter: boolean;
  isCanonical: boolean;
  error?: string;
}

export interface ReserveData {
  /** FXRP canonical total supply on Flare (the backing obligation), in FXRP. */
  fxrpTotalSupply: string;
  /** Same, in drops (XRP smallest unit = 1e6 FXRP). */
  fxrpTotalSupplyDrops: string;
  /** Actual XRP held by the Core Vault on XRPL, in drops. */
  coreVaultXrpBalanceDrops: string;
  /** Core Vault XRP balance in human-readable XRP. */
  coreVaultXrpBalance: string;
  /** Core Vault r-address. */
  coreVaultAddress: string;
  /** Backing ratio: coreVaultBalance / fxrpSupply (1.0 = fully backed, >1 = overcollateralized). */
  backingRatio: string;
  /** Status: "healthy" (ratio ≥ 1.0), "warning" (0.95–1.0), "critical" (< 0.95). */
  status: "healthy" | "warning" | "critical" | "unknown";
  /** Per-chain supply distribution (omnichain reconciliation). */
  chainSupplies: ChainSupplyInfo[];
  /** Sum of all non-Flare chain supplies (bridged FXRP), in FXRP. */
  bridgedTotal: string;
  /** Flare circulating supply (canonical minus locked in OFT adapter), in FXRP. */
  flareCirculating: string;
  /** Timestamp of the check. */
  timestamp: string;
  /** Network. */
  network: string;
}

/**
 * Query the XRPL Core Vault account balance via the XRPL HTTP API.
 * Returns the balance in drops (1 XRP = 1,000,000 drops).
 */
export async function fetchCoreVaultBalance(
  coreVaultAddress: string,
  network: NetworkName,
): Promise<{ balanceDrops: bigint; balanceXrp: string }> {
  const endpoint = network === "flare" || network === "songbird"
    ? XRPL_ENDPOINTS.mainnet
    : XRPL_ENDPOINTS.testnet;

  const client = new Client(endpoint);
  try {
    await client.connect();
    const resp = await client.request({
      command: "account_info",
      account: coreVaultAddress,
      ledger_index: "validated",
    });
    const balance = (resp.result as any).account_data.Balance as string;
    const balanceDrops = BigInt(balance);
    const balanceXrp = (Number(balanceDrops) / 1_000_000).toFixed(6);
    return { balanceDrops, balanceXrp };
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Fetch the totalSupply of an OFT token on a given chain.
 */
async function fetchChainSupply(
  chain: ChainConfig,
): Promise<ChainSupplyInfo> {
  const base: ChainSupplyInfo = {
    chainId: chain.id,
    chainName: chain.name,
    totalSupply: "0",
    totalSupplyUba: "0",
    isAdapter: chain.isAdapter,
    isCanonical: false,
  };

  if (!chain.available) {
    return { ...base, error: "RPC not available" };
  }

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpc, {
      chainId: chain.chainId,
      name: chain.id,
    }, { batchStallTime: 50 });

    let tokenAddress = chain.oftAddress;
    if (chain.isAdapter) {
      const adapter = new ethers.Contract(chain.oftAddress, OFT_ADAPTER_ABI, provider);
      try {
        tokenAddress = (await adapter.token()) as string;
      } catch {
        // fall back to adapter address
      }
    }
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const totalSupply = (await token.totalSupply()) as bigint;
    return {
      ...base,
      totalSupply: ethers.formatUnits(totalSupply, FXRP_DECIMALS),
      totalSupplyUba: totalSupply.toString(),
      isCanonical: chain.isAdapter, // Flare (adapter) holds the canonical FXRP
    };
  } catch (err) {
    return { ...base, error: (err as Error).message?.slice(0, 120) };
  }
}

/**
 * Compute the full proof-of-reserves: FXRP supply vs Core Vault XRP balance,
 * plus omnichain supply distribution.
 *
 * @param flare FlareClient instance (for resolving contracts + FXRP token)
 * @param useTestnet Whether to query testnet or mainnet chains
 */
export async function computeProofOfReserves(
  flare: FlareClient,
  useTestnet: boolean,
): Promise<ReserveData> {
  // 1. Get Core Vault address + FXRP token address from Flare
  const [settings, tokenInfo] = await Promise.all([
    flare.getDirectMintingSettings(),
    flare.getFxrpToken(),
  ]);
  const coreVaultAddress = settings.paymentAddress;

  // 2. Get canonical FXRP totalSupply on Flare
  const canonicalSupply = await flare.provider.call({
    to: tokenInfo.address,
    data: new ethers.Interface(ERC20_ABI).encodeFunctionData("totalSupply"),
  });
  const fxrpTotalSupplyUba = BigInt(new ethers.Interface(ERC20_ABI)
    .decodeFunctionResult("totalSupply", canonicalSupply)[0].toString());
  const fxrpTotalSupply = ethers.formatUnits(fxrpTotalSupplyUba, FXRP_DECIMALS);

  // 3. Get OFT adapter locked balance (FXRP locked for bridging)
  const chains = getChains(useTestnet);
  const flareChain = chains.find((c) => c.isAdapter);
  let flareLockedUba = 0n;
  if (flareChain) {
    try {
      const adapter = new ethers.Contract(flareChain.oftAddress, OFT_ADAPTER_ABI, flare.provider);
      const locked = (await adapter.balanceOf(tokenInfo.address)) as bigint;
      flareLockedUba = locked;
    } catch {
      // adapter balanceOf may not be available; skip
    }
  }
  const flareCirculatingUba = fxrpTotalSupplyUba - flareLockedUba;
  const flareCirculating = ethers.formatUnits(flareCirculatingUba, FXRP_DECIMALS);

  // 4. Fetch Core Vault XRP balance from XRPL
  let coreVaultXrpBalanceDrops = 0n;
  let coreVaultXrpBalance = "0";
  let status: ReserveData["status"] = "unknown";
  let backingRatio = "0";
  try {
    const vault = await fetchCoreVaultBalance(coreVaultAddress, flare.network);
    coreVaultXrpBalanceDrops = vault.balanceDrops;
    coreVaultXrpBalance = vault.balanceXrp;

    // FXRP drops = totalSupply (already in 6 decimals = drops)
    const ratio = Number(coreVaultXrpBalanceDrops) / Number(fxrpTotalSupplyUba);
    backingRatio = ratio.toFixed(6);
    if (ratio >= 1.0) status = "healthy";
    else if (ratio >= 0.95) status = "warning";
    else status = "critical";
  } catch {
    status = "unknown";
  }

  // 5. Fetch per-chain supply distribution (parallel)
  const chainSupplies = await Promise.all(
    chains.map((c) => fetchChainSupply(c)),
  );

  // 6. Sum bridged supply (non-Flare chains)
  const bridgedTotalUba = chainSupplies
    .filter((c) => !c.isAdapter && !c.error)
    .reduce((sum, c) => sum + BigInt(c.totalSupplyUba), 0n);
  const bridgedTotal = ethers.formatUnits(bridgedTotalUba, FXRP_DECIMALS);

  return {
    fxrpTotalSupply,
    fxrpTotalSupplyDrops: fxrpTotalSupplyUba.toString(),
    coreVaultXrpBalanceDrops: coreVaultXrpBalanceDrops.toString(),
    coreVaultXrpBalance,
    coreVaultAddress,
    backingRatio,
    status,
    chainSupplies,
    bridgedTotal,
    flareCirculating,
    timestamp: new Date().toISOString(),
    network: flare.network,
  };
}

/**
 * Flare chain client — read-only access to the contracts that the gateway needs.
 *
 * Resolves contracts via FlareContractRegistry (same address on all Flare networks),
 * reads AssetManager direct-minting settings, the FXRP token address, lot size, and
 * Smart Accounts (MasterAccountController) state: a user's personal account and nonce.
 *
 * All calls are view-only. No signing, no key handling, no state changes.
 *
 * Sources:
 *   https://dev.flare.network/fassets/reference/IAssetManager
 *   https://dev.flare.network/smart-accounts/overview
 *   https://dev.flare.network/network/guides/flare-contracts-registry
 */

import { ethers } from "ethers";

/** Same on all Flare networks. Verify at the link above. */
export const FLARE_CONTRACTS_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

/** Known Flare networks for convenience. */
export const NETWORKS = {
  flare: { chainId: 14, rpc: "https://flare-api.flare.network/ext/C/rpc" },
  coston2: { chainId: 114, rpc: "https://coston2-api.flare.network/ext/C/rpc" },
  songbird: { chainId: 19, rpc: "https://songbird-api.flare.network/ext/C/rpc" },
  coston: { chainId: 16, rpc: "https://coston-api.flare.network/ext/C/rpc" },
} as const;

export type NetworkName = keyof typeof NETWORKS;

const REGISTRY_ABI = [
  "function getContractAddressByName(string) view returns (address)",
] as const;

const ASSET_MANAGER_ABI = [
  // Direct minting
  "function directMintingPaymentAddress() view returns (string)",
  "function getDirectMintingMinimumFeeUBA() view returns (uint256)",
  "function getDirectMintingFeeBIPS() view returns (uint256)",
  "function getDirectMintingExecutorFeeUBA() view returns (uint256)",
  "function getDirectMintingOthersCanExecuteAfterSeconds() view returns (uint256)",
  "function getDirectMintingHourlyLimitUBA() view returns (uint256)",
  "function getDirectMintingDailyLimitUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingThresholdUBA() view returns (uint256)",
  "function getDirectMintingLargeMintingDelaySeconds() view returns (uint256)",
  "function getDirectMintingFeeReceiver() view returns (address)",
  // Token + settings
  "function fAsset() view returns (address)",
  "function getSettings() view returns (tuple(uint64 lotSizeAMG, uint8 assetDecimals, address agentOwnerRegistry))",
  "function assetMintingGranularityUBA() view returns (uint256)",
  "function minimumRedeemAmountUBA() view returns (uint256)",
  "function getMintingTagManager() view returns (address)",
] as const;

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
] as const;

const MASTER_ACCOUNT_CONTROLLER_ABI = [
  "function getPersonalAccount(string xrplAddress) view returns (address)",
  "function getNonce(address personalAccount) view returns (uint256)",
  "function getExecutor(address personalAccount) view returns (address)",
  "function getXrplProviderWallets() view returns (string[])",
  "function getVaults() view returns (address[])",
] as const;

const FTSO_V2_ABI = [
  "function getFeedByIdInWei(bytes21 _feedId) view returns (uint256 value, uint64 timestamp)",
] as const;

/** XRP/USD FTSO feed ID (category 0x01 + "XRP/USD" padded to 21 bytes). */
export const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000";

/** Contract names registered in FlareContractsRegistry for FXRP. */
const CONTRACT_NAMES = {
  assetManagerFxrp: "AssetManagerFXRP",
  masterAccountController: "MasterAccountController",
} as const;

export interface DirectMintingSettings {
  paymentAddress: string; // Core Vault XRPL r-address
  minimumFeeUba: bigint;
  feeBIPS: bigint;
  executorFeeUba: bigint;
  othersCanExecuteAfterSeconds: bigint;
  hourlyLimitUba: bigint;
  dailyLimitUba: bigint;
  largeMintingThresholdUba: bigint;
  largeMintingDelaySeconds: bigint;
  feeReceiver: string;
}

export interface FassetSettings {
  lotSizeAmg: bigint;
  assetDecimals: number;
  agentOwnerRegistry: string;
  assetMintingGranularityUba: bigint;
  minimumRedeemAmountUba: bigint;
}

export interface FxrpTokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

/** Resolved contract addresses for the configured network. */
export interface ResolvedContracts {
  assetManager: string;
  masterAccountController: string;
  fxrpToken: string;
}

/**
 * Read-only Flare client. Construct once per network and reuse.
 * Throws on RPC or contract errors; callers should catch.
 */
export class FlareClient {
  readonly provider: ethers.JsonRpcProvider;
  private readonly registry: ethers.Contract;
  private cache: Map<string, address> = new Map();

  constructor(
    rpcUrl: string = NETWORKS.coston2.rpc,
    readonly network: NetworkName = "coston2",
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.registry = new ethers.Contract(
      FLARE_CONTRACTS_REGISTRY_ADDRESS,
      REGISTRY_ABI,
      this.provider,
    );
  }

  /** Resolve a contract address by its registry name, with caching. */
  async getContractAddress(name: string): Promise<string> {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const addr = (await this.registry.getContractAddressByName(name)) as string;
    if (!ethers.isAddress(addr)) {
      throw new Error(`registry returned invalid address for ${name}: ${addr}`);
    }
    this.cache.set(name, addr);
    return addr;
  }

  /** Resolve the FXRP AssetManager, MasterAccountController, and FXRP token. */
  async resolveContracts(): Promise<ResolvedContracts> {
    const assetManager = await this.getContractAddress(
      CONTRACT_NAMES.assetManagerFxrp,
    );
    const masterAccountController = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    );
    const am = new ethers.Contract(assetManager, ASSET_MANAGER_ABI, this.provider);
    const fxrpToken = await am.fAsset();
    if (!ethers.isAddress(fxrpToken)) {
      throw new Error(`AssetManager.fAsset() returned invalid address: ${fxrpToken}`);
    }
    return { assetManager, masterAccountController, fxrpToken };
  }

  private assetManagerContract(): Promise<ethers.Contract> {
    return this.getContractAddress(CONTRACT_NAMES.assetManagerFxrp).then(
      (a) => new ethers.Contract(a, ASSET_MANAGER_ABI, this.provider),
    );
  }

  /** Read all direct-minting parameters from the AssetManager. */
  async getDirectMintingSettings(): Promise<DirectMintingSettings> {
    const am = await this.assetManagerContract();
    const [
      paymentAddress,
      minimumFeeUba,
      feeBIPS,
      executorFeeUba,
      othersCanExecuteAfterSeconds,
      hourlyLimitUba,
      dailyLimitUba,
      largeMintingThresholdUba,
      largeMintingDelaySeconds,
      feeReceiver,
    ] = await Promise.all([
      am.directMintingPaymentAddress(),
      am.getDirectMintingMinimumFeeUBA(),
      am.getDirectMintingFeeBIPS(),
      am.getDirectMintingExecutorFeeUBA(),
      am.getDirectMintingOthersCanExecuteAfterSeconds(),
      am.getDirectMintingHourlyLimitUBA(),
      am.getDirectMintingDailyLimitUBA(),
      am.getDirectMintingLargeMintingThresholdUBA(),
      am.getDirectMintingLargeMintingDelaySeconds(),
      am.getDirectMintingFeeReceiver(),
    ]);
    return {
      paymentAddress,
      minimumFeeUba,
      feeBIPS,
      executorFeeUba,
      othersCanExecuteAfterSeconds,
      hourlyLimitUba,
      dailyLimitUba,
      largeMintingThresholdUba,
      largeMintingDelaySeconds,
      feeReceiver,
    };
  }

  /** Read FAsset settings (lot size, decimals, granularity, min redeem). */
  async getFassetSettings(): Promise<FassetSettings> {
    const am = await this.assetManagerContract();
    const [settings, granularity, minRedeem] = await Promise.all([
      am.getSettings(),
      am.assetMintingGranularityUBA(),
      am.minimumRedeemAmountUBA(),
    ]);
    return {
      lotSizeAmg: settings.lotSizeAMG,
      assetDecimals: settings.assetDecimals,
      agentOwnerRegistry: settings.agentOwnerRegistry,
      assetMintingGranularityUba: granularity,
      minimumRedeemAmountUba: minRedeem,
    };
  }

  /** FXRP token address + metadata. */
  async getFxrpToken(): Promise<FxrpTokenInfo> {
    const { fxrpToken } = await this.resolveContracts();
    const erc20 = new ethers.Contract(fxrpToken, ERC20_ABI, this.provider);
    const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
    return { address: fxrpToken, symbol, decimals };
  }

  /**
   * Get the Flare personal account (smart account) address for an XRPL address.
   * The address is deterministic and valid even before the account is deployed.
   */
  async getPersonalAccount(xrplAddress: string): Promise<string> {
    const mac = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    ).then(
      (a) => new ethers.Contract(a, MASTER_ACCOUNT_CONTROLLER_ABI, this.provider),
    );
    const personal = (await mac.getPersonalAccount(xrplAddress)) as string;
    if (!ethers.isAddress(personal)) {
      throw new Error(`getPersonalAccount returned invalid address: ${personal}`);
    }
    return personal;
  }

  /** Get the current memo-instruction nonce for a personal account. */
  async getNonce(personalAccount: string): Promise<bigint> {
    const mac = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    ).then(
      (a) => new ethers.Contract(a, MASTER_ACCOUNT_CONTROLLER_ABI, this.provider),
    );
    return (await mac.getNonce(personalAccount)) as bigint;
  }

  /** Get the pinned executor for a personal account (address(0) = none). */
  async getExecutor(personalAccount: string): Promise<string> {
    const mac = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    ).then(
      (a) => new ethers.Contract(a, MASTER_ACCOUNT_CONTROLLER_ABI, this.provider),
    );
    return (await mac.getExecutor(personalAccount)) as string;
  }

  /** Get the operator XRPL addresses (for proof-based instructions). */
  async getXrplProviderWallets(): Promise<string[]> {
    const mac = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    ).then(
      (a) => new ethers.Contract(a, MASTER_ACCOUNT_CONTROLLER_ABI, this.provider),
    );
    return (await mac.getXrplProviderWallets()) as string[];
  }

  /** FXRP balance held by a Flare address (e.g. a personal account). */
  async getFxrpBalance(flareAddress: string): Promise<bigint> {
    const { fxrpToken } = await this.resolveContracts();
    const erc20 = new ethers.Contract(fxrpToken, ERC20_ABI, this.provider);
    return (await erc20.balanceOf(flareAddress)) as bigint;
  }

  /**
   * Get all registered vault addresses from the MasterAccountController.
   * Returns addresses in registration order: index 0 = Firelight, 1 = Upshift
   * (per Flare docs).
   */
  async getVaults(): Promise<string[]> {
    const mac = await this.getContractAddress(
      CONTRACT_NAMES.masterAccountController,
    ).then(
      (a) => new ethers.Contract(a, MASTER_ACCOUNT_CONTROLLER_ABI, this.provider),
    );
    const vaults = (await mac.getVaults()) as string[];
    return vaults.filter((v) => ethers.isAddress(v) && v !== ethers.ZeroAddress);
  }

  /** Get the FXRP balance held in a specific vault. */
  async getVaultFxrpBalance(vaultAddress: string): Promise<bigint> {
    return this.getFxrpBalance(vaultAddress);
  }

  /**
   * Read the latest XRP/USD price from the Flare Time Series Oracle (FTSO V2).
   * Returns the price scaled to 18 decimals (wei) and the block timestamp.
   * The value can be converted to USD with: price / 1e18.
   */
  async getFtsoPrice(feedId: string = XRP_USD_FEED_ID): Promise<{ value: bigint; timestamp: number; priceUsd: string }> {
    const ftsoV2Address = await this.getContractAddress("FtsoV2");
    const ftso = new ethers.Contract(ftsoV2Address, FTSO_V2_ABI, this.provider);
    const [value, timestamp] = await ftso.getFeedByIdInWei(feedId) as [bigint, bigint];
    const priceUsd = Number(value) / 1e18;
    return { value, timestamp: Number(timestamp), priceUsd: priceUsd.toFixed(6) };
  }

  /**
   * Resolve an XRPL user's full smart-account state in one call:
   * personal account address, nonce, executor, FXRP balance.
   */
  async getSmartAccountState(xrplAddress: string) {
    const personalAccount = await this.getPersonalAccount(xrplAddress);
    const [nonce, executor, fxrpBalance] = await Promise.all([
      this.getNonce(personalAccount),
      this.getExecutor(personalAccount),
      this.getFxrpBalance(personalAccount),
    ]);
    return { xrplAddress, personalAccount, nonce, executor, fxrpBalance };
  }
}

type address = string;

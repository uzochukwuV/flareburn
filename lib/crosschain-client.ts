/**
 * Cross-chain FXRP client.
 *
 * Reads FXRP balances across all OFT-deployed chains in parallel and prepares
 * LayerZero OFT bridge transactions. All operations are read-only or produce
 * unsigned transaction data — never signs or broadcasts.
 */

import { ethers } from "ethers";
import {
  type ChainConfig,
  FXRP_DECIMALS,
  getChains,
} from "./chains.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const OFT_ABI = [
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee))",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundTo) returns ()",
  "function token() view returns (address)",
  "function balanceOf(address) view returns (uint256)",
] as const;

export interface ChainBalance {
  chainId: string;
  chainName: string;
  lzEid: number;
  balance: string;       // human-readable FXRP
  balanceUba: string;    // raw uint
  totalSupply: string;   // human-readable FXRP
  tokenAddress: string;
  explorer: string;
  isAdapter: boolean;
  available: boolean;
  error?: string;
}

export interface Portfolio {
  address: string;
  totalFxrp: string;
  chainCount: number;
  chainsWithBalance: number;
  chains: ChainBalance[];
}

function providerFor(chain: ChainConfig): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(chain.rpc, {
    chainId: chain.chainId,
    name: chain.id,
  }, { batchStallTime: 50 });
}

/** Fetch balance + total supply for a single chain. Never throws. */
export async function getChainBalance(
  chain: ChainConfig,
  address: string,
): Promise<ChainBalance> {
  const base: ChainBalance = {
    chainId: chain.id,
    chainName: chain.name,
    lzEid: chain.lzEid,
    balance: "0",
    balanceUba: "0",
    totalSupply: "0",
    tokenAddress: chain.oftAddress,
    explorer: chain.explorer,
    isAdapter: chain.isAdapter,
    available: chain.available,
  };

  if (!chain.available) {
    return { ...base, error: "RPC not available" };
  }

  try {
    const provider = providerFor(chain);
    // On Flare (adapter), the OFT Adapter wraps the underlying FXRP ERC-20.
    // balanceOf on the adapter delegates to the token, so querying the adapter
    // address directly works. But for consistency, query the adapter's token()
    // if it's an adapter, otherwise query the OFT itself.
    let tokenAddress = chain.oftAddress;
    if (chain.isAdapter) {
      try {
        const adapter = new ethers.Contract(chain.oftAddress, OFT_ABI, provider);
        tokenAddress = (await adapter.token()) as string;
      } catch {
        // If token() fails, fall back to the adapter address itself
        tokenAddress = chain.oftAddress;
      }
    }
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, totalSupply] = await Promise.all([
      token.balanceOf(address),
      token.totalSupply(),
    ]);
    return {
      ...base,
      tokenAddress,
      balance: ethers.formatUnits(balance, FXRP_DECIMALS),
      balanceUba: balance.toString(),
      totalSupply: ethers.formatUnits(totalSupply, FXRP_DECIMALS),
    };
  } catch (err) {
    return { ...base, error: (err as Error).message?.slice(0, 120) };
  }
}

/** Fetch FXRP balances across all chains in parallel. */
export async function getPortfolio(
  address: string,
  useTestnet: boolean,
): Promise<Portfolio> {
  const chains = getChains(useTestnet);
  const results = await Promise.all(
    chains.map((c) => getChainBalance(c, address)),
  );

  const total = results.reduce((sum, r) => {
    if (r.error) return sum;
    return sum + BigInt(r.balanceUba);
  }, 0n);

  const chainsWithBalance = results.filter(
    (r) => !r.error && BigInt(r.balanceUba) > 0n,
  ).length;

  return {
    address,
    totalFxrp: ethers.formatUnits(total, FXRP_DECIMALS),
    chainCount: chains.length,
    chainsWithBalance,
    chains: results,
  };
}

// --- LayerZero OFT bridge preparation ----------------------------------------

export interface BridgeQuote {
  srcChain: ChainConfig;
  dstChain: ChainConfig;
  amount: string;        // human-readable FXRP
  amountUba: string;     // raw
  nativeFee: string;     // gas for LZ messaging (in native token wei)
  lzTokenFee: string;
  dstAddress: string;    // recipient on destination
}

/** Quote a LayerZero OFT bridge from srcChain to dstChain. */
export async function quoteBridge(
  srcChain: ChainConfig,
  dstChain: ChainConfig,
  amountXrp: string,
  recipientAddress: string,
): Promise<BridgeQuote> {
  const provider = providerFor(srcChain);
  const oft = new ethers.Contract(srcChain.oftAddress, OFT_ABI, provider);

  const amountUba = ethers.parseUnits(amountXrp, FXRP_DECIMALS);
  const dstAddressBytes32 = ethers.zeroPadValue(recipientAddress, 32);

  // Executor LZ receive option: 200k gas, 0 lzToken
  // Extra options format: 0x00030100110100000000000000000000000000030d40
  const extraOptions = "0x00030100110100000000000000000000000000030d40";

  const sendParam = {
    dstEid: dstChain.lzEid,
    to: dstAddressBytes32,
    amountLD: amountUba,
    minAmountLD: amountUba,
    extraOptions,
    composeMsg: "0x",
    oftCmd: "0x",
  };

  const quote = await oft.quoteSend(sendParam, false);
  return {
    srcChain,
    dstChain,
    amount: amountXrp,
    amountUba: amountUba.toString(),
    nativeFee: quote.nativeFee.toString(),
    lzTokenFee: quote.lzTokenFee.toString(),
    dstAddress: recipientAddress,
  };
}

export interface BridgeCallData {
  approve: { to: string; data: string; value: string };
  send: { to: string; data: string; value: string };
  quote: BridgeQuote;
}

/**
 * Build the unsigned calldata for an OFT bridge: approve + send.
 *
 * On Flare, this can be bundled into a Smart Account PackedUserOperation
 * (via the gateway's 0xFF memo). On other chains, the user signs directly.
 */
export async function buildBridgeCallsData(
  srcChain: ChainConfig,
  dstChain: ChainConfig,
  amountXrp: string,
  recipientAddress: string,
): Promise<BridgeCallData> {
  const quote = await quoteBridge(srcChain, dstChain, amountXrp, recipientAddress);
  const provider = providerFor(srcChain);
  const oft = new ethers.Contract(srcChain.oftAddress, OFT_ABI, provider);

  // For adapter, approve the adapter address; for native OFT, no approve needed
  // (the OFT is the token itself). But calling approve on the OFT is harmless.
  const tokenAddress = srcChain.isAdapter
    ? (await (new ethers.Contract(srcChain.oftAddress, ["function token() view returns (address)"], provider)).token())
    : srcChain.oftAddress;

  const tokenIface = new ethers.Interface(ERC20_ABI);
  const approveData = tokenIface.encodeFunctionData("approve", [
    srcChain.oftAddress,
    quote.amountUba,
  ]);

  const dstAddressBytes32 = ethers.zeroPadValue(recipientAddress, 32);
  const extraOptions = "0x00030100110100000000000000000000000000030d40";
  const sendParam = {
    dstEid: dstChain.lzEid,
    to: dstAddressBytes32,
    amountLD: BigInt(quote.amountUba),
    minAmountLD: BigInt(quote.amountUba),
    extraOptions,
    composeMsg: "0x",
    oftCmd: "0x",
  };
  const feeStruct = { nativeFee: BigInt(quote.nativeFee), lzTokenFee: BigInt(quote.lzTokenFee) };
  const sendData = oft.interface.encodeFunctionData("send", [
    sendParam,
    feeStruct,
    recipientAddress, // refund to sender
  ]);

  return {
    approve: { to: tokenAddress, data: approveData, value: "0" },
    send: { to: srcChain.oftAddress, data: sendData, value: quote.nativeFee },
    quote,
  };
}

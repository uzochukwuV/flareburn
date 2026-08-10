/**
 * Action builders — construct the Call[] batch that a personal account will
 * execute via executeUserOp after FXRP is minted into it.
 *
 * Each action returns one or more Call structs (target/value/data). These are
 * assembled into a single PackedUserOperation so mint + action is atomic:
 * if the action reverts, the entire executeDirectMintingWithData reverts and
 * no FXRP is minted.
 *
 * These helpers only encode calldata. They do not sign or broadcast anything.
 *
 * Sources:
 *   https://dev.flare.network/smart-accounts/custom-instruction (Call struct, executeUserOp)
 *   https://dev.flare.network/fassets/reference/IAssetManager (redeem/redeemAmount/redeemWithTag)
 */

import { ethers } from "ethers";
import type { Call } from "./memo-builder.js";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

const ASSET_MANAGER_ABI = [
  "function redeem(uint256 lots, string redeemerUnderlyingAddressString, address executor) returns (uint256)",
  "function redeemAmount(uint256 amountUBA, string redeemerUnderlyingAddressString, address executor) returns (uint256)",
  "function redeemWithTag(uint256 amountUBA, string redeemerUnderlyingAddressString, address executor, uint32 destinationTag) returns (uint256)",
] as const;

/** A vault (Firelight/Upshift) exposing a simple deposit(amount) interface. */
const VAULT_ABI = [
  "function deposit(uint256 amount) returns (uint256)",
] as const;

/** Encode an ERC-20 transfer call from the personal account. */
export function buildTransferCall(
  tokenAddress: string,
  to: string,
  amount: bigint,
): Call {
  if (!ethers.isAddress(tokenAddress)) throw new Error(`invalid token address: ${tokenAddress}`);
  if (!ethers.isAddress(to)) throw new Error(`invalid recipient: ${to}`);
  const iface = new ethers.Interface(ERC20_ABI as any);
  const data = iface.encodeFunctionData("transfer", [to, amount]);
  return { target: tokenAddress, value: 0n, data };
}

/** Encode an ERC-20 approve call (needed before depositing into a vault). */
export function buildApproveCall(
  tokenAddress: string,
  spender: string,
  amount: bigint,
): Call {
  if (!ethers.isAddress(tokenAddress)) throw new Error(`invalid token address: ${tokenAddress}`);
  if (!ethers.isAddress(spender)) throw new Error(`invalid spender: ${spender}`);
  const iface = new ethers.Interface(ERC20_ABI as any);
  const data = iface.encodeFunctionData("approve", [spender, amount]);
  return { target: tokenAddress, value: 0n, data };
}

/**
 * Encode a redeem(amount) call — burn FXRP for underlying XRP.
 * The agent pays XRP to the redeemer's XRPL address within the payment window.
 */
export function buildRedeemAmountCall(
  assetManager: string,
  amountUba: bigint,
  redeemerXrplAddress: string,
  executor = ethers.ZeroAddress,
): Call {
  if (!ethers.isAddress(assetManager)) throw new Error(`invalid assetManager: ${assetManager}`);
  if (!redeemerXrplAddress || !redeemerXrplAddress.startsWith("r")) {
    throw new Error(`invalid XRPL address: ${redeemerXrplAddress}`);
  }
  const iface = new ethers.Interface(ASSET_MANAGER_ABI as any);
  const data = iface.encodeFunctionData("redeemAmount", [
    amountUba,
    redeemerXrplAddress,
    executor,
  ]);
  return { target: assetManager, value: 0n, data };
}

/**
 * Encode a redeemWithTag(amount) call — burn FXRP for XRP sent to an XRPL
 * address that requires a destination tag (e.g. an exchange deposit address).
 * XRP only.
 */
export function buildRedeemWithTagCall(
  assetManager: string,
  amountUba: bigint,
  redeemerXrplAddress: string,
  destinationTag: number,
  executor = ethers.ZeroAddress,
): Call {
  if (!ethers.isAddress(assetManager)) throw new Error(`invalid assetManager: ${assetManager}`);
  if (!redeemerXrplAddress || !redeemerXrplAddress.startsWith("r")) {
    throw new Error(`invalid XRPL address: ${redeemerXrplAddress}`);
  }
  if (!Number.isInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff) {
    throw new Error(`destinationTag must be a uint32, got ${destinationTag}`);
  }
  const iface = new ethers.Interface(ASSET_MANAGER_ABI as any);
  const data = iface.encodeFunctionData("redeemWithTag", [
    amountUba,
    redeemerXrplAddress,
    executor,
    destinationTag,
  ]);
  return { target: assetManager, value: 0n, data };
}

/**
 * Encode an approve + deposit call batch for a vault (Firelight/Upshift).
 * Approving the exact deposit amount (not unlimited) is safer.
 */
export function buildVaultDepositCalls(
  tokenAddress: string,
  vaultAddress: string,
  amount: bigint,
): Call[] {
  if (!ethers.isAddress(vaultAddress)) throw new Error(`invalid vault address: ${vaultAddress}`);
  const approve = buildApproveCall(tokenAddress, vaultAddress, amount);
  const iface = new ethers.Interface(VAULT_ABI as any);
  const depositData = iface.encodeFunctionData("deposit", [amount]);
  const deposit: Call = { target: vaultAddress, value: 0n, data: depositData };
  return [approve, deposit];
}

/**
 * Build the approve + OFT.send Call[] batch for bridging FXRP from Flare to
 * another LayerZero-connected chain, suitable for inclusion in a 0xFF smart
 * account user operation.
 *
 * The `approveCall` and `sendCall` raw data are produced by the cross-chain
 * client (which calls `quoteSend` for the live LayerZero fee). This helper
 * just converts them to the Call struct format with the native LZ fee as
 * `value` on the send call.
 */
export function buildBridgeCalls(
  approveTarget: string,
  approveData: string,
  oftAddress: string,
  sendData: string,
  nativeLzFeeWei: bigint,
): Call[] {
  if (!ethers.isAddress(approveTarget)) throw new Error(`invalid approve target: ${approveTarget}`);
  if (!ethers.isAddress(oftAddress)) throw new Error(`invalid OFT address: ${oftAddress}`);
  if (!approveData.startsWith("0x")) throw new Error("approve data must be hex");
  if (!sendData.startsWith("0x")) throw new Error("send data must be hex");
  return [
    { target: approveTarget, value: 0n, data: approveData },
    { target: oftAddress, value: nativeLzFeeWei, data: sendData },
  ];
}

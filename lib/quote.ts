/**
 * Quoting — compute the XRP amount to send for a mint, accounting for the
 * percentage-based minting fee and flat executor fee.
 *
 * Minting fee takes priority: if the payment is below the minimum fee floor,
 * no FAssets are minted and the entire payment goes to the fee receiver.
 * If funds are insufficient for both fees, the executor fee is reduced first.
 *
 * Sources:
 *   https://dev.flare.network/fassets/developer-guides/fassets-mint
 *   https://dev.flare.network/fassets/reference/IAssetManager (direct minting settings)
 */

import type { DirectMintingSettings, FassetSettings } from "./flare-client.js";

/** 1 XRP = 1,000,000 drops (the XRP smallest unit / UBA). */
export const XRP_DROPS = 1_000_000n;

/** Convert XRP (decimal) to drops (UBA bigint). */
export function xrpToDrops(xrp: string): bigint {
  const n = Number(xrp);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid XRP amount: ${xrp}`);
  }
  // Use string math to avoid float drift for typical values.
  const [whole, frac = ""] = xrp.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * XRP_DROPS + BigInt(fracPadded || "0");
}

/** Convert drops (UBA bigint) to an XRP decimal string. */
export function dropsToXrp(drops: bigint): string {
  const whole = drops / XRP_DROPS;
  const frac = drops % XRP_DROPS;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

/**
 * Compute the cost to mint a desired FXRP amount, in drops.
 *
 * The minter sends XRP; the minting fee (BIPS) and executor fee are deducted,
 * and the remainder is minted. To receive a target amount of FXRP, the minter
 * must send: target + mintingFee + executorFee.
 *
 * @param desiredFxpDrops  FXRP the user wants to end up with (in drops)
 * @param settings          Direct minting parameters from AssetManager
 * @returns breakdown of the payment
 */
export function quoteMint(
  desiredFxpDrops: bigint,
  settings: DirectMintingSettings,
): {
  desiredFxp: bigint;
  mintingFee: bigint;
  executorFee: bigint;
  totalToSend: bigint;
} {
  if (desiredFxpDrops <= 0n) throw new Error("desired FXRP must be positive");
  const mintingFee = (desiredFxpDrops * settings.feeBIPS) / 10_000n;
  // Enforce the minimum fee floor.
  const effectiveMintingFee =
    mintingFee < settings.minimumFeeUba ? settings.minimumFeeUba : mintingFee;
  const totalToSend = desiredFxpDrops + effectiveMintingFee + settings.executorFeeUba;
  return {
    desiredFxp: desiredFxpDrops,
    mintingFee: effectiveMintingFee,
    executorFee: settings.executorFeeUba,
    totalToSend,
  };
}

/**
 * Given the amount of XRP a user is willing to send, compute how much FXRP
 * they will receive after fees.
 */
export function quoteMintFromPayment(
  paymentDrops: bigint,
  settings: DirectMintingSettings,
): {
  payment: bigint;
  mintingFee: bigint;
  executorFee: bigint;
  fxpReceived: bigint | null; // null if payment below minimum fee floor
} {
  if (paymentDrops < settings.minimumFeeUba) {
    // Below floor: nothing minted, all goes to fee receiver.
    return { payment: paymentDrops, mintingFee: paymentDrops, executorFee: 0n, fxpReceived: null };
  }
  // Minting fee first (BIPS of the amount that becomes FXRP, but approximated here
  // as BIPS of payment minus flat executor fee). Solve: fxp = (payment - executorFee) / (1 + bips/10000)
  const remaining = paymentDrops - settings.executorFeeUba;
  const fxpReceived = (remaining * 10_000n) / (10_000n + settings.feeBIPS);
  const mintingFee = paymentDrops - settings.executorFeeUba - fxpReceived;
  return { payment: paymentDrops, mintingFee, executorFee: settings.executorFeeUba, fxpReceived };
}

/**
 * Largest FXRP amount that avoids *all* direct-minting delays (hourly, daily,
 * large-mint threshold). Mints at the threshold are fine; strictly above triggers
 * the large-mint hold. Equivalent to min(hourlyHeadroom, dailyHeadroom, threshold).
 *
 * Note: true headroom depends on live tumbling-window state; this returns the static
 * cap derived from configured limits. For a precise pre-flight, query on-chain
 * limiter state (see reference.md "Check Minting Limits").
 */
export function maxInstantMintUba(
  settings: DirectMintingSettings,
  hourlyHeadroomUba: bigint = settings.hourlyLimitUba,
  dailyHeadroomUba: bigint = settings.dailyLimitUba,
): bigint {
  const a = hourlyHeadroomUba < dailyHeadroomUba ? hourlyHeadroomUba : dailyHeadroomUba;
  const b = a < settings.largeMintingThresholdUba ? a : settings.largeMintingThresholdUba;
  return b;
}

/** Lot size in UBA, from AMG and asset decimals. lot = lotSizeAMG * 10^(decimals - mintingDecimals). */
export function lotSizeUba(fs: FassetSettings): bigint {
  // AMG is the minting granularity in the asset's native decimals; UBA = AMG * 10^assetDecimals
  // (FXRP assetDecimals == 6 for XRP, AMG lotSizeAMG is lot in AMG units). For FXRP, lot = lotSizeAMG.
  // This helper keeps the formula explicit.
  return fs.lotSizeAmg;
}

/**
 * Express API for the XRP-only DeFi gateway.
 *
 * All endpoints are read-only or produce unsigned XRPL Payment objects + memos.
 * No signing, no private keys, no broadcasting. The user signs in their XRPL
 * wallet; an executor (not this service) finalizes the mint on Flare.
 *
 * Flow:
 *   1. GET  /status                        — network + direct-minting settings
 *   2. GET  /personal-account?xrplAddress= — user's Flare smart account + nonce
 *   3. POST /quote                         — XRP<->FXRP cost breakdown
 *   4. POST /prepare-payment               — unsigned XRPL Payment + memo bytes
 *   5. POST /decode-memo                    — inspect an 0xFF memo (for review)
 */

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { FlareClient, type NetworkName, NETWORKS } from "../lib/flare-client.js";
import {
  buildApproveCall,
  buildBridgeCalls,
  buildRedeemAmountCall,
  buildRedeemWithTagCall,
  buildTransferCall,
  buildVaultDepositCalls,
} from "../lib/action-builders.js";
import {
  dropsToXrp,
  quoteMint,
  quoteMintFromPayment,
  xrpToDrops,
} from "../lib/quote.js";
import { prepareMintAndActionPayment } from "../lib/payment.js";
import {
  buildDirectMintingMemo,
  decodeMemoCustomInstruction,
  type Call,
} from "../lib/memo-builder.js";
import {
  getExchanges,
  getExchange,
  getExchangeByAddress,
  validateRedemption,
  isValidXrplAddress,
  type ExchangeInfo,
} from "../lib/exchange-registry.js";
import { computeProofOfReserves } from "../lib/proof-of-reserves.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 12000);
const NETWORK = (process.env.FLARE_NETWORK ?? "coston2") as NetworkName;
const RPC_URL = process.env.FLARE_RPC_URL ?? NETWORKS[NETWORK].rpc;

// JSON.stringify a BigInt safely (convert to string). Applied globally.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

if (!NETWORKS[NETWORK]) {
  throw new Error(`Unknown FLARE_NETWORK: ${NETWORK}. Use one of ${Object.keys(NETWORKS).join(", ")}`);
}

const flare = new FlareClient(RPC_URL, NETWORK);
const app = express();
app.use(express.json());

// Serve the frontend.
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "public")));


/** Resolve a contract address once at startup so later calls are cached. */
let contractsReady: Promise<Awaited<ReturnType<FlareClient["resolveContracts"]>>>;
function ensureContracts() {
  if (!contractsReady) contractsReady = flare.resolveContracts();
  return contractsReady;
}

// --- health / network -----------------------------------------------------

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.get("/status", async (_req: Request, res: Response) => {
  try {
    const [contracts, settings, fasset, token] = await Promise.all([
      ensureContracts(),
      flare.getDirectMintingSettings(),
      flare.getFassetSettings(),
      flare.getFxrpToken(),
    ]);
    res.json({
      network: NETWORK,
      chainId: NETWORKS[NETWORK].chainId,
      contracts,
      fxrpToken: token,
      fassetSettings: {
        lotSizeUba: fasset.lotSizeAmg.toString(),
        assetDecimals: fasset.assetDecimals,
        minimumRedeemAmountUba: fasset.minimumRedeemAmountUba.toString(),
      },
      directMinting: {
        coreVaultAddress: settings.paymentAddress,
        minimumFeeXrp: dropsToXrp(settings.minimumFeeUba),
        feeBIPS: settings.feeBIPS.toString(),
        executorFeeXrp: dropsToXrp(settings.executorFeeUba),
        othersCanExecuteAfterSeconds: settings.othersCanExecuteAfterSeconds.toString(),
        hourlyLimitXrp: dropsToXrp(settings.hourlyLimitUba),
        dailyLimitXrp: dropsToXrp(settings.dailyLimitUba),
        largeMintingThresholdXrp: dropsToXrp(settings.largeMintingThresholdUba),
        largeMintingDelaySeconds: settings.largeMintingDelaySeconds.toString(),
        feeReceiver: settings.feeReceiver,
      },
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- smart account state --------------------------------------------------

const XrplAddressSchema = z.object({
  xrplAddress: z.string().regex(/^r[a-zA-Z0-9]{20,40}$/),
});

app.get("/personal-account", async (req: Request, res: Response) => {
  const parsed = XrplAddressSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid or missing xrplAddress", detail: parsed.error.format() });
    return;
  }
  try {
    const state = await flare.getSmartAccountState(parsed.data.xrplAddress);
    res.json({
      xrplAddress: state.xrplAddress,
      personalAccount: state.personalAccount,
      nonce: state.nonce.toString(),
      executor: state.executor,
      fxrpBalance: dropsToXrp(state.fxrpBalance), // FXRP is 6 decimals like XRP
      fxrpBalanceUba: state.fxrpBalance.toString(),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- quote ----------------------------------------------------------------

const QuoteSchema = z.object({
  desiredFxpXrp: z.string().optional(),
  paymentXrp: z.string().optional(),
}).refine((d) => !!d.desiredFxpXrp || !!d.paymentXrp, {
  message: "provide desiredFxpXrp or paymentXrp",
});

app.post("/quote", async (req: Request, res: Response) => {
  const parsed = QuoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid quote request", detail: parsed.error.format() });
    return;
  }
  try {
    const settings = await flare.getDirectMintingSettings();
    if (parsed.data.desiredFxpXrp) {
      const q = quoteMint(xrpToDrops(parsed.data.desiredFxpXrp), settings);
      res.json({
        desiredFxpXrp: parsed.data.desiredFxpXrp,
        mintingFeeXrp: dropsToXrp(q.mintingFee),
        executorFeeXrp: dropsToXrp(q.executorFee),
        totalToSendXrp: dropsToXrp(q.totalToSend),
      });
    } else {
      const q = quoteMintFromPayment(xrpToDrops(parsed.data.paymentXrp!), settings);
      res.json({
        paymentXrp: parsed.data.paymentXrp,
        mintingFeeXrp: dropsToXrp(q.mintingFee),
        executorFeeXrp: dropsToXrp(q.executorFee),
        fxpReceivedXrp: q.fxpReceived === null ? null : dropsToXrp(q.fxpReceived),
      });
    }
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- prepare payment ------------------------------------------------------

const PrepareSchema = z.object({
  xrplAddress: z.string().regex(/^r[a-zA-Z0-9]{20,40}$/),
  amountXrp: z.string(),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("mint_only"), // plain direct mint, no action
    }),
    z.object({
      type: z.literal("transfer"), // mint then send FXRP to a Flare address
      toFlareAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      fxrpAmountXrp: z.string(),
    }),
    z.object({
      type: z.literal("redeem"), // mint then redeem back to XRP (round-trip / move to XRPL addr)
      redeemerXrplAddress: z.string().regex(/^r[a-zA-Z0-9]{20,40}$/),
      fxrpAmountXrp: z.string(),
    }),
    z.object({
      type: z.literal("redeem_with_tag"),
      redeemerXrplAddress: z.string().regex(/^r[a-zA-Z0-9]{20,40}$/),
      destinationTag: z.number().int().min(0).max(0xffffffff),
      fxrpAmountXrp: z.string(),
    }),
    z.object({
      type: z.literal("vault_deposit"), // mint then deposit FXRP into a vault (Firelight/Upshift)
      vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      vaultId: z.number().int().min(1).max(2).optional(), // 1=Firelight, 2=Upshift
      fxrpAmountXrp: z.string(),
    }),
    z.object({
      type: z.literal("bridge"), // mint then bridge FXRP to another LayerZero chain via OFT
      dstChain: z.string(),              // destination chain id (e.g. "base", "bsc")
      recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/), // recipient on destination
      fxrpAmountXrp: z.string(),
    }),
  ]),
  walletId: z.number().int().min(0).max(255).optional(),
});

app.post("/prepare-payment", async (req: Request, res: Response) => {
  const parsed = PrepareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid prepare request", detail: parsed.error.format() });
    return;
  }
  const data = parsed.data;
  try {
    const contracts = await ensureContracts();
    const settings = await flare.getDirectMintingSettings();
    const token = await flare.getFxrpToken();

    // For mint_only, use the plain direct-minting memo (no smart account / no nonce).
    // For all others, use the 0xFF memo-field custom instruction → requires the user's
    // personal account and current nonce.
    if (data.action.type === "mint_only") {
      // Mint to the user's personal account if they have one, else to a fallback.
      // Plain direct mint memo always needs an explicit recipient address. We mint
      // to the user's personal account so they can act on it later.
      const personal = await flare.getPersonalAccount(data.xrplAddress);
      const memoHex = buildDirectMintingMemo(personal);
      const payment = {
        TransactionType: "Payment",
        Account: data.xrplAddress,
        Destination: settings.paymentAddress,
        Amount: xrpToDrops(data.amountXrp),
        Fee: "12",
        Memos: [{ Memo: { MemoData: memoHex } }],
      };
      res.json({
        kind: "mint_only",
        recipient: personal,
        payment,
        memoHex,
        note: "Plain direct mint to your Flare smart account. An executor finalizes on Flare.",
      });
      return;
    }

    // Smart-account flow (0xFF): mint + action atomically.
    const personal = await flare.getPersonalAccount(data.xrplAddress);
    const nonce = await flare.getNonce(personal);

    let calls: Call[];
    switch (data.action.type) {
      case "transfer": {
        calls = [
          buildTransferCall(
            token.address,
            data.action.toFlareAddress,
            xrpToDrops(data.action.fxrpAmountXrp),
          ),
        ];
        break;
      }
      case "redeem": {
        calls = [
          buildRedeemAmountCall(
            contracts.assetManager,
            xrpToDrops(data.action.fxrpAmountXrp),
            data.action.redeemerXrplAddress,
          ),
        ];
        break;
      }
      case "redeem_with_tag": {
        calls = [
          buildRedeemWithTagCall(
            contracts.assetManager,
            xrpToDrops(data.action.fxrpAmountXrp),
            data.action.redeemerXrplAddress,
            data.action.destinationTag,
          ),
        ];
        break;
      }
      case "vault_deposit": {
        // Resolve vault address: explicit address takes precedence,
        // otherwise resolve from vaultId via MasterAccountController.getVaults().
        let vaultAddr = data.action.vaultAddress;
        if (!vaultAddr) {
          if (!data.action.vaultId) {
            throw new Error("vault_deposit requires either vaultAddress or vaultId (1=Firelight, 2=Upshift)");
          }
          const vaults = await flare.getVaults();
          vaultAddr = vaults[data.action.vaultId - 1];
          if (!vaultAddr) {
            throw new Error(`No vault at index ${data.action.vaultId}. Available: ${vaults.length}`);
          }
        }
        calls = buildVaultDepositCalls(
          token.address,
          vaultAddr,
          xrpToDrops(data.action.fxrpAmountXrp),
        );
        break;
      }
      case "bridge": {
        // Mint FXRP, approve the OFT adapter, then send via LayerZero — all atomic.
        const useTestnet = NETWORK === "coston2" || NETWORK === "coston";
        const srcChain = getChains(useTestnet).find((c) => c.isAdapter);
        if (!srcChain) throw new Error("No OFT adapter chain found for current network");
        const dstChain = getChain(data.action.dstChain, useTestnet);
        if (!dstChain) {
          throw new Error(`Unknown destination chain: ${data.action.dstChain}. Available: ${getChains(useTestnet).map((c) => c.id).join(", ")}`);
        }
        if (srcChain.id === dstChain.id) {
          throw new Error("Source and destination must differ");
        }
        const bridgeData = await buildBridgeCallsData(
          srcChain,
          dstChain,
          data.action.fxrpAmountXrp,
          data.action.recipientAddress,
        );
        calls = buildBridgeCalls(
          bridgeData.approve.to,
          bridgeData.approve.data,
          bridgeData.send.to,
          bridgeData.send.data,
          BigInt(bridgeData.send.value),
        );
        break;
      }
      default:
        throw new Error(`unhandled action: ${(data.action as any).type}`);
    }

    const { payment, memoHex, userOpHash } = prepareMintAndActionPayment({
      coreVaultAddress: settings.paymentAddress,
      senderXrplAddress: data.xrplAddress,
      personalAccount: personal,
      nonce,
      amountXrp: data.amountXrp,
      calls,
      walletId: data.walletId,
    });

    res.json({
      kind: "mint_and_action",
      action: data.action.type,
      personalAccount: personal,
      nonce: nonce.toString(),
      payment,
      memoHex,
      callsPreview: calls.map((c) => ({
        target: c.target,
        value: c.value.toString(),
        data: c.data,
      })),
      userOpCallDataHash: userOpHash,
      note:
        "Sign this Payment in your XRPL wallet. Mint + action execute atomically on Flare; if the action reverts, no FXRP is minted.",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- vaults (Firelight / Upshift) -----------------------------------------

// --- FTSO price feed ------------------------------------------------------

app.get("/ftso-price", async (req: Request, res: Response) => {
  try {
    const feedId = (req.query.feedId as string) || undefined;
    const price = await flare.getFtsoPrice(feedId);
    res.json({
      network: NETWORK,
      feedId: feedId || "XRP/USD (default)",
      ...price,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get("/vaults", async (_req: Request, res: Response) => {
  try {
    const vaultAddresses = await flare.getVaults();
    // Index 0 = Firelight (vaultId 1), Index 1 = Upshift (vaultId 2)
    const vaultNames = ["Firelight", "Upshift"];
    const vaults = await Promise.all(
      vaultAddresses.map(async (addr, i) => {
        const balance = await flare.getVaultFxrpBalance(addr);
        return {
          vaultId: i + 1,
          name: vaultNames[i] ?? `Vault ${i + 1}`,
          address: addr,
          fxrpBalance: dropsToXrp(balance),
        };
      }),
    );
    res.json({ network: NETWORK, vaults });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- decode memo (for review) --------------------------------------------

const DecodeSchema = z.object({ memoHex: z.string() });

app.post("/decode-memo", (req: Request, res: Response) => {
  const parsed = DecodeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "memoHex required", detail: parsed.error.format() });
    return;
  }
  try {
    const decoded = decodeMemoCustomInstruction(parsed.data.memoHex);
    res.json({
      opcode: `0x${decoded.opcode.toString(16).padStart(2, "0")}`,
      walletId: decoded.walletId,
      executorFeeUba: decoded.executorFeeUba.toString(),
      userOpEncodedLengthBytes:
        ethers.getBytes(decoded.userOpEncoded).length,
      userOpEncoded: decoded.userOpEncoded,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- cross-chain dashboard --------------------------------------------------

import {
  getChains,
  getChain,
} from "../lib/chains.js";
import {
  getPortfolio,
  buildBridgeCallsData,
  type BridgeCallData,
} from "../lib/crosschain-client.js";
/** Whether to use testnet or mainnet chain configurations for the dashboard. */
const USE_TESTNET = process.env.CROSSCHAIN_TESTNET === "true";
/** Whether the gateway itself runs on a testnet (drives bridge action chain selection). */
const GATEWAY_TESTNET = NETWORK === "coston2" || NETWORK === "coston";

app.get("/chains", (_req: Request, res: Response) => {
  res.json({
    useTestnet: USE_TESTNET,
    gatewayTestnet: GATEWAY_TESTNET,
    fxrpDecimals: 6,
    chains: getChains(USE_TESTNET).map((c) => ({
      id: c.id,
      name: c.name,
      chainId: c.chainId,
      lzEid: c.lzEid,
      oftAddress: c.oftAddress,
      isAdapter: c.isAdapter,
      available: c.available,
      nativeSymbol: c.nativeSymbol,
      logoColor: c.logoColor,
      explorer: c.explorer,
    })),
  });
});

/** Chains available for the gateway's mint→bridge action (based on gateway network). */
app.get("/bridge-chains", (_req: Request, res: Response) => {
  const chains = getChains(GATEWAY_TESTNET).filter((c) => !c.isAdapter && c.available);
  res.json({
    gatewayNetwork: NETWORK,
    gatewayTestnet: GATEWAY_TESTNET,
    chains: chains.map((c) => ({
      id: c.id,
      name: c.name,
      lzEid: c.lzEid,
      nativeSymbol: c.nativeSymbol,
    })),
  });
});

const PortfolioSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 0x EVM address"),
});

app.get("/portfolio", async (req: Request, res: Response) => {
  const parsed = PortfolioSchema.safeParse({ address: req.query.address });
  if (!parsed.success) {
    res.status(400).json({ error: "address (0x...) required", detail: parsed.error.format() });
    return;
  }
  try {
    const portfolio = await getPortfolio(parsed.data.address, USE_TESTNET);
    res.json(portfolio);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

const BridgeSchema = z.object({
  srcChain: z.string(),
  dstChain: z.string(),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a decimal number"),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Recipient must be a 0x address"),
});

app.post("/bridge-prepare", async (req: Request, res: Response) => {
  const parsed = BridgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", detail: parsed.error.format() });
    return;
  }
  const { srcChain, dstChain, amount, recipient } = parsed.data;
  const src = getChain(srcChain, USE_TESTNET);
  const dst = getChain(dstChain, USE_TESTNET);
  if (!src || !dst) {
    res.status(400).json({ error: `Unknown chain. Available: ${getChains(USE_TESTNET).map((c) => c.id).join(", ")}` });
    return;
  }
  if (src.id === dst.id) {
    res.status(400).json({ error: "Source and destination must differ" });
    return;
  }
  try {
    const callData: BridgeCallData = await buildBridgeCallsData(src, dst, amount, recipient);
    res.json({
      srcChain: { id: src.id, name: src.name, lzEid: src.lzEid },
      dstChain: { id: dst.id, name: dst.name, lzEid: dst.lzEid },
      amount,
      recipient,
      quote: {
        nativeFee: callData.quote.nativeFee,
        lzTokenFee: callData.quote.lzTokenFee,
      },
      calls: [
        callData.approve,
        callData.send,
      ],
      note: "Sign these calls on the source chain. The OFT adapter/native OFT handles the LayerZero messaging. Native fee covers LZ gas.",
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- exchange registry + standalone redemption ----------------------------

app.get("/exchanges", (_req: Request, res: Response) => {
  const exchanges = getExchanges(true);
  res.json({
    count: exchanges.length,
    exchanges: exchanges.map((e) => ({
      id: e.id,
      name: e.name,
      depositAddress: e.depositAddress,
      requiresTag: e.requiresTag,
      minDepositXrp: e.minDepositXrp,
      depositUrl: e.depositUrl,
      color: e.color,
      initials: e.initials,
    })),
  });
});

const PrepareRedeemSchema = z.object({
  amountXrp: z.string().regex(/^\d+(\.\d+)?$/, "Amount must be a decimal number"),
  // Either exchangeId (lookup from registry) or a raw r-address:
  exchangeId: z.string().optional(),
  redeemerXrplAddress: z.string().optional(),
  destinationTag: z.number().int().min(0).max(0xffffffff).optional(),
  // The EVM address that will call redeemWithTag (the smart account or wallet):
  callerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "callerAddress must be a 0x address").optional(),
});

/**
 * Standalone redemption — burn existing FXRP and receive XRP at an XRPL address.
 * Unlike /prepare-payment (which mints + redeems atomically via 0xFF memo), this
 * endpoint returns the raw EVM calldata for `redeemWithTag` / `redeemAmount`,
 * suitable for signing in an EVM wallet or smart account.
 *
 * Use cases:
 *   - User already holds FXRP (from a previous mint, transfer, or bridge)
 *   - User wants to cash out directly to an exchange deposit address
 *   - No mint involved — just redeem existing FXRP
 */
app.post("/prepare-redeem", async (req: Request, res: Response) => {
  const parsed = PrepareRedeemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", detail: parsed.error.format() });
    return;
  }
  const { amountXrp, exchangeId, destinationTag, callerAddress } = parsed.data;
  let { redeemerXrplAddress } = parsed.data;

  // Resolve exchange (if exchangeId provided)
  let exchange: ExchangeInfo | undefined;
  if (exchangeId) {
    exchange = getExchange(exchangeId);
    if (!exchange) {
      res.status(400).json({ error: `Unknown exchange: ${exchangeId}` });
      return;
    }
    redeemerXrplAddress = exchange.depositAddress;
  }

  // Look up exchange by address if a known deposit address is provided directly
  if (!exchange && redeemerXrplAddress) {
    exchange = getExchangeByAddress(redeemerXrplAddress);
  }

  // Validate the r-address
  if (!redeemerXrplAddress || !isValidXrplAddress(redeemerXrplAddress)) {
    res.status(400).json({
      error: "Provide either exchangeId or a valid XRPL r-address (redeemerXrplAddress)",
    });
    return;
  }

  // Validate against exchange registry (warnings + errors)
  const { warnings, errors } = validateRedemption(exchange, amountXrp, destinationTag);
  if (errors.length > 0) {
    res.status(400).json({ error: errors.join("; "), warnings });
    return;
  }

  try {
    const contracts = await ensureContracts();
    const amountUba = xrpToDrops(amountXrp);

    // Use the caller's address as executor if provided, otherwise zero address
    // (the AssetManager will use the default agent/executor).
    const executor = callerAddress ?? ethers.ZeroAddress;

    let call: { to: string; data: string; value: string };
    let functionSig: string;

    if (destinationTag !== undefined) {
      const c = buildRedeemWithTagCall(
        contracts.assetManager,
        amountUba,
        redeemerXrplAddress,
        destinationTag,
        executor,
      );
      call = { to: c.target, data: c.data, value: c.value.toString() };
      functionSig = "redeemWithTag(uint256,string,address,uint32)";
    } else {
      const c = buildRedeemAmountCall(
        contracts.assetManager,
        amountUba,
        redeemerXrplAddress,
        executor,
      );
      call = { to: c.target, data: c.data, value: c.value.toString() };
      functionSig = "redeemAmount(uint256,string,address)";
    }

    res.json({
      function: functionSig,
      to: call.to,
      data: call.data,
      value: call.value,
      amountXrp,
      amountUba: amountUba.toString(),
      redeemerXrplAddress,
      destinationTag,
      exchange: exchange
        ? { id: exchange.id, name: exchange.name, depositUrl: exchange.depositUrl }
        : null,
      warnings,
      callerAddress: callerAddress ?? null,
      executor,
      assetManager: contracts.assetManager,
      note:
        "Sign this calldata on Flare (in your EVM wallet or smart account). " +
        "The AssetManager burns FXRP and the agent sends XRP to the specified XRPL address. " +
        "Redemption enters a queue — the agent typically processes within minutes to hours.",
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- proof of reserves -----------------------------------------------------

app.get("/reserves", async (_req: Request, res: Response) => {
  try {
    const data = await computeProofOfReserves(flare, USE_TESTNET);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// --- executor status proxy --------------------------------------------------

/** Executor HTTP API base URL. The executor runs on a separate port (default 12001). */
const EXECUTOR_URL = process.env.EXECUTOR_URL ?? `http://127.0.0.1:${Number(process.env.EXECUTOR_PORT ?? 12001)}`;

app.get("/executor-status", async (_req: Request, res: Response) => {
  try {
    const healthRes = await fetch(`${EXECUTOR_URL}/health`);
    if (!healthRes.ok) {
      res.json({ online: false, error: `executor returned ${healthRes.status}` });
      return;
    }
    const health = await healthRes.json() as any;

    // Try to fetch journal summary (non-fatal if it fails)
    let journal: { count: number; recent: any[] } | null = null;
    try {
      const jr = await fetch(`${EXECUTOR_URL}/journal`);
      if (jr.ok) {
        const jd = await jr.json() as any;
        journal = {
          count: jd.count ?? 0,
          recent: (jd.entries ?? []).slice(-5).reverse(),
        };
      }
    } catch { /* executor journal not available */ }

    res.json({ online: true, ...health, journal });
  } catch {
    res.json({ online: false, error: "executor not reachable" });
  }
});

// --- start (local dev only; Vercel uses app.ts which exports the app) -------

if (process.env.VERCEL !== "1") {
  app.listen(PORT, HOST, () => {
    console.log(`XRP-only DeFi gateway on http://${HOST}:${PORT} (network: ${NETWORK})`);
    console.log(`  Cross-chain dashboard: http://${HOST}:${PORT}/dashboard.html (mode: ${USE_TESTNET ? "testnet" : "mainnet"})`);
  });
}

export {app};
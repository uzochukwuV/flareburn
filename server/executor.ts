/**
 * Executor service entry point.
 *
 * Runs the Executor as a long-lived process that monitors the XRPL for Core Vault
 * payments and finalizes FXRP mints on Flare. Also exposes a minimal HTTP API
 * for health checks and manual processing.
 *
 * Usage:
 *   EXECUTOR_PRIVATE_KEY=0x... \
 *   CORE_VAULT_ADDRESS=rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p \
 *   DRY_RUN=true \
 *   npm run executor
 *
 * Environment variables:
 *   EXECUTOR_PRIVATE_KEY  — EVM private key for the executor wallet (required)
 *   CORE_VAULT_ADDRESS    — XRPL Core Vault r-address (required; see /status endpoint)
 *   FLARE_NETWORK         — coston2 | flare | songbird | coston (default: coston2)
 *   FLARE_RPC_URL         — override Flare RPC endpoint
 *   XRPL_ENDPOINT         — override XRPL websocket endpoint
 *   DRY_RUN               — "false" to broadcast execute txs (default: true)
 *   JOURNAL_PATH          — path to journal JSON (default: ./executor-journal.json)
 *   VERIFIER_API_KEY      — FDC verifier API key
 *   PROOF_OWNER           — EVM address that owns the proof (default: executor address)
 *   PORT                  — HTTP port for health endpoint (default: 12001)
 */

import express from "express";
import { Executor, configFromEnv } from "../lib/executor.js";
import { FlareClient, NETWORKS, type NetworkName } from "../lib/flare-client.js";

const PORT = Number(process.env.PORT ?? 12001);
const HOST = process.env.HOST ?? "0.0.0.0";

// JSON.stringify a BigInt safely (convert to string).
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function resolveCoreVaultAddress(): Promise<string> {
  // If CORE_VAULT_ADDRESS is set in env, use it directly.
  if (process.env.CORE_VAULT_ADDRESS) return process.env.CORE_VAULT_ADDRESS;

  // Otherwise resolve it from the AssetManager on-chain.
  const network = (process.env.FLARE_NETWORK ?? "coston2") as NetworkName;
  const rpc = process.env.FLARE_RPC_URL ?? NETWORKS[network].rpc;
  const flare = new FlareClient(rpc, network);
  const settings = await flare.getDirectMintingSettings();
  return settings.paymentAddress;
}

async function main() {
  console.log("=== Flare FXRP Executor Service ===\n");

  // Resolve the Core Vault address if not provided.
  if (!process.env.CORE_VAULT_ADDRESS) {
    console.log("[executor] CORE_VAULT_ADDRESS not set — resolving from AssetManager…");
    const vault = await resolveCoreVaultAddress();
    process.env.CORE_VAULT_ADDRESS = vault;
    console.log(`[executor] resolved Core Vault: ${vault}`);
  }

  const config = configFromEnv();
  const executor = new Executor(config);

  // Minimal HTTP API for health + manual processing.
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      executor: executor.address,
      network: config.network,
      dryRun: config.dryRun,
      coreVault: config.coreVaultAddress,
    });
  });

  app.get("/journal", async (_req, res) => {
    const entries = Array.from((executor as any).journal.values()) as any[];
    res.json({ count: entries.length, entries });
  });

  // Manually trigger processing for a specific XRPL tx hash.
  app.post("/process", async (req, res) => {
    const txHash = req.body?.transactionId;
    if (!txHash || typeof txHash !== "string") {
      res.status(400).json({ error: "body must include { transactionId: string }" });
      return;
    }
    try {
      const result = await executor.processTransactionHash(txHash);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  await executor.start();

  app.listen(PORT, HOST, () => {
    console.log(`\n[executor] HTTP API on http://${HOST}:${PORT}`);
    console.log(`[executor]   GET  /health  — status`);
    console.log(`[executor]   GET  /journal — processed transactions`);
    console.log(`[executor]   POST /process — { transactionId } manual trigger\n`);
  });

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    console.log(`\n[executor] received ${signal}, shutting down…`);
    await executor.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[executor] fatal:", err);
  process.exit(1);
});

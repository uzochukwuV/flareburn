import {app} from "./server/index"
import { type NetworkName } from "./lib/flare-client.js";
import express, { type Request, type Response } from "express";


const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3001);
const NETWORK = (process.env.FLARE_NETWORK ?? "coston2") as NetworkName;
const USE_TESTNET = process.env.CROSSCHAIN_TESTNET === "true";


app.listen(PORT, HOST, () => {
    console.log(`XRP-only DeFi gateway on http://${HOST}:${PORT} (network: ${NETWORK})`);
    console.log(`  Cross-chain dashboard: http://${HOST}:${PORT}/dashboard.html (mode: ${USE_TESTNET ? "testnet" : "mainnet"})`);
  });
  
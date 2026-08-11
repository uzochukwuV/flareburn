# XRP → Flare DeFi Gateway

Mint **FXRP** and act on Flare from a **single XRPL Payment** — no EVM wallet,
no FLR token, no second transaction. Built on Flare Smart Accounts + FAssets
direct minting.

An XRPL user signs one Payment; the FAssets `AssetManager` mints FXRP into the
user's Flare smart account, and a `PackedUserOperation` encoded in the memo runs
the chosen action (transfer, redeem, vault deposit) **atomically**. If the action
reverts, no FXRP is minted.

## How it works

```
User (XRPL wallet)                              Flare
  │                                               │
  │  1. Payment to Core Vault                     │
  │     memo = 0xFF + walletId + executorFee      │
  │            + abi.encode(PackedUserOperation)  │
  │──────────────────────────────────────────────►│
  │                                               │  2. executor calls
  │                                               │     executeDirectMinting
  │                                               │     → mints FXRP to smart account
  │                                               │     → MasterAccountController
  │                                               │       decodes memo, runs executeUserOp
  │                                               │       (transfer / redeem / deposit)
  │                                               │  3. atomic: revert = no mint
```

The gateway only **prepares** the unsigned Payment and memo. It never signs,
holds keys, or broadcasts. The user signs in their XRPL wallet (Xaman, etc.);
an executor finalizes on Flare.

## Actions

| Action | What happens atomically after mint |
|--------|-------------------------------------|
| `mint_only` | Plain direct mint to smart account (no action memo) |
| `transfer` | Mint → ERC-20 transfer FXRP to a Flare `0x` address |
| `redeem` | Mint → `redeemAmount` back to an XRPL `r` address |
| `redeem_with_tag` | Mint → `redeemWithTag` to an exchange address (destination tag) |
| `vault_deposit` | Mint → approve + deposit into a Firelight/Upshift vault |

## Quick start

```bash
npm install
npm run smoke          # unit tests + live Coston2 contract resolution
npm start              # http://localhost:12000 (Coston2 by default)
```

Then open `http://localhost:12000` in a browser.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLARE_NETWORK` | `coston2` | `flare` \| `coston2` \| `songbird` \| `coston` |
| `FLARE_RPC_URL` | network default | Override the RPC endpoint |
| `PORT` | `12000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |

## API

| Method & path | Body / query | Returns |
|---------------|--------------|---------|
| `GET /health` | — | `{ ok: true }` |
| `GET /status` | — | Network, contracts, FXRP token, direct-minting settings |
| `GET /personal-account?xrplAddress=r…` | — | Smart account address, nonce, FXRP balance |
| `POST /quote` | `{ paymentXrp }` or `{ desiredFxpXrp }` | Fee breakdown + FXRP received |
| `POST /prepare-payment` | `{ xrplAddress, amountXrp, action, walletId? }` | Unsigned XRPL Payment + memo hex + call preview |
| `POST /decode-memo` | `{ memoHex }` | Decoded opcode, walletId, executor fee |

### Example: prepare a mint + transfer

```bash
curl -X POST http://localhost:12000/prepare-payment \
  -H "Content-Type: application/json" \
  -d '{
    "xrplAddress": "rDsbeomae4FXwgQTJp9RH64vSsziqWYF8u",
    "amountXrp": "10",
    "action": {
      "type": "transfer",
      "toFlareAddress": "0x1111111111111111111111111111111111111111",
      "fxrpAmountXrp": "9.5"
    }
  }'
```

Returns an unsigned `Payment` object targeting the Core Vault, with a `0xFF`
memo encoding the mint + transfer. Sign it in an XRPL wallet.

## Cross-chain FXRP dashboard

The gateway also includes a **cross-chain dashboard** at `/dashboard.html` that
shows your FXRP positions across all LayerZero OFT-deployed chains and lets you
bridge or redeem in one place.

### Supported chains (mainnet)

| Chain | OFT type | LayerZero EID |
|-------|---------|---------------|
| Flare | OFT Adapter | 30295 |
| Ethereum | OFT | 30101 |
| Base | OFT | 30184 |
| BNB Chain | OFT | 30102 |
| HyperEVM | OFT | 30367 |
| Monad | OFT | 30390 |
| Katana | OFT | 30375 |

### Dashboard API

| Method & path | Body / query | Returns |
|---------------|--------------|---------|
| `GET /chains` | — | All supported chains with OFT addresses + LZ EIDs |
| `GET /portfolio?address=0x…` | — | FXRP balance + total supply on every chain, in parallel |
| `POST /bridge-prepare` | `{ srcChain, dstChain, amount, recipient }` | Unsigned OFT approve + send calldata + LayerZero fee quote |

### Example: fetch cross-chain portfolio

```bash
curl "http://localhost:12000/portfolio?address=0xYourAddress"
```

Returns total FXRP across all chains, per-chain balances, total supply, and
explorer links — all fetched in parallel from each chain's RPC.

### Example: prepare a bridge Flare → Base

```bash
curl -X POST http://localhost:12000/bridge-prepare \
  -H "Content-Type: application/json" \
  -d '{
    "srcChain": "flare",
    "dstChain": "base",
    "amount": "100",
    "recipient": "0xYourAddress"
  }'
```

Returns the LayerZero fee quote and the unsigned `approve` + `send` calldata.
On Flare, these can be bundled into a Smart Account `PackedUserOperation`
(via the gateway's 0xFF memo). On other chains, sign directly in your wallet.

### Testnet mode

For testing bridge flows on Coston2 ↔ Hyperliquid testnet:

```bash
CROSSCHAIN_TESTNET=true npm start
```

## Exchange-friendly redemption router

Redeem FXRP directly to your exchange deposit address — no intermediate
personal r-address, no re-routing. Built on `redeemWithTag`.

### How it works

```
User holds FXRP (Flare wallet or smart account)
  │
  │  POST /prepare-redeem { exchangeId: "binance", amountXrp: "100", destinationTag: 12345 }
  │─────────────────────────────────────────────────────────────────────►│
  │                                                                     │  Returns redeemWithTag calldata
  │                                                                     │  targeting the exchange's deposit address
  │  Sign calldata in EVM wallet                                        │
  │────────────────────────────────────────────────────────────────────►│
  │                                                                     │  AssetManager burns FXRP
  │                                                                     │  Agent sends XRP to exchange
  │                                                                     │  (with destination tag)
```

### API

| Method & path | Body | Returns |
|---------------|------|---------|
| `GET /exchanges` | — | Registry of supported exchanges (Binance, Kraken, Coinbase, Bitstamp, Bybit) |
| `POST /prepare-redeem` | `{ amountXrp, exchangeId?, redeemerXrplAddress?, destinationTag?, callerAddress? }` | `redeemWithTag` or `redeemAmount` calldata + validation warnings |

### Features

- **Exchange registry** — curated deposit addresses for 5+ exchanges (auto-filled, no pasting)
- **Destination tag management** — tags saved per-exchange in localStorage, validated as uint32
- **Minimum deposit warnings** — alerts if amount is below the exchange's minimum
- **Two redeem modes:**
  - **Standalone** — burn existing FXRP (EVM wallet signs `redeemWithTag` calldata)
  - **Mint + Redeem** — atomic mint→redeem via 0xFF memo (XRPL wallet signs)
- **Address validation** — r-address format checked, exchange lookup by address

### Example: redeem to Binance

```bash
curl -X POST http://localhost:12000/prepare-redeem \
  -H "Content-Type: application/json" \
  -d '{
    "amountXrp": "100",
    "exchangeId": "binance",
    "destinationTag": 123456789
  }'
```

Returns calldata for `AssetManager.redeemWithTag(100000000, "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DukL7", 0x0, 123456789)`.

## Proof of reserves

The dashboard includes a **proof-of-reserves** card that verifies FXRP is
fully backed by XRP locked in the FAssets Core Vault.

### What it checks

1. **FXRP total supply** (Flare on-chain) — the canonical backing obligation
2. **Core Vault XRP balance** (XRPL cross-chain) — the actual physical reserve
3. **Backing ratio** — vault balance / FXRP supply (should be ≥ 100%)
4. **Omnichain distribution** — how FXRP is split across all LayerZero OFT chains

### Data sources

| Source | What | How |
|--------|------|-----|
| Flare RPC | FXRP ERC-20 totalSupply | `eth_call` to FXRP token contract |
| Flare RPC | OFT adapter locked balance | `balanceOf` on OFT adapter |
| XRPL API | Core Vault actual XRP balance | `account_info` via xrpl.js websocket |
| Cross-chain RPCs | Per-chain OFT totalSupply | Parallel `eth_call` to each chain |

### API

```bash
curl http://localhost:12000/reserves
```

Returns the full reserve data including backing ratio, status (`healthy` /
`warning` / `critical`), and per-chain supply distribution.

### Future enhancement

The current implementation queries the XRPL API directly for the Core Vault
balance. A future enhancement would use FDC `ConfirmedBlockHeightExists`
attestations to cryptographically prove the XRPL balance, removing trust in
the API response. The FDC client infrastructure exists in `lib/fdc-client.ts`.

## Project layout

```
lib/
  chains.ts            # Chain registry: OFT addresses, LZ V2 EIDs, RPCs
  crosschain-client.ts # Multi-chain balance fetcher + OFT bridge quote/prepare
  exchange-registry.ts # Curated exchange deposit addresses + validation
  proof-of-reserves.ts # FXRP supply vs Core Vault XRP balance verification
  fdc-client.ts        # FDC attestation client (XRPPayment proofs)
  executor.ts          # Relayer: monitor -> FDC proof -> executeDirectMinting
  memo-builder.ts      # 0xFF memo + PackedUserOperation + Call encoding (ABI)
  flare-client.ts      # Read-only FlareContractRegistry → AssetManager / MAC
  action-builders.ts   # transfer / redeem / redeemWithTag / vault deposit calls
  quote.ts             # XRP↔drops conversion, mint fee math
  payment.ts           # Assembles the unsigned XRPL Payment object
  xrpl-monitor.ts      # XRPL websocket payment monitor (Core Vault)
server/
  index.ts             # Express API + static frontend (+ cross-chain + exchange + reserves)
  executor.ts          # Executor service (standalone, HTTP API + XRPL monitor)
public/
  index.html           # Mint gateway: 4-step UI (account → action → quote → prepare)
  dashboard.html       # Cross-chain dashboard: portfolio + bridge + redeem + reserves
  styles.css           # Shared dark theme
  dashboard.css        # Dashboard-specific styles
  app.js               # Mint gateway frontend
  dashboard.js         # Dashboard frontend (parallel queries, bridge, redeem, reserves)
scripts/
  smoke-test.ts        # 23 assertions: memo bytes, quote math, live RPC
  crosschain-test.ts   # 48 assertions: OFT balances, bridge calldata, LZ fees
  executor-test.ts     # 61 assertions: memo routing, FDC proofs, contract resolution
  exchange-test.ts     # 40 assertions: exchange registry, redeem calldata, proof-of-reserves
```

## Security model

- **No keys, no signing, no broadcasting.** The gateway produces unsigned
  Payment objects and memo bytes only. The user signs in their XRPL wallet.
- **No destination tags on smart-account flows.** The API rejects
  `destinationTag` for `0xFF` memos — a tag would credit the tag-holder instead
  of the smart account (per the Flare docs).
- **External data is untrusted.** XRPL memo bytes and RPC responses are decoded
  only via fixed binary formats / ABI. They are never passed to free-form text
  processing.
- **Read-only chain access.** `FlareClient` uses `ethers.JsonRpcProvider` with
  no signer. It cannot submit transactions.

## References

- [Flare Smart Accounts](https://dev.flare.network/smart-accounts/overview)
- [Memo Field Custom Instruction (0xFF)](https://dev.flare.network/smart-accounts/memo-field-custom-instruction)
- [FAssets Direct Minting](https://dev.flare.network/fassets/developer-guides/fassets-mint)
- [IAssetManager reference](https://dev.flare.network/fassets/reference/IAssetManager)
- Installed skill: `.agents/skills/flare-fassets-skill/`

## License

MIT

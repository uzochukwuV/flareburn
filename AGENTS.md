# Flare AI Skills ŌĆö Repository Memory

## Installed Skills (from flare-foundation/flare-ai-skills)
Location: `.agents/skills/`
- `flare-fassets-skill` ŌĆö FAssets/FXRP minting, redemption, Core Vault, MintingTagManager
- `flare-ftso-skill` ŌĆö FTSO price feeds (block-latency ~1.8s)
- `flare-fdc-skill` ŌĆö Flare Data Connector (attestations, Merkle proofs)
- `flare-smart-accounts-skill` ŌĆö XRPLŌåÆFlare account abstraction (no FLR needed)
- `flare-fcc-skill` ŌĆö Flare Confidential Compute (TEE)
- `flare-general-skill` ŌĆö General Flare knowledge, networks, tooling


## FDC Attestation Flow (VERIFIED č commit 1e7d415)
End-to-end FXRP mint via FDC attestation is WORKING on Coston2:
1. Prepare XRPPayment FDC request (attestationType="XRPPayment" bytes32, sourceId="testXRP" bytes32)
2. Calculate attestation fee via `FdcRequestFeeConfigurations` contract (NOT FdcHub č it reverts)
3. Submit attestation to `FdcHub.requestAttestation` (costs 1 wei on Coston2)
4. Calculate voting round: `(blockTimestamp - firstVotingRoundStartTs) / 90`
   - **firstVotingRoundStartTs = 1658430000** (read from FlareSystemsManager via ContractRegistry)
   - **CRITICAL**: Must subtract firstVotingRoundStartTs! `blockTs / 90` gives WRONG round IDs
5. Wait for finalization via `Relay.isFinalized(votingRoundId, 200)` (FDC protocol ID = 200)
6. Fetch proof from DA Layer: `POST {daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`
   - DA Layer URL (Coston2): `https://ctn2-data-availability.flare.network`
   - API key: `00000000-0000-0000-0000-000000000000` (default verifier key)
   - Body: `{ votingRoundId, requestBytes }`
   - **Retry needed**: DA Layer lags ~10-20s behind on-chain finalization
7. Decode proof: response is `{ response_hex, attestation_type, proof }`
   - `response_hex` is ABI-encoded full attestation tuple (decode with AbiCoder)
   - `proof` is the Merkle proof array (bytes32[])
   - `attestation_type` is bytes32 "XRPPayment"
8. Call `AssetManager.executeDirectMinting(proofTuple)` č mints FXRP to recipient

### DA Layer Response Format (CRITICAL)
The DA Layer returns `{ response_hex, attestation_type, proof }`, NOT `{ merkleProof, data }`.
`response_hex` decodes as: `tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound,
uint64 lowestUsedTimestamp, tuple(bytes32, address) requestBody,
tuple(uint64, uint64, string, bytes32, bytes32, bytes32, int256, int256, int256, int256,
bool, bytes, bool, uint256, uint8) responseBody)`

### Contract Addresses (Coston2)
- FlareContractsRegistry: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`
- FdcHub: `0x48aC463d7975828989331F4De43341627b9c5f1D`
- Relay: `0xa10B672D1c62e5457b17af63d4302add6A99d7dE`
- AssetManagerFXRP: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP token (FTestXRP): `0x0b6A3645c240605887a5532109323A3E12273dc7` (decimals=6)

### Common executeDirectMinting Revert Errors
- `0x18dce79f` = `PaymentAlreadyConfirmed()` č XRPL tx already used for a mint

## Key Technical Facts (FAssets / FXRP / XRP)
- **FAssets**: trustless over-collateralized bridge XRPL/BTC/DOGE ŌåÆ Flare ERC-20 (FXRP, FBTC, FDOGE)
- **FXRP**: ERC-20 representation of XRP on Flare; also deployed as LayerZero OFT (HyperEVM, HyperCore, Ethereum, Base, BSC, Monad, Katana)
- **Standard minting (current)**: single XRPL payment to Core Vault (`AssetManager.directMintingPaymentAddress()`), params in destination tag or memo; executor calls `executeDirectMinting`. Legacy collateral-reservation flow archived.
- **Direct minting memo formats**: 32-byte `0x4642505266410018` + 4 zero bytes + 20-byte recipient; 48-byte `0x4642505266410021` + recipient + executor
- **MintingTagManager**: ERC-721 NFT tags mapping destination tag ŌåÆ recipient/executor; `AssetManager.getMintingTagManager()`
- **Redemption**: `redeem` (lots), `redeemAmount` (arbitrary UBA), `redeemWithTag` (XRP exchange addresses with destination tag)
- **Smart Accounts**: XRPL users interact with Flare without FLR; MasterAccountController; instruction types 0x0_ (FXRP), 0x1_ (Firelight/stXRP), 0x2_ (Upshift)
- **FlareContractsRegistry**: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` (same all networks)
- **Networks**: Flare (14), Coston2 (114), Songbird (19), Coston (16)
- **Fees (Coston2)**: min fee 0.1 XRP, 0.25% minting fee, 0.1 XRP executor fee

## Skill Safety Model
- All skills are **documentation/reference only** ŌĆö no transaction execution, no key handling
- Write scripts dry-run by default (`DRY_RUN=false` to broadcast)
- External data (memos, FDC proofs, RPC) treated as untrusted, decoded via fixed binary formats only

## XRP-only DeFi Gateway (built project)
- Location: project root (`/workspace/project`)
- Stack: TypeScript (ESM), ethers v6, xrpl.js, express, zod
- **Core contract names on Coston2 registry**: `AssetManagerFXRP` (all caps), `MasterAccountController`
- AssetManagerFXRP Coston2: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP token (FTestXRP) Coston2: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- Core Vault (Coston2): `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`
- **0xFF memo layout**: `[0xFF][walletId:1][executorFeeUba:8 big-endian][abi.encode(PackedUserOperation)]`
- PackedUserOperation validated fields: `sender`, `nonce`, `callData` only
- `callData = abi.encodeCall(IPersonalAccount.executeUserOp, (Call[]))`
- Call struct: `{ address target; uint256 value; bytes data; }`
- **No destination tag** on 0xFF flows (credits tag-holder instead of smart account)
- Run: `npm install && npm run smoke && npm start` (port 12000, Coston2 default)
- 23/23 smoke tests pass incl. live Coston2 integration

## Cross-Chain FXRP Dashboard (built on top of gateway)
- Dashboard at `/dashboard.html` ŌĆö unified FXRP position view across all OFT chains
- New files: `lib/chains.ts`, `lib/crosschain-client.ts`, `public/dashboard.{html,css,js}`
- New API: `GET /chains`, `GET /portfolio?address=0x...`, `POST /bridge-prepare`
- **FXRP OFT mainnet deployments**: Flare (adapter) 0xd706..., Ethereum/Base/BSC/Monad 0xCE61..., HyperEVM 0xd706..., Katana 0x565f...
- **Coston2 testnet**: OFT adapter 0xCd3d..., Hyperliquid testnet OFT 0x14bf...
- **LayerZero V2 EIDs**: Flare 30295, Ethereum 30101, BSC 30102, Base 30184, HyperEVM 30367, Monad 30390, Katana 30375
- Testnet EIDs: Coston2 40294, Hyperliquid testnet 40362
- FXRP decimals = 6 (verified on Base/BSC mainnet)
- Cross-chain mode: mainnet by default; `CROSSCHAIN_TESTNET=true` for Coston2ŌåöHyperliquid testnet
- Verified live: Flare (149M supply), Base (47K), BSC (83K), HyperEVM (1.1M)
- Bridge flow: `quoteSend` ŌåÆ approve + `send(sendParam, fee, refundTo)` calldata; `extraOptions` for 200k executor gas

## FTSO Price Integration (Task 4 ŌĆö COMPLETE)
- **FTSO endpoint**: `GET /ftso-price` returns `{ network, feedId, value, timestamp, priceUsd }`
- **XRP/USD feed ID (Coston2)**: `0x015852502f55534400000000000000000000000000` (index 3, category 1)
- Resolution: `FlareContractsRegistry.getContractAddressByName("FtsoV2")` ŌåÆ `FtsoV2.getFeedByIdInWei(feedId)` ŌåÆ 18-decimal price
- Code: `lib/flare-client.ts` `getFtsoPrice()` method; `server/index.ts` `/ftso-price` route
- **Dashboard display**: `fetchFtsoPrice(totalFxrp?)` in `public/dashboard.js`
- **Key fix**: fetch FTSO price on page load (in `init()`), NOT only after portfolio load ŌĆö avoids Coston2 RPC rate-limiting when portfolio queries (7 chains) saturate the provider
- **FTSO reads from Coston2 provider** even when dashboard is in mainnet mode (prices mirror mainnet); acceptable for read-only display
- Dashboard UI: `.src-tag` badge ("FTSO") next to price; `#xrpPrice` shows `$X.XXXX`, `#xrpValue` shows `Ōēł $USD` or `FTSO ┬Ę block N`
- 71/71 tests pass (23 gateway + 48 cross-chain), typecheck OK

## Executor Service (Task 5 ŌĆö COMPLETE)
The executor is the relayer that finalizes FXRP direct mints on Flare. The gateway prepares
unsigned XRPL payments; the executor monitors the XRPL, obtains FDC proofs, and calls
`executeDirectMinting(proof)` / `executeDirectMintingWithData(proof, data)` on AssetManager.

### Architecture
- **`lib/fdc-client.ts`** ŌĆö FDC attestation lifecycle:
  - `prepareXrpPaymentRequest()` ŌåÆ verifier API (`/verifier/xrp/XRPPayment/prepareRequest`)
  - `submitAttestationRequest()` ŌåÆ `FdcHub.requestAttestation(data, {value: fee})` on Flare
  - `waitForFinalization()` ŌåÆ polls `Relay.isFinalized(200, roundId)` (FDC protocol ID = 200)
  - `fetchProof()` ŌåÆ DA Layer (`/api/v1/fdc/proof-by-request-round-raw`)
  - `proofToTuple()` ŌåÆ converts proof to ethers tuple for `executeDirectMinting`
- **`lib/xrpl-monitor.ts`** ŌĆö XRPL payment monitor:
  - `XrplMonitor` class: subscribes to Core Vault account via xrpl.js websocket
  - `classifyMemo()` ŌĆö pure function routing memos to execute modes (plain/0xFF/0xFE/0xE0-E2)
  - `parseCoreVaultPayment()` ŌĆö extracts DetectedPayment from XRPL account_tx
- **`lib/executor.ts`** ŌĆö `Executor` orchestrator class:
  - `processPayment()` ŌĆö full pipeline: detect ŌåÆ FDC request ŌåÆ finalize ŌåÆ proof ŌåÆ execute
  - Journal persistence (JSON file) for crash recovery + idempotency
  - `DirectMintingDelayed` event handling: waits + retries
  - DRY_RUN mode (default): submits FDC request but skips execute broadcast
- **`server/executor.ts`** ŌĆö standalone service entry point with HTTP API:
  - `GET /health` ŌĆö status (executor address, network, dryRun)
  - `GET /journal` ŌĆö processed transactions
  - `POST /process` ŌĆö `{ transactionId }` manual trigger
  - Runs on PORT 12001 (configurable)

### Key Contracts (Coston2)
- AssetManagerFXRP: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FdcHub: `0x48aC463d7975828989331F4De43341627b9c5f1D`
- Relay: `0xa10B672D1c62e5457b17af63d4302add6A99d7dE`
- FdcVerification: `0x906507E0B64bcD494Db73bd0459d1C667e14B933`
- All resolved via `FlareContractsRegistry.getContractAddressByName()`

### Memo Routing
| Memo type | Opcode | Execute mode |
|-----------|--------|-------------|
| Plain direct mint (0x4642505266410018/0021 prefix) | ŌĆö | `executeDirectMinting` |
| Memo-field custom instruction (inline userOp) | 0xFF | `executeDirectMinting` |
| Custom instruction (hash-commit, executor delivers bytes) | 0xFE | `executeDirectMintingWithData` |
| Skip memo (recovery) | 0xE0 | `executeDirectMintingWithData(proof, "0x")` |
| Fast-forward nonce (recovery) | 0xE1 | `executeDirectMintingWithData(proof, "0x")` |
| Replace executor fee | 0xE2 | `executeDirectMinting` |
| No memo + no tag (smart account default) | ŌĆö | `executeDirectMinting` |
| Destination tag (MintingTagManager) | ŌĆö | `executeDirectMinting` |

### Environment Variables
- `EXECUTOR_PRIVATE_KEY` (required) ŌĆö EVM wallet key for gas + attestation fees
- `CORE_VAULT_ADDRESS` (required, or auto-resolved from AssetManager)
- `DRY_RUN` ŌĆö `"false"` to broadcast execute txs (default: `true`)
- `FLARE_NETWORK` ŌĆö coston2 | flare | songbird | coston
- `XRPL_ENDPOINT` ŌĆö XRPL websocket (default: testnet/mainnet by network)
- `JOURNAL_PATH` ŌĆö path to journal JSON (default: `./executor-journal.json`)
- `VERIFIER_API_KEY` ŌĆö FDC verifier API key
- `PROOF_OWNER` ŌĆö EVM address owning proofs (default: executor address)
- `PORT` ŌĆö HTTP port (default: 12001)

### Running
```bash
EXECUTOR_PRIVATE_KEY=0x... CORE_VAULT_ADDRESS=rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p DRY_RUN=true npm run executor
```

### FDC Attestation Flow (XRPPayment, type 0x08)
1. User sends XRP Payment to Core Vault with memo (prepared by gateway)
2. Executor detects via XRPL websocket subscription
3. Executor calls verifier `prepareRequest` with `{ attestationType: "0x08", sourceId: "testXRP", requestBody: { transactionId, proofOwner } }`
4. Verifier returns `abiEncodedRequest` (contains MIC)
5. Executor parses attestationType + sourceId from encoded request, calls `FdcHub.calculateAttestationFee(type, source)` for the fee
6. Executor calls `FdcHub.requestAttestation(encodedRequest, {value: fee})` ŌĆö tx block timestamp determines votingRoundId
7. Executor polls `Relay.isFinalized(200, roundId)` until true (~90-180s)
8. Executor POSTs to DA Layer `{ votingRoundId, requestBytes }` ŌåÆ receives merkleProof + response data
9. Executor calls `AssetManager.executeDirectMinting(proof)` or `executeDirectMintingWithData(proof, data)`
10. If `DirectMintingDelayed` event emitted, waits for `executionAllowedAt` and retries

### Test Coverage (132 total: 23 smoke + 48 crosschain + 61 executor)
Executor tests (`npm run test:executor`):
- Unit: memo classification (10 cases), payment parsing (4 cases), proof decoding (12 cases), journal persistence (2 cases)
- Integration: AssetManager/FdcHub/Relay/FdcVerification resolution, executeDirectMinting selector verification, directMintingDelayState view call, Relay.isFinalized view call
- FDC verifier + DA Layer API reachability (skipped in network-restricted environments)

### Dependencies Added
- `@flarenetwork/flare-periphery-contract-artifacts` (devDependency) ŌĆö typed ABIs for IAssetManager, IXRPPayment, IFdcHub, IRelay, IFdcVerification


## Exchange Redemption Router (Task 6 - COMPLETE)
Exchange-friendly redemption router built on redeemWithTag. Lets users redeem
FXRP directly to their exchange deposit address (with destination tag), removing
the intermediate personal r-address step and custody risk.

### Files
- **lib/exchange-registry.ts** - curated exchange database (Binance, Kraken, Coinbase, Bitstamp, Bybit, OKX, Gate.io) with deposit r-addresses, tag requirements, min deposit thresholds, deposit verification URLs.
  - getExchanges(), getExchange(id), getExchangeByAddress(rAddress)
  - validateRedemption() - returns warnings (min deposit, inactive) + errors (missing tag)
  - isValidXrplAddress(), isValidDestinationTag() - input validation
- **server/index.ts** - 3 new endpoints:
  - GET /exchanges - returns the active exchange registry
  - POST /prepare-redeem - standalone redeem calldata (no mint), with exchange lookup + validation
  - GET /reserves - proof-of-reserves data
- **scripts/exchange-test.ts** - 40 tests (registry, validation, calldata, proof-of-reserves)

### Standalone vs Mint+Redeem
- Standalone (POST /prepare-redeem): user already holds FXRP. Returns redeemWithTag or redeemAmount calldata for EVM wallet signing. No mint involved.
- Mint+Redeem (POST /prepare-payment with redeem_with_tag action): atomic mint then redeem via 0xFF memo. User signs one XRPL payment.

### Dashboard UI Enhancements
- Exchange dropdown in redeem modal (auto-fills deposit r-address)
- Destination tag saved per-exchange in localStorage
- Min deposit warnings + verify-on-exchange links
- Radio toggle: Redeem existing FXRP vs Mint + Redeem

## Proof of Reserves (Task 7 - COMPLETE)
Verifies FXRP is fully backed by XRP locked in the FAssets Core Vault.

### Files
- **lib/proof-of-reserves.ts** - computeProofOfReserves():
  - Reads FXRP ERC-20 totalSupply on Flare (canonical backing obligation)
  - Reads OFT adapter balanceOf(token) (FXRP locked for bridging)
  - Queries XRPL account_info for Core Vault actual XRP balance (via xrpl.js websocket)
  - Fetches per-chain OFT totalSupply across all 7 chains (parallel)
  - Computes backing ratio: vaultBalance / fxrpSupply (>=1.0 = healthy)
  - Returns status: healthy | warning (0.95-1.0) | critical (<0.95) | unknown
- **server/index.ts** - GET /reserves endpoint
- **Dashboard** - Reserves card with 4 stats + omnichain distribution table

### Live Data (Coston2, verified)
- FXRP total supply: 6,140,661 FXRP
- Core Vault XRP balance: 5,704,069 XRP (at rDhpmiPq4BVBDWMV...)
- Backing ratio: 92.89% (critical - expected on testnet)
- Bridged to other chains: 1,201,803 FXRP (Base 0.27%, BNB 1.36%, HyperEVM 17.94%)

### Future Enhancement
Use FDC ConfirmedBlockHeightExists attestations to cryptographically prove the XRPL balance instead of trusting the XRPL API. The FDC client infrastructure exists in lib/fdc-client.ts.

## Omnichain Portfolio Dashboard (portfolio.html — COMPLETE)
- **Files**: `public/portfolio.html` (template + IDs), `public/portfolio.js` (new, ~380 lines)
- **Live**: `/portfolio.html` — replaces all hardcoded demo data with live API data
- **7 endpoints wired**: `/status`, `/chains`, `/portfolio`, `/ftso-price`, `/reserves`, `/executor-status`, `POST /bridge-prepare`
- **5 sections bound**: 4 stat cards (total value, supply, ratio, price), cross-chain table (7 chains), bridge widget (dropdowns + amount + route quote + calldata modal), backing history chart (bars from reserves.chainSupplies), relayer health table
- **Wallet connect**: MetaMask/EVM via `window.ethereum` (EIP-1193), no npm deps; auto-reconnect from localStorage; account-change listener; manual 0x address entry fallback. Xaman stubbed (needs API keys per WALLET_CONNECTION_GUIDE.md)
- **Reserves response fields**: `fxrpTotalSupply`, `coreVaultXrpBalance`, `backingRatio`, `status`, `chainSupplies[]` (used for chart bars), `bridgedTotal`, `coreVaultAddress`
- **Portfolio response fields**: `totalFxrp`, `chains[].chainId/chainName/balance/balanceUba`, `chainsWithBalance`
- Status color logic: ratio ≥1.0 green (healthy), 0.95-1.0 secondary (warning), <0.95 error (critical)
- 60s polling for system data (price/reserves/executor); portfolio loads on wallet connect
- Bridge route: debounced (350ms) POST /bridge-prepare → Est. Receive + native fee in source chain symbol
- Relayer table shows offline state when executor not running (start with `npm run executor`)

## FXRP Mint Gateway (gateway.html — COMPLETE)
- **Files**: `public/gateway.html` (template + IDs), `public/gateway.js` (new, ~310 lines, vanilla JS, no deps)
- **Live**: `/gateway.html` — replaces all hardcoded demo data with live API data
- **6 endpoints wired**: `GET /status`, `GET /personal-account?xrplAddress=`, `POST /quote`, `POST /prepare-payment`, `GET /vaults`, `GET /ftso-price`
- **3 sections bound**: Address Resolver, Action Selector + action-specific fields, Quote & Preparation, Transaction Review (payment JSON + memo hex + calls preview)
- **4 actions supported**: mint_only (plain FBRP memo), transfer (ERC20 transfer to 0x recipient), redeem (assetManager.redeemAmount to r-address), vault_deposit (Firelight/Upshift via vaultId)
- **Smart account flow**: resolve XRPL r-address → `GET /personal-account` returns `{ personalAccount, nonce, fxrpBalance }`. nonce drives the 0xFF memo. mint_only uses plain direct-minting memo (no nonce); all other actions use the 0xFF smart-account memo with nonce + userOp.
- **Quote**: debounced (400ms) `POST /quote { paymentXrp }` → `{ mintingFeeXrp, executorFeeXrp, fxpReceivedXrp }` (null = below minimum). Receive displayed as "Below minimum" when null.
- **Prepare**: `POST /prepare-payment { xrplAddress, amountXrp, action }` → `{ kind, payment (XRPL Payment), memoHex, callsPreview[], note }`. Auto-prepare fires 500ms after resolve+quote+action-fields change. Manual "Prepare Payment" button also available.
- **Memo types**: mint_only memo starts with `46425052` ("FBRP"); mint_and_action memo starts with `ff0000...`. Redeem memo encodes the redeemer r-address as ASCII hex in the call data.
- **Calls preview**: For mint_and_action, shows each Flare call (target address short form + calldata). transfer → FXRP token (0x0b6A...) with `0xa9059cbb` (transfer); redeem → assetManager (0xc1Ca...) with `0x01e261f6` (redeemAmount); vault_deposit → approve + deposit calls.
- **Wallet connect**: XRPL address entry (validated `^r[a-zA-Z0-9]{20,40}$`) via modal; auto-resolve saved address from localStorage on load; Xaman stubbed (needs VITE_XAMAN_API_KEY/SECRET per WALLET_CONNECTION_GUIDE.md). Connect button shows short address after resolve.
- **Clipboard**: Copy buttons for payment JSON + memo hex; "Sign via Wallet" copies the payment JSON for the user to sign in their XRPL wallet (no signing in-browser — read-only data + calldata preparation only).
- **System data**: XRP price badge from `/ftso-price` (30s cache), vault dropdown from `/vaults` (60s cache, shows name + balance).
- **Validation**: EVM address `^0x[a-fA-F0-9]{40}$`, destination tag integer 0..4294967295, positive amounts required.

## FXRP Redeem + Memo Decoder (portfolio.html — COMPLETE)
- **Redeem widget** (left, 8-col): burn existing FXRP → XRP. Two modes via toggle:
  - **Standard**: `POST /prepare-redeem` → EVM calldata (`redeemAmount` / `redeemWithTag`) to sign in MetaMask. Pays Flare gas. Uses connected wallet address as `callerAddress`.
  - **Gasless**: `POST /prepare-gasless-redeem` → 1-drop XRPL Payment to operator with 0xFF redeem-only UserOp. Shows payment JSON + memoHex + note. "Submit to Relayer" button calls `POST /submit-gasless-redeem` (proxies to executor; 503 if executor offline). Requires user's XRPL source address.
- **Exchange picker**: `GET /exchanges` → grid of 5 exchanges (Binance/Kraken/Coinbase/Bitstamp/Bybit) with initials avatar + color + truncated deposit address. Selecting an exchange that `requiresTag` reveals the destination-tag input. "Custom Address" toggle switches to free-text r-address entry (with optional tag). Standard redeem uses `exchangeId`; gasless uses the exchange's `depositAddress` as `destinationAddress`.
- **Validation**: amount > 0; exchange required if in exchange mode; tag required for exchanges that require it; XRPL r-address regex `^r[a-zA-Z0-9]{20,40}$` for custom + gasless source.
- **Result panel**: function sig, target (assetManager/operator), calldata (or memoHex for gasless), XRPL Payment JSON (gasless only), note, warnings. Copy Calldata + Submit to Relayer (gasless only).
- **Memo Decoder widget** (right, 4-col): `POST /decode-memo { memoHex }` → opcode, walletId, executorFeeUba, userOpEncodedLengthBytes, userOpEncoded. Only accepts 0xFF memos (mint_and_action / gasless). Paste a memo hex → inspect the embedded Flare UserOp. Copy UserOp button. Errors shown inline (e.g. "not a memo-field custom instruction: opcode 0x46").
- **5 new endpoints wired**: `/exchanges`, `/prepare-redeem`, `/prepare-gasless-redeem`, `/submit-gasless-redeem`, `/decode-memo`.

## Marketing Landing Page (index.html — COMPLETE)
- Converted from the old gateway demo to a Uber-style product landing page.
- **Hero**: gradient headline "Move XRP across chains. One payment, anywhere.", live stat strip binding `/ftso-price` + `/reserves` (XRP/USD, FXRP supply, chains count, backing ratio).
- **How it works**: 4-step grid (resolve → choose action → quote → sign one payment).
- **Products**: two large route cards — "Mint Gateway" → `/gateway.html`, "Portfolio Dashboard" → `/portfolio.html` — each with feature checklists and hover lift.
- **Features**: 6 paper cards (non-custodial, omnichain/LayerZero, gasless, proof-of-reserves, vault deposits, exchange-ready) with emoji icons, tags, hover animations.
- **CTA band + footer** with links to both products.
- No `app.js` dependency; inline `<script>` for the stat strip. Reuses `styles.css` vars (accent/panel/border).
- Side nav in portfolio.html: "Mint Gateway" link now routes to `/gateway.html`.

## Test Coverage Summary (172 total)
- npm run smoke - 23 tests (memo bytes, quote math, live Coston2 RPC)
- npm run test:crosschain - 48 tests (OFT balances, bridge calldata, LZ fees)
- npm run test:executor - 61 tests (memo routing, FDC proofs, contract resolution)
- npm run test:exchange - 40 tests (exchange registry, redeem calldata, proof-of-reserves)
- npm run test - runs smoke + crosschain + exchange (111 tests)

## FDC Attestation Flow (VERIFIED - commit 1e7d415)
End-to-end FXRP mint via FDC attestation is WORKING on Coston2:
1. Prepare XRPPayment FDC request (attestationType=XRPPayment bytes32, sourceId=testXRP bytes32)
2. Calculate attestation fee via FdcRequestFeeConfigurations contract (NOT FdcHub - it reverts)
3. Submit attestation to FdcHub.requestAttestation (costs 1 wei on Coston2)
4. Calculate voting round: (blockTimestamp - firstVotingRoundStartTs) / 90
   - firstVotingRoundStartTs = 1658430000 (read from FlareSystemsManager via ContractRegistry)
   - CRITICAL: Must subtract firstVotingRoundStartTs! blockTs / 90 gives WRONG round IDs
5. Wait for finalization via Relay.isFinalized(votingRoundId, 200) (FDC protocol ID = 200)
6. Fetch proof from DA Layer: POST {daLayerUrl}/api/v1/fdc/proof-by-request-round-raw
   - DA Layer URL (Coston2): https://ctn2-data-availability.flare.network
   - API key: 00000000-0000-0000-0000-000000000000 (default verifier key)
   - Body: { votingRoundId, requestBytes }
   - Retry needed: DA Layer lags ~10-20s behind on-chain finalization
7. Decode proof: response is { response_hex, attestation_type, proof }
   - response_hex is ABI-encoded full attestation tuple (decode with AbiCoder)
   - proof is the Merkle proof array (bytes32[])
   - attestation_type is bytes32 XRPPayment
8. Call AssetManager.executeDirectMinting(proofTuple) - mints FXRP to recipient

### DA Layer Response Format (CRITICAL)
The DA Layer returns { response_hex, attestation_type, proof }, NOT { merkleProof, data }.

### Contract Addresses (Coston2)
- FlareContractsRegistry: 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
- FdcHub: 0x48aC463d7975828989331F4De43341627b9c5f1D
- Relay: 0xa10B672D1c62e5457b17af63d4302add6A99d7dE
- AssetManagerFXRP: 0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA
- FXRP token (FTestXRP): 0x0b6A3645c240605887a5532109323A3E12273dc7 (decimals=6)

### Common executeDirectMinting Revert Errors
- 0x18dce79f = PaymentAlreadyConfirmed() - XRPL tx already used for a mint


# Flare AI Skills — Repository Memory

## Installed Skills (from flare-foundation/flare-ai-skills)
Location: `.agents/skills/`
- `flare-fassets-skill` — FAssets/FXRP minting, redemption, Core Vault, MintingTagManager
- `flare-ftso-skill` — FTSO price feeds (block-latency ~1.8s)
- `flare-fdc-skill` — Flare Data Connector (attestations, Merkle proofs)
- `flare-smart-accounts-skill` — XRPL→Flare account abstraction (no FLR needed)
- `flare-fcc-skill` — Flare Confidential Compute (TEE)
- `flare-general-skill` — General Flare knowledge, networks, tooling


## FDC Attestation Flow (VERIFIED � commit 1e7d415)
End-to-end FXRP mint via FDC attestation is WORKING on Coston2:
1. Prepare XRPPayment FDC request (attestationType="XRPPayment" bytes32, sourceId="testXRP" bytes32)
2. Calculate attestation fee via `FdcRequestFeeConfigurations` contract (NOT FdcHub � it reverts)
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
8. Call `AssetManager.executeDirectMinting(proofTuple)` � mints FXRP to recipient

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
- `0x18dce79f` = `PaymentAlreadyConfirmed()` � XRPL tx already used for a mint

## Key Technical Facts (FAssets / FXRP / XRP)
- **FAssets**: trustless over-collateralized bridge XRPL/BTC/DOGE → Flare ERC-20 (FXRP, FBTC, FDOGE)
- **FXRP**: ERC-20 representation of XRP on Flare; also deployed as LayerZero OFT (HyperEVM, HyperCore, Ethereum, Base, BSC, Monad, Katana)
- **Standard minting (current)**: single XRPL payment to Core Vault (`AssetManager.directMintingPaymentAddress()`), params in destination tag or memo; executor calls `executeDirectMinting`. Legacy collateral-reservation flow archived.
- **Direct minting memo formats**: 32-byte `0x4642505266410018` + 4 zero bytes + 20-byte recipient; 48-byte `0x4642505266410021` + recipient + executor
- **MintingTagManager**: ERC-721 NFT tags mapping destination tag → recipient/executor; `AssetManager.getMintingTagManager()`
- **Redemption**: `redeem` (lots), `redeemAmount` (arbitrary UBA), `redeemWithTag` (XRP exchange addresses with destination tag)
- **Smart Accounts**: XRPL users interact with Flare without FLR; MasterAccountController; instruction types 0x0_ (FXRP), 0x1_ (Firelight/stXRP), 0x2_ (Upshift)
- **FlareContractsRegistry**: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` (same all networks)
- **Networks**: Flare (14), Coston2 (114), Songbird (19), Coston (16)
- **Fees (Coston2)**: min fee 0.1 XRP, 0.25% minting fee, 0.1 XRP executor fee

## Skill Safety Model
- All skills are **documentation/reference only** — no transaction execution, no key handling
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
- Dashboard at `/dashboard.html` — unified FXRP position view across all OFT chains
- New files: `lib/chains.ts`, `lib/crosschain-client.ts`, `public/dashboard.{html,css,js}`
- New API: `GET /chains`, `GET /portfolio?address=0x...`, `POST /bridge-prepare`
- **FXRP OFT mainnet deployments**: Flare (adapter) 0xd706..., Ethereum/Base/BSC/Monad 0xCE61..., HyperEVM 0xd706..., Katana 0x565f...
- **Coston2 testnet**: OFT adapter 0xCd3d..., Hyperliquid testnet OFT 0x14bf...
- **LayerZero V2 EIDs**: Flare 30295, Ethereum 30101, BSC 30102, Base 30184, HyperEVM 30367, Monad 30390, Katana 30375
- Testnet EIDs: Coston2 40294, Hyperliquid testnet 40362
- FXRP decimals = 6 (verified on Base/BSC mainnet)
- Cross-chain mode: mainnet by default; `CROSSCHAIN_TESTNET=true` for Coston2↔Hyperliquid testnet
- Verified live: Flare (149M supply), Base (47K), BSC (83K), HyperEVM (1.1M)
- Bridge flow: `quoteSend` → approve + `send(sendParam, fee, refundTo)` calldata; `extraOptions` for 200k executor gas

## FTSO Price Integration (Task 4 — COMPLETE)
- **FTSO endpoint**: `GET /ftso-price` returns `{ network, feedId, value, timestamp, priceUsd }`
- **XRP/USD feed ID (Coston2)**: `0x015852502f55534400000000000000000000000000` (index 3, category 1)
- Resolution: `FlareContractsRegistry.getContractAddressByName("FtsoV2")` → `FtsoV2.getFeedByIdInWei(feedId)` → 18-decimal price
- Code: `lib/flare-client.ts` `getFtsoPrice()` method; `server/index.ts` `/ftso-price` route
- **Dashboard display**: `fetchFtsoPrice(totalFxrp?)` in `public/dashboard.js`
- **Key fix**: fetch FTSO price on page load (in `init()`), NOT only after portfolio load — avoids Coston2 RPC rate-limiting when portfolio queries (7 chains) saturate the provider
- **FTSO reads from Coston2 provider** even when dashboard is in mainnet mode (prices mirror mainnet); acceptable for read-only display
- Dashboard UI: `.src-tag` badge ("FTSO") next to price; `#xrpPrice` shows `$X.XXXX`, `#xrpValue` shows `≈ $USD` or `FTSO · block N`
- 71/71 tests pass (23 gateway + 48 cross-chain), typecheck OK

## Executor Service (Task 5 — COMPLETE)
The executor is the relayer that finalizes FXRP direct mints on Flare. The gateway prepares
unsigned XRPL payments; the executor monitors the XRPL, obtains FDC proofs, and calls
`executeDirectMinting(proof)` / `executeDirectMintingWithData(proof, data)` on AssetManager.

### Architecture
- **`lib/fdc-client.ts`** — FDC attestation lifecycle:
  - `prepareXrpPaymentRequest()` → verifier API (`/verifier/xrp/XRPPayment/prepareRequest`)
  - `submitAttestationRequest()` → `FdcHub.requestAttestation(data, {value: fee})` on Flare
  - `waitForFinalization()` → polls `Relay.isFinalized(200, roundId)` (FDC protocol ID = 200)
  - `fetchProof()` → DA Layer (`/api/v1/fdc/proof-by-request-round-raw`)
  - `proofToTuple()` → converts proof to ethers tuple for `executeDirectMinting`
- **`lib/xrpl-monitor.ts`** — XRPL payment monitor:
  - `XrplMonitor` class: subscribes to Core Vault account via xrpl.js websocket
  - `classifyMemo()` — pure function routing memos to execute modes (plain/0xFF/0xFE/0xE0-E2)
  - `parseCoreVaultPayment()` — extracts DetectedPayment from XRPL account_tx
- **`lib/executor.ts`** — `Executor` orchestrator class:
  - `processPayment()` — full pipeline: detect → FDC request → finalize → proof → execute
  - Journal persistence (JSON file) for crash recovery + idempotency
  - `DirectMintingDelayed` event handling: waits + retries
  - DRY_RUN mode (default): submits FDC request but skips execute broadcast
- **`server/executor.ts`** — standalone service entry point with HTTP API:
  - `GET /health` — status (executor address, network, dryRun)
  - `GET /journal` — processed transactions
  - `POST /process` — `{ transactionId }` manual trigger
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
| Plain direct mint (0x4642505266410018/0021 prefix) | — | `executeDirectMinting` |
| Memo-field custom instruction (inline userOp) | 0xFF | `executeDirectMinting` |
| Custom instruction (hash-commit, executor delivers bytes) | 0xFE | `executeDirectMintingWithData` |
| Skip memo (recovery) | 0xE0 | `executeDirectMintingWithData(proof, "0x")` |
| Fast-forward nonce (recovery) | 0xE1 | `executeDirectMintingWithData(proof, "0x")` |
| Replace executor fee | 0xE2 | `executeDirectMinting` |
| No memo + no tag (smart account default) | — | `executeDirectMinting` |
| Destination tag (MintingTagManager) | — | `executeDirectMinting` |

### Environment Variables
- `EXECUTOR_PRIVATE_KEY` (required) — EVM wallet key for gas + attestation fees
- `CORE_VAULT_ADDRESS` (required, or auto-resolved from AssetManager)
- `DRY_RUN` — `"false"` to broadcast execute txs (default: `true`)
- `FLARE_NETWORK` — coston2 | flare | songbird | coston
- `XRPL_ENDPOINT` — XRPL websocket (default: testnet/mainnet by network)
- `JOURNAL_PATH` — path to journal JSON (default: `./executor-journal.json`)
- `VERIFIER_API_KEY` — FDC verifier API key
- `PROOF_OWNER` — EVM address owning proofs (default: executor address)
- `PORT` — HTTP port (default: 12001)

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
6. Executor calls `FdcHub.requestAttestation(encodedRequest, {value: fee})` — tx block timestamp determines votingRoundId
7. Executor polls `Relay.isFinalized(200, roundId)` until true (~90-180s)
8. Executor POSTs to DA Layer `{ votingRoundId, requestBytes }` → receives merkleProof + response data
9. Executor calls `AssetManager.executeDirectMinting(proof)` or `executeDirectMintingWithData(proof, data)`
10. If `DirectMintingDelayed` event emitted, waits for `executionAllowedAt` and retries

### Test Coverage (132 total: 23 smoke + 48 crosschain + 61 executor)
Executor tests (`npm run test:executor`):
- Unit: memo classification (10 cases), payment parsing (4 cases), proof decoding (12 cases), journal persistence (2 cases)
- Integration: AssetManager/FdcHub/Relay/FdcVerification resolution, executeDirectMinting selector verification, directMintingDelayState view call, Relay.isFinalized view call
- FDC verifier + DA Layer API reachability (skipped in network-restricted environments)

### Dependencies Added
- `@flarenetwork/flare-periphery-contract-artifacts` (devDependency) — typed ABIs for IAssetManager, IXRPPayment, IFdcHub, IRelay, IFdcVerification


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


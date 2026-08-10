/**
 * Cross-chain FXRP registry.
 *
 * FXRP is deployed as a LayerZero OFT (Omnichain Fungible Token) across
 * multiple chains. On Flare it uses an OFT Adapter (locks tokens); on
 * destination chains it is a native OFT (mint/burn). Supply is unified.
 *
 * Sources: https://dev.flare.network/fxrp/oft (deployments table)
 *          @layerzerolabs/lz-definitions (EndpointId enum)
 */

export interface ChainConfig {
  id: string;            // short identifier used in URLs / API
  name: string;          // display name
  chainId: number;       // EVM chain id
  lzEid: number;         // LayerZero V2 endpoint id
  rpc: string;           // public RPC
  oftAddress: string;    // FXRP OFT (or OFT Adapter on Flare) address
  isAdapter: boolean;    // true on Flare (locks rather than mints)
  explorer: string;      // block explorer base URL
  logoColor: string;     // for UI badge
  nativeSymbol: string;  // native gas token symbol
  /** True when the chain has a confirmed public RPC that responds to eth_call. */
  available: boolean;
}

/** Mainnet chains where FXRP is deployed as an OFT. */
export const MAINNET_CHAINS: ChainConfig[] = [
  {
    id: "flare",
    name: "Flare",
    chainId: 14,
    lzEid: 30295,
    rpc: "https://flare-api.flare.network/ext/C/rpc",
    oftAddress: "0xd70659a6396285BF7214d7Ea9673184e7C72E07E",
    isAdapter: true,
    explorer: "https://flarescan.com",
    logoColor: "#f4a742",
    nativeSymbol: "FLR",
    available: true,
  },
  {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    lzEid: 30101,
    rpc: "https://cloudflare-eth.com",
    oftAddress: "0xCE6170EA245dC8D1f275A710a062b70f125F0110",
    isAdapter: false,
    explorer: "https://etherscan.io",
    logoColor: "#627eea",
    nativeSymbol: "ETH",
    available: true,
  },
  {
    id: "base",
    name: "Base",
    chainId: 8453,
    lzEid: 30184,
    rpc: "https://mainnet.base.org",
    oftAddress: "0xCE6170EA245dC8D1f275A710a062b70f125F0110",
    isAdapter: false,
    explorer: "https://basescan.org",
    logoColor: "#0052ff",
    nativeSymbol: "ETH",
    available: true,
  },
  {
    id: "bsc",
    name: "BNB Chain",
    chainId: 56,
    lzEid: 30102,
    rpc: "https://bsc-dataseed.bnbchain.org",
    oftAddress: "0xCE6170EA245dC8D1f275A710a062b70f125F0110",
    isAdapter: false,
    explorer: "https://bscscan.com",
    logoColor: "#f0b90b",
    nativeSymbol: "BNB",
    available: true,
  },
  {
    id: "hyperevm",
    name: "HyperEVM",
    chainId: 999,
    lzEid: 30367,
    rpc: "https://hyperliquid.drpc.org",
    oftAddress: "0xd70659a6396285BF7214d7Ea9673184e7C72E07E",
    isAdapter: false,
    explorer: "https://hyperevmscan.com",
    logoColor: "#50d2c1",
    nativeSymbol: "HYPE",
    available: true,
  },
  {
    id: "monad",
    name: "Monad",
    chainId: 10101010,
    lzEid: 30390,
    rpc: "https://testnet-rpc.monadlabs.com",
    oftAddress: "0xCE6170EA245dC8D1f275A710a062b70f125F0110",
    isAdapter: false,
    explorer: "https://monadexplorer.com",
    logoColor: "#836ef9",
    nativeSymbol: "MON",
    available: false, // public RPC not stable yet
  },
  {
    id: "katana",
    name: "Katana",
    chainId: 747474,
    lzEid: 30375,
    rpc: "https://rpc.katana.network",
    oftAddress: "0x565f9415b9c285c03c008e73088148f28d218059",
    isAdapter: false,
    explorer: "https://katana.explorer.plumenetwork.xyz",
    logoColor: "#b84747",
    nativeSymbol: "ETH",
    available: false, // RPC may require auth
  },
];

/** Coston2 testnet chains (for testing bridge flows). */
export const TESTNET_CHAINS: ChainConfig[] = [
  {
    id: "coston2",
    name: "Flare Coston2",
    chainId: 114,
    lzEid: 40294,
    rpc: "https://coston2-api.flare.network/ext/C/rpc",
    oftAddress: "0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639",
    isAdapter: true,
    explorer: "https://coston2.totlescan.com",
    logoColor: "#f4a742",
    nativeSymbol: "C2FLR",
    available: true,
  },
  {
    id: "hyperliquid-testnet",
    name: "Hyperliquid Testnet",
    chainId: 998,
    lzEid: 40362,
    rpc: "https://rpc.hyperliquid-testnet.xyz",
    oftAddress: "0x14bfb521e318fc3d5e92A8462C65079BC7d4284c",
    isAdapter: false,
    explorer: "https://testnet.purrsec.com",
    logoColor: "#50d2c1",
    nativeSymbol: "HYPE",
    available: true,
  },
];

export function getChains(useTestnet: boolean): ChainConfig[] {
  return useTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
}

export function getChain(id: string, useTestnet: boolean): ChainConfig | undefined {
  return getChains(useTestnet).find((c) => c.id === id);
}

export const FXRP_DECIMALS = 6;

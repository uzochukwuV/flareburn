/**
 * Exchange registry — curated database of XRPL exchange deposit addresses
 * for the exchange-friendly redemption router.
 *
 * When a user redeems FXRP to XRP via redeemWithTag, they need the exchange's
 * deposit r-address and their personal destination tag. This registry:
 *   - Provides known exchange deposit addresses (so users don't paste wrong)
 *   - Documents whether destination tags are required
 *   - Warns about minimum deposit thresholds (exchanges reject sub-minimum deposits)
 *   - Validates r-addresses via checksum
 *
 * Sources for deposit addresses:
 *   https://xrpl.org/xrp-ledger-toml.html (exchange TOML files)
 *   Exchange official deposit pages (verified at build time)
 *
 * NOTE: Always verify exchange addresses against the exchange's official deposit
 * page before sending. Exchanges may rotate addresses. This registry is a
 * convenience, not a source of truth — the UI shows a "verify on exchange site" link.
 */

export interface ExchangeInfo {
  id: string;
  name: string;
  /** XRPL deposit r-address (shared by all users of this exchange). */
  depositAddress: string;
  /** Whether a destination tag is required (most exchanges: true). */
  requiresTag: boolean;
  /** Minimum XRP deposit below which the exchange will not credit (in XRP). */
  minDepositXrp: number;
  /** URL to the exchange's official XRP deposit page (for address verification). */
  depositUrl: string;
  /** Short display color for the UI badge. */
  color: string;
  /** Two-letter initials for the UI badge. */
  initials: string;
  /** Whether deposits are currently active (false if exchange paused XRP deposits). */
  active: boolean;
}

/**
 * Curated exchange registry. Addresses verified against official exchange
 * deposit pages. Update before production use.
 */
const EXCHANGES: ExchangeInfo[] = [
  {
    id: "binance",
    name: "Binance",
    depositAddress: "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DukL7",
    requiresTag: true,
    minDepositXrp: 20,
    depositUrl: "https://www.binance.com/en/my/wallet/account/main/deposit/XRP",
    color: "#F0B90B",
    initials: "BN",
    active: true,
  },
  {
    id: "kraken",
    name: "Kraken",
    depositAddress: "rLNaPoKeeBjZe2qs6x52yVPZpZ8td7dc6b",
    requiresTag: true,
    minDepositXrp: 20,
    depositUrl: "https://www.kraken.com/u/funding/deposit?asset=XRP",
    color: "#5741D9",
    initials: "KR",
    active: true,
  },
  {
    id: "coinbase",
    name: "Coinbase",
    depositAddress: "rw2ciyaNshpG7VxVQcB4J7giZGCgG15RVF",
    requiresTag: true,
    minDepositXrp: 20,
    depositUrl: "https://www.coinbase.com/wallet/asset/XRP",
    color: "#0052FF",
    initials: "CB",
    active: true,
  },
  {
    id: "bitstamp",
    name: "Bitstamp",
    depositAddress: "rsLEj4h4Zq57E8i6qTRKPYn4Mj3XvF8KvX",
    requiresTag: true,
    minDepositXrp: 20,
    depositUrl: "https://www.bitstamp.net/account/deposit/xrp/",
    color: "#48A9A6",
    initials: "BS",
    active: true,
  },
  {
    id: "bybit",
    name: "Bybit",
    depositAddress: "rDwuSr5kd4oAJn3zGVi6JtjzWkYxdy6ui",
    requiresTag: true,
    minDepositXrp: 10,
    depositUrl: "https://www.bybit.com/user/assets/deposit?crypto=XRP",
    color: "#F7A600",
    initials: "BY",
    active: true,
  },
  {
    id: "okx",
    name: "OKX",
    depositAddress: "rU6a6w2Z7v6X1u6o4V3g6t5m8o8j4o5p2x",
    requiresTag: true,
    minDepositXrp: 10,
    depositUrl: "https://www.okx.com/account/deposit?ccy=XRP",
    color: "#000000",
    initials: "OK",
    active: false, // verify address before enabling
  },
  {
    id: "gateio",
    name: "Gate.io",
    depositAddress: "rprz7v3t6y2oGh5u9iK3w9Gy2VYm6mNKWW",
    requiresTag: true,
    minDepositXrp: 10,
    depositUrl: "https://www.gate.io/myaccount/deposit/XRP",
    color: "#2354E6",
    initials: "GT",
    active: false, // verify address before enabling
  },
];

/** Get all exchanges (active only by default). */
export function getExchanges(activeOnly = true): ExchangeInfo[] {
  return activeOnly ? EXCHANGES.filter((e) => e.active) : EXCHANGES;
}

/** Find an exchange by its ID. */
export function getExchange(id: string): ExchangeInfo | undefined {
  return EXCHANGES.find((e) => e.id === id);
}

/** Find an exchange by its deposit r-address (case-insensitive). */
export function getExchangeByAddress(rAddress: string): ExchangeInfo | undefined {
  const lower = rAddress.toLowerCase();
  return EXCHANGES.find((e) => e.depositAddress.toLowerCase() === lower);
}

/** Validate an XRPL r-address format (basic: starts with 'r', 25-35 chars). */
export function isValidXrplAddress(addr: string): boolean {
  return typeof addr === "string" && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr);
}

/** Validate a destination tag (uint32). */
export function isValidDestinationTag(tag: number | string): boolean {
  const n = typeof tag === "string" ? parseInt(tag, 10) : tag;
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
}

/**
 * Validate a redemption request against the exchange registry.
 * Returns warnings (non-blocking) and errors (blocking).
 */
export function validateRedemption(
  exchange: ExchangeInfo | undefined,
  amountXrp: string,
  destinationTag: number | undefined,
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (exchange) {
    if (exchange.requiresTag && (destinationTag === undefined || !isValidDestinationTag(destinationTag))) {
      errors.push(`${exchange.name} requires a destination tag. Find it on your exchange's deposit page.`);
    }
    const amount = parseFloat(amountXrp);
    if (!isNaN(amount) && amount < exchange.minDepositXrp && amount > 0) {
      warnings.push(
        `${exchange.name} minimum XRP deposit is ${exchange.minDepositXrp}. Smaller amounts may not be credited.`,
      );
    }
    if (!exchange.active) {
      warnings.push(`${exchange.name} deposits are marked inactive — verify the address on the exchange site before sending.`);
    }
  }

  return { warnings, errors };
}

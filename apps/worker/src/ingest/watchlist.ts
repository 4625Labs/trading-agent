/** Seed watchlist: search queries per asset, and preferred source domains (used to seed sources.weight). */
export const WATCHLIST_QUERIES: { asset: string; query: string }[] = [
  { asset: "BTC", query: "bitcoin BTC price news analysis" },
  { asset: "ETH", query: "ethereum ETH price news analysis" },
  { asset: "SOL", query: "solana SOL price news analysis" },
];
export const SEED_SOURCES: { domain: string; weight: number }[] = [
  { domain: "coindesk.com", weight: 1.2 },
  { domain: "theblock.co", weight: 1.2 },
  { domain: "cointelegraph.com", weight: 1.0 },
  { domain: "decrypt.co", weight: 1.0 },
];

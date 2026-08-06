import YahooFinance from "yahoo-finance2";

interface ChartPoint {
  date: Date;
  close: number | null;
  volume: number | null;
}

// v4 exporta a classe, não uma instância pronta.
const yahooFinance = new YahooFinance();

export const TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"] as const;
export type Ticker = (typeof TICKERS)[number];

function assertTicker(ticker: string): asserts ticker is Ticker {
  if (!TICKERS.includes(ticker.toUpperCase() as Ticker)) {
    throw new Error(`Ticker não suportado: ${ticker}. Use um de: ${TICKERS.join(", ")}`);
  }
}

// Cache in-memory simples (TTL 10min) — evita 429 do Yahoo em picos de tráfego,
// item recomendado na validação de spec de 2026-08-06.
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const TTL_MS = 10 * 60 * 1000;

async function withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data as T;
  const data = await fn();
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
  return data;
}

export async function getQuote(ticker: string) {
  assertTicker(ticker);
  const symbol = ticker.toUpperCase();
  return withCache(`quote:${symbol}`, async () => {
    const q = await yahooFinance.quote(symbol);
    return {
      symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
      previousClose: q.regularMarketPreviousClose,
      dayHigh: q.regularMarketDayHigh,
      dayLow: q.regularMarketDayLow,
      volume: q.regularMarketVolume,
      currency: q.currency,
      marketState: q.marketState,
      asOf: new Date().toISOString(),
    };
  });
}

export async function getHistory(ticker: string, range: string = "1y") {
  assertTicker(ticker);
  const symbol = ticker.toUpperCase();
  return withCache(`history:${symbol}:${range}`, async () => {
    const period1 = rangeToDate(range);
    const result = await yahooFinance.chart(symbol, { period1, interval: "1d" });
    return {
      symbol,
      range,
      points: (result.quotes ?? []).map((p: ChartPoint) => ({
        date: p.date,
        close: p.close,
        volume: p.volume,
      })),
    };
  });
}

export async function getOverview(ticker: string) {
  assertTicker(ticker);
  const symbol = ticker.toUpperCase();
  return withCache(`overview:${symbol}`, async () => {
    const result = await yahooFinance.quoteSummary(symbol, {
      modules: ["summaryDetail", "defaultKeyStatistics", "price"],
    });
    return {
      symbol,
      marketCap: result.price?.marketCap,
      peRatio: result.summaryDetail?.trailingPE,
      forwardPE: result.summaryDetail?.forwardPE,
      dividendYield: result.summaryDetail?.dividendYield,
      fiftyTwoWeekHigh: result.summaryDetail?.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: result.summaryDetail?.fiftyTwoWeekLow,
      beta: result.defaultKeyStatistics?.beta,
      shortName: result.price?.shortName,
    };
  });
}

function rangeToDate(range: string): Date {
  const now = new Date();
  const map: Record<string, number> = {
    "1mo": 30,
    "3mo": 90,
    "6mo": 182,
    "1y": 365,
    "5y": 365 * 5,
  };
  const days = map[range] ?? 365;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

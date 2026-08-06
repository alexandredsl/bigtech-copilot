export type Ticker = 'AAPL' | 'MSFT' | 'GOOGL' | 'AMZN' | 'META' | 'NVDA' | 'TSLA';

export interface Quote {
  symbol: Ticker;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  currency: string | null;
  marketState: string | null;
  asOf: string;
}

export interface Overview {
  symbol: Ticker;
  marketCap: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  beta: number | null;
  shortName: string | null;
}

export interface HistoryPoint {
  date: string;
  close: number | null;
  volume: number | null;
}

export interface History {
  symbol: Ticker;
  range: string;
  points: HistoryPoint[];
}

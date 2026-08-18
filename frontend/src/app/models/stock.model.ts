export type Ticker = 'AAPL' | 'MSFT' | 'GOOGL' | 'AMZN' | 'META' | 'NVDA' | 'TSLA';

export const TICKERS: Ticker[] = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];

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
  source: string;
  asOf: string;
}

export interface Overview {
  symbol: Ticker;
  source: string;
  asOf: string;
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

export type Range = '1mo' | '3mo' | '6mo' | '1y' | '5y';

export const RANGES: { value: Range; label: string; full: string }[] = [
  { value: '1mo', label: '1M', full: '1 mês' },
  { value: '3mo', label: '3M', full: '3 meses' },
  { value: '6mo', label: '6M', full: '6 meses' },
  { value: '1y', label: '1A', full: '1 ano' },
  { value: '5y', label: '5A', full: '5 anos' }
];

export const TICKER_META: Record<Ticker, { name: string; color: string }> = {
  AAPL: { name: 'Apple', color: '#7aa2ff' },
  MSFT: { name: 'Microsoft', color: '#3ddc97' },
  GOOGL: { name: 'Alphabet', color: '#f6c453' },
  AMZN: { name: 'Amazon', color: '#ff9f6e' },
  META: { name: 'Meta', color: '#a78bfa' },
  NVDA: { name: 'NVIDIA', color: '#8ee06a' },
  TSLA: { name: 'Tesla', color: '#ff7ab6' }
};

const MARKET_STATE_LABELS: Record<string, string> = {
  PREPRE: 'Antes do pré-mercado',
  PRE: 'Pré-mercado',
  REGULAR: 'Mercado aberto',
  POST: 'Pós-mercado',
  POSTPOST: 'Pós-mercado',
  CLOSED: 'Fechado'
};

export function marketStateLabel(state: string | null | undefined): string {
  if (!state) return '—';
  return MARKET_STATE_LABELS[state] ?? state;
}

export function isMarketLive(state: string | null | undefined): boolean {
  return state === 'REGULAR' || state === 'PRE' || state === 'POST' || state === 'POSTPOST';
}

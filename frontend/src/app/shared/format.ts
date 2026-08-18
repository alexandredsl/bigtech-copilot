const usd = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtMoney(value: number | null | undefined): string {
  return value == null ? '—' : usd.format(value);
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${decimal.format(Math.abs(value))}%`;
}

export function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${usd.format(Math.abs(value))}`;
}

/** Market cap e volume em escala curta pt-BR (bi / tri). */
export function fmtCompact(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `US$ ${decimal.format(value / 1e12)} tri`;
  if (abs >= 1e9) return `US$ ${decimal.format(value / 1e9)} bi`;
  if (abs >= 1e6) return `US$ ${decimal.format(value / 1e6)} mi`;
  return usd.format(value);
}

export function fmtCount(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${decimal.format(value / 1e9)} bi`;
  if (abs >= 1e6) return `${decimal.format(value / 1e6)} mi`;
  if (abs >= 1e3) return `${decimal.format(value / 1e3)} mil`;
  return new Intl.NumberFormat('pt-BR').format(value);
}

export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** "agora", "há 12 s", "há 3 min" — usado no selo de frescor do dado. */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `há ${hours} h`;
}

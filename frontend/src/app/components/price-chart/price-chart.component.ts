import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Input, OnChanges, OnInit, SimpleChanges, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartConfiguration, ScriptableContext } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { MarketService } from '../../services/market.service';
import { HistoryPoint, RANGES, Range, TICKER_META, Ticker } from '../../models/stock.model';
import { fmtMoney, fmtPercent } from '../../shared/format';

@Component({
  selector: 'app-price-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './price-chart.component.html',
  styleUrl: './price-chart.component.scss'
})
export class PriceChartComponent implements OnInit, OnChanges {
  @Input({ required: true }) ticker!: Ticker;

  private readonly market = inject(MarketService);
  private readonly destroyRef = inject(DestroyRef);

  readonly ranges = RANGES;
  readonly range = signal<Range>('1y');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly points = signal<HistoryPoint[]>([]);

  // Método, não computed(): `ticker` é @Input comum (não signal), então um
  // computed cacharia o primeiro valor e nunca reagiria à troca de papel.
  meta(): { name: string; color: string } {
    return TICKER_META[this.ticker];
  }
  readonly rangeLabel = computed(() => RANGES.find((r) => r.value === this.range())?.full ?? '');

  /** Variação da série inteira: fecha do último ponto contra o primeiro. */
  readonly delta = computed(() => {
    const closes = this.points()
      .map((p) => p.close)
      .filter((c): c is number => c != null);
    if (closes.length < 2) return null;
    const first = closes[0];
    const last = closes[closes.length - 1];
    return { abs: last - first, pct: ((last - first) / first) * 100, first, last };
  });

  readonly extremes = computed(() => {
    const closes = this.points()
      .map((p) => p.close)
      .filter((c): c is number => c != null);
    if (!closes.length) return null;
    return { min: Math.min(...closes), max: Math.max(...closes) };
  });

  readonly isUp = computed(() => (this.delta()?.abs ?? 0) >= 0);
  readonly money = fmtMoney;
  readonly percent = fmtPercent;

  chartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  chartOptions: ChartConfiguration<'line'>['options'] = this.buildOptions();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ticker'] && !changes['ticker'].firstChange) this.load();
  }

  ngOnInit(): void {
    this.load();

    // Refresh manual (tecla R / botão da barra) recarrega também a série.
    this.market
      .pulse(10 * 60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(true));
  }

  setRange(range: Range): void {
    if (range === this.range()) return;
    this.range.set(range);
    this.load();
  }

  load(silent = false): void {
    if (!silent) {
      this.loading.set(true);
      this.error.set(null);
    }

    this.market
      .getHistory(this.ticker, this.range())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (history) => {
          this.points.set(history.points);
          this.chartData = this.buildData(history.points);
          this.chartOptions = this.buildOptions();
          this.loading.set(false);
          this.error.set(null);
        },
        error: (err) => {
          if (silent) return;
          this.error.set(err?.error?.error ?? 'Não consegui carregar o histórico agora.');
          this.loading.set(false);
        }
      });
  }

  private buildData(points: HistoryPoint[]): ChartConfiguration<'line'>['data'] {
    const color = this.meta().color;
    const labels = points.map((p) => this.labelFor(p.date));

    return {
      labels,
      datasets: [
        {
          data: points.map((p) => p.close ?? null),
          label: this.ticker,
          borderColor: color,
          borderWidth: 1.75,
          tension: 0.22,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: '#0b0c0e',
          pointHoverBorderColor: color,
          fill: true,
          // Gradiente preso à área do gráfico: precisa do contexto do canvas.
          backgroundColor: (ctx: ScriptableContext<'line'>) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return 'transparent';
            const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            gradient.addColorStop(0, this.withAlpha(color, 0.28));
            gradient.addColorStop(1, this.withAlpha(color, 0));
            return gradient;
          }
        }
      ]
    };
  }

  private labelFor(date: string): string {
    const d = new Date(date);
    const range = this.range();
    if (range === '1mo' || range === '3mo') {
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    }
    if (range === '5y') {
      return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
    }
    return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  }

  private withAlpha(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private buildOptions(): ChartConfiguration<'line'>['options'] {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#171a1f',
          borderColor: '#333941',
          borderWidth: 1,
          titleColor: '#a7aeb9',
          bodyColor: '#e9ebee',
          padding: 10,
          displayColors: false,
          titleFont: { family: 'IBM Plex Sans, sans-serif', size: 11, weight: 'normal' },
          bodyFont: { family: 'IBM Plex Sans, sans-serif', size: 13, weight: 600 },
          callbacks: {
            label: (item) => fmtMoney(item.parsed.y)
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#7d848f',
            font: { family: 'IBM Plex Sans, sans-serif', size: 10 },
            maxRotation: 0,
            autoSkipPadding: 28
          },
          grid: { display: false },
          border: { color: '#23272d' }
        },
        y: {
          position: 'right',
          ticks: {
            color: '#7d848f',
            font: { family: 'IBM Plex Sans, sans-serif', size: 10 },
            maxTicksLimit: 5,
            callback: (value) => `US$ ${Number(value).toFixed(0)}`
          },
          grid: { color: 'rgba(35, 39, 45, 0.85)' },
          border: { display: false }
        }
      }
    };
  }
}

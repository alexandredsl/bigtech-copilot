import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarketService } from '../../services/market.service';
import { Overview, Quote, TICKER_META, Ticker, marketStateLabel } from '../../models/stock.model';
import { fmtAgo, fmtClock, fmtCompact, fmtMoney, fmtNumber, fmtPercent, fmtSignedMoney } from '../../shared/format';

@Component({
  selector: 'app-stock-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stock-card.component.html',
  styleUrl: './stock-card.component.scss'
})
export class StockCardComponent implements OnInit {
  @Input({ required: true }) ticker!: Ticker;
  @Input() selected = false;
  @Output() select = new EventEmitter<Ticker>();

  private readonly market = inject(MarketService);
  private readonly destroyRef = inject(DestroyRef);

  readonly quote = signal<Quote | null>(null);
  readonly overview = signal<Overview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly flash = signal<'up' | 'down' | null>(null);
  readonly now = signal(Date.now());

  // Método, não computed(): `ticker` é @Input comum (não signal), então um
  // computed cacharia o primeiro valor e nunca reagiria à troca de papel.
  meta(): { name: string; color: string } {
    return TICKER_META[this.ticker];
  }
  readonly isUp = computed(() => (this.quote()?.change ?? 0) >= 0);
  readonly stateLabel = computed(() => marketStateLabel(this.quote()?.marketState));
  readonly isOpen = computed(() => this.quote()?.marketState === 'REGULAR');
  readonly ago = computed(() => fmtAgo(this.quote()?.asOf, this.now()));

  /** Onde o preço está dentro da faixa do dia, em %. */
  readonly dayPosition = computed(() => {
    const q = this.quote();
    if (!q || q.price == null || q.dayLow == null || q.dayHigh == null || q.dayHigh <= q.dayLow) return null;
    return Math.min(100, Math.max(0, ((q.price - q.dayLow) / (q.dayHigh - q.dayLow)) * 100));
  });

  /** Onde o preço está dentro da faixa de 52 semanas, em %. */
  readonly rangePosition = computed(() => {
    const price = this.quote()?.price;
    const low = this.overview()?.fiftyTwoWeekLow;
    const high = this.overview()?.fiftyTwoWeekHigh;
    if (price == null || low == null || high == null || high <= low) return null;
    return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  });

  readonly money = fmtMoney;
  readonly signedMoney = fmtSignedMoney;
  readonly percent = fmtPercent;
  readonly compact = fmtCompact;
  readonly num = fmtNumber;
  readonly clock = fmtClock;

  ngOnInit(): void {
    this.loadOverview();

    this.market
      .liveQuote(this.ticker)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) => {
          const previous = this.quote()?.price;
          if (previous != null && quote.price != null && quote.price !== previous) {
            this.flash.set(quote.price > previous ? 'up' : 'down');
            setTimeout(() => this.flash.set(null), 900);
          }
          this.quote.set(quote);
          this.loading.set(false);
          this.error.set(null);
        },
        error: (err) => {
          this.error.set(err?.error?.error ?? 'Não consegui buscar a cotação.');
          this.loading.set(false);
        }
      });

    const clock = setInterval(() => this.now.set(Date.now()), 5_000);
    this.destroyRef.onDestroy(() => clearInterval(clock));
  }

  retry(event: Event): void {
    event.stopPropagation();
    this.error.set(null);
    this.loading.set(true);
    this.loadOverview();
    this.market.refreshAll();
  }

  private loadOverview(): void {
    this.market
      .getOverview(this.ticker)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (overview) => this.overview.set(overview),
        error: () => undefined
      });
  }
}

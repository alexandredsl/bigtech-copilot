import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { PriceChartComponent } from './components/price-chart/price-chart.component';
import { ChatPanelComponent } from './components/chat-panel/chat-panel.component';
import { TICKERS, Ticker, isMarketLive, marketStateLabel } from './models/stock.model';
import { MarketService } from './services/market.service';
import { fmtAgo } from './shared/format';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StockCardComponent, PriceChartComponent, ChatPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  private readonly market = inject(MarketService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tickers = TICKERS;
  readonly chartTicker = signal<Ticker>('AAPL');

  readonly marketState = signal<string | null>(null);
  readonly lastSync = signal<string | null>(null);
  readonly syncFailed = signal(false);
  readonly now = signal(Date.now());
  readonly chatOpen = signal(false);

  readonly stateLabel = computed(() => marketStateLabel(this.marketState()));
  readonly live = computed(() => isMarketLive(this.marketState()));
  readonly agoLabel = computed(() => fmtAgo(this.lastSync(), this.now()));

  ngOnInit(): void {
    // O estado de pregão da barra vem do mesmo dado dos cards — sem relógio
    // paralelo dizendo "aberto" enquanto o Yahoo diz o contrário.
    this.market
      .liveQuote('AAPL')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) => {
          this.marketState.set(quote.marketState);
          this.lastSync.set(quote.asOf);
          this.syncFailed.set(false);
        },
        error: () => this.syncFailed.set(true)
      });

    const clock = setInterval(() => this.now.set(Date.now()), 5_000);
    this.destroyRef.onDestroy(() => clearInterval(clock));
  }

  selectTicker(ticker: Ticker): void {
    this.chartTicker.set(ticker);
  }

  refresh(): void {
    this.market.refreshAll();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, [contenteditable="true"]');

    if (event.key === 'Escape' && this.chatOpen()) {
      this.chatOpen.set(false);
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'r') {
      event.preventDefault();
      this.refresh();
    }
    if (event.key === '/') {
      event.preventDefault();
      this.chatOpen.set(true);
      queueMicrotask(() => document.getElementById('chat-input')?.focus());
    }
  }
}

import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { CardModule } from 'primeng/card';
import { forkJoin } from 'rxjs';
import { MarketService } from '../../services/market.service';
import { Overview, Quote, Ticker } from '../../models/stock.model';

@Component({
  selector: 'app-stock-card',
  standalone: true,
  imports: [CommonModule, CardModule],
  templateUrl: './stock-card.component.html',
  styleUrl: './stock-card.component.scss'
})
export class StockCardComponent implements OnInit {
  @Input({ required: true }) ticker!: Ticker;

  quote: Quote | null = null;
  overview: Overview | null = null;
  loading = true;
  error: string | null = null;

  constructor(private market: MarketService) {}

  ngOnInit(): void {
    forkJoin({
      quote: this.market.getQuote(this.ticker),
      overview: this.market.getOverview(this.ticker)
    }).subscribe({
      next: ({ quote, overview }) => {
        this.quote = quote;
        this.overview = overview;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Falha ao carregar dados.';
        this.loading = false;
      }
    });
  }

  get isUp(): boolean {
    return (this.quote?.change ?? 0) >= 0;
  }

  private static readonly MARKET_STATE_LABELS: Record<string, string> = {
    PRE: 'Pré-mercado',
    REGULAR: 'Mercado aberto',
    POST: 'Pós-mercado',
    POSTPOST: 'Pós-mercado',
    CLOSED: 'Fechado'
  };

  get marketStateLabel(): string {
    const state = this.quote?.marketState;
    if (!state) return '—';
    return StockCardComponent.MARKET_STATE_LABELS[state] ?? state;
  }
}

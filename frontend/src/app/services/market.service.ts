import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, fromEvent, merge, timer } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import { History, Overview, Quote, Range, Ticker } from '../models/stock.model';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly base = '/api/stocks';
  private readonly http = inject(HttpClient);

  /** Refresh manual disparado pela barra superior — atinge todos os painéis. */
  private readonly manualRefresh = new Subject<void>();

  refreshAll(): void {
    this.manualRefresh.next();
  }

  getQuote(ticker: Ticker): Observable<Quote> {
    return this.http.get<Quote>(`${this.base}/${ticker}/quote`);
  }

  getOverview(ticker: Ticker): Observable<Overview> {
    return this.http.get<Overview>(`${this.base}/${ticker}/overview`);
  }

  getHistory(ticker: Ticker, range: Range = '1y'): Observable<History> {
    return this.http.get<History>(`${this.base}/${ticker}/history`, { params: { range } });
  }

  /**
   * Pulso de atualização: periódico enquanto a aba está visível, mais um disparo
   * imediato quando a aba volta ao foco ou o usuário pede refresh. Aba oculta não
   * queima chamada — o cache do backend é de 10 min, mas a rede do usuário não é.
   */
  pulse(periodMs = 60_000): Observable<number> {
    const visible = () => typeof document === 'undefined' || !document.hidden;

    const periodic = timer(0, periodMs).pipe(filter(visible));
    const wake = fromEvent(document, 'visibilitychange').pipe(
      filter(visible),
      map(() => -1)
    );
    const manual = this.manualRefresh.pipe(map(() => -2));

    return merge(periodic, wake, manual);
  }

  liveQuote(ticker: Ticker, periodMs = 60_000): Observable<Quote> {
    return this.pulse(periodMs).pipe(switchMap(() => this.getQuote(ticker)));
  }
}

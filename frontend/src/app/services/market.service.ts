import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { History, Overview, Quote, Ticker } from '../models/stock.model';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly base = '/api/stocks';

  constructor(private http: HttpClient) {}

  getQuote(ticker: Ticker): Observable<Quote> {
    return this.http.get<Quote>(`${this.base}/${ticker}/quote`);
  }

  getOverview(ticker: Ticker): Observable<Overview> {
    return this.http.get<Overview>(`${this.base}/${ticker}/overview`);
  }

  getHistory(ticker: Ticker, range = '1y'): Observable<History> {
    return this.http.get<History>(`${this.base}/${ticker}/history`, { params: { range } });
  }
}

import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { PriceChartComponent } from './components/price-chart/price-chart.component';
import { ChatPanelComponent } from './components/chat-panel/chat-panel.component';
import { Ticker } from './models/stock.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, SelectButtonModule, StockCardComponent, PriceChartComponent, ChatPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  tickers: Ticker[] = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];
  chartTicker: Ticker = 'AAPL';
  tickerOptions = this.tickers.map((t) => ({ label: t, value: t }));
}

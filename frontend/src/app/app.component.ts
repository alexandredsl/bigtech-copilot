import { Component } from '@angular/core';
import { StockCardComponent } from './components/stock-card/stock-card.component';
import { PriceChartComponent } from './components/price-chart/price-chart.component';
import { ChatPanelComponent } from './components/chat-panel/chat-panel.component';
import { Ticker } from './models/stock.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [StockCardComponent, PriceChartComponent, ChatPanelComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  tickers: Ticker[] = ['AAPL', 'MSFT'];
}

import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { ChartConfiguration } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { CardModule } from 'primeng/card';
import { MarketService } from '../../services/market.service';
import { Ticker } from '../../models/stock.model';

@Component({
  selector: 'app-price-chart',
  standalone: true,
  imports: [CommonModule, CardModule, BaseChartDirective],
  templateUrl: './price-chart.component.html',
  styleUrl: './price-chart.component.scss'
})
export class PriceChartComponent implements OnInit {
  @Input({ required: true }) ticker!: Ticker;

  loading = true;
  error: string | null = null;

  chartData: ChartConfiguration<'line'>['data'] = { labels: [], datasets: [] };
  chartOptions: ChartConfiguration<'line'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#9aa0a6' }, grid: { display: false } },
      y: { ticks: { color: '#9aa0a6' }, grid: { color: '#2a2d33' } }
    }
  };

  constructor(private market: MarketService) {}

  ngOnInit(): void {
    this.market.getHistory(this.ticker, '1y').subscribe({
      next: (history) => {
        this.chartData = {
          labels: history.points.map((p) =>
            new Date(p.date).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
          ),
          datasets: [
            {
              data: history.points.map((p) => p.close ?? 0),
              label: this.ticker,
              borderColor: this.ticker === 'AAPL' ? '#60a5fa' : '#34d399',
              backgroundColor: 'transparent',
              tension: 0.25,
              pointRadius: 0
            }
          ]
        };
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Falha ao carregar histórico.';
        this.loading = false;
      }
    });
  }
}

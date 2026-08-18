import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { MarkdownPipe } from '../../pipes/markdown.pipe';

interface ToolInvocation {
  name: string;
  args: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  tools: ToolInvocation[];
  reasoning: string;
  reasoningOpen?: boolean;
  pending?: boolean;
  failed?: boolean;
}

const SUGGESTIONS = [
  'Qual o P/L da Nvidia hoje?',
  'Compare Apple e Microsoft nos últimos 3 meses.',
  'Qual das sete está mais perto da máxima de 52 semanas?',
  'Resuma o dia da Tesla em dólar e em porcentagem.'
];

/**
 * Erros que sobem crus do CLI não dizem nada a quem está perguntando sobre ação:
 * traduz para o que aconteceu e o que fazer.
 */
const ERROR_COPY: { match: RegExp; text: string }[] = [
  {
    match: /código null|timeout|não subiu a tempo/i,
    text: 'A consulta passou do tempo limite antes de o modelo responder. Pergunte de novo — o dado de mercado continua na tela.'
  },
  {
    match: /instável|tool call inválid/i,
    text: 'O modelo grátis embaralhou a resposta desta vez. Pergunte de novo: os números vêm da mesma fonte.'
  },
  {
    match: /opencode CLI não encontrado/i,
    text: 'O motor de IA não está instalado no servidor. O painel de cotações segue funcionando normalmente.'
  }
];

/** O que cada função do MCP foi buscar, em português. */
const TOOL_LABEL: Record<string, string> = {
  getQuote: 'cotação agora',
  getHistory: 'série histórica',
  getOverview: 'fundamentos'
};

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownPipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss'
})
export class ChatPanelComponent implements OnDestroy, AfterViewChecked {
  @Output() close = new EventEmitter<void>();
  @ViewChild('scroller') scroller?: ElementRef<HTMLDivElement>;

  private readonly chat = inject(ChatService);
  private controller: AbortController | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private pinnedToBottom = true;
  private lastSize = 0;

  readonly suggestions = SUGGESTIONS;

  input = '';
  sending = false;
  turns: ChatTurn[] = [];
  stage = '';
  elapsedSeconds = 0;
  lastQuestion = '';

  ngOnDestroy(): void {
    this.stopTimer();
    this.controller?.abort();
  }

  toolLabel(name: string): string {
    return TOOL_LABEL[name] ?? name;
  }

  ask(question: string): void {
    this.input = question;
    void this.send();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  onScroll(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    // Rola sozinho só se o usuário já estava no fim — ler o histórico não é interrompido.
    this.pinnedToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.sending = false;
    this.stopTimer();
    const last = this.turns[this.turns.length - 1];
    if (last?.role === 'assistant') {
      last.pending = false;
      if (!last.text.trim()) {
        last.text = 'Resposta interrompida.';
        last.failed = true;
      }
    }
  }

  clear(): void {
    if (this.sending) this.stop();
    this.turns = [];
    this.lastQuestion = '';
  }

  retry(): void {
    if (!this.lastQuestion || this.sending) return;
    if (this.turns[this.turns.length - 1]?.failed) this.turns.pop();
    if (this.turns[this.turns.length - 1]?.role === 'user') this.turns.pop();
    this.input = this.lastQuestion;
    void this.send();
  }

  async send(): Promise<void> {
    const message = this.input.trim();
    if (!message || this.sending) return;

    // Multi-turno: manda os turnos anteriores para "e a Microsoft?" fazer sentido.
    const history = this.turns
      .filter((t) => t.text.trim() && !t.failed)
      .map((t) => ({ role: t.role, text: t.text }));

    this.lastQuestion = message;
    this.turns.push({ role: 'user', text: message, tools: [], reasoning: '' });

    const answer: ChatTurn = { role: 'assistant', text: '', tools: [], reasoning: '', pending: true };
    this.turns.push(answer);

    this.input = '';
    this.sending = true;
    this.stage = 'pensando';
    this.pinnedToBottom = true;
    this.controller = new AbortController();
    this.startTimer();

    try {
      for await (const event of this.chat.streamChat(message, history, this.controller.signal)) {
        if (event.type === 'tool_call') {
          answer.tools.push(this.parseToolCall(event.data));
          this.stage = `consultando ${event.data.split('(')[0]}`;
        } else if (event.type === 'reasoning') {
          answer.reasoning += event.data;
          this.stage = 'raciocinando';
        } else if (event.type === 'delta') {
          answer.text += event.data;
          answer.pending = false;
        } else if (event.type === 'error') {
          answer.text = this.humanError(event.data);
          answer.failed = true;
          answer.pending = false;
        }
      }
    } finally {
      this.sending = false;
      this.stopTimer();
      answer.pending = false;
      if (!answer.text.trim()) {
        answer.text = 'Sem resposta do modelo desta vez.';
        answer.failed = true;
      }
      this.controller = null;
    }
  }

  ngAfterViewChecked(): void {
    const el = this.scroller?.nativeElement;
    if (!el) return;
    const size = this.turns.reduce((acc, t) => acc + t.text.length + t.reasoning.length + t.tools.length, 0);
    if (size !== this.lastSize) {
      this.lastSize = size;
      if (this.pinnedToBottom) el.scrollTop = el.scrollHeight;
    }
  }

  private humanError(raw: string): string {
    return ERROR_COPY.find((e) => e.match.test(raw))?.text ?? raw;
  }

  /** "getQuote({"ticker":"AAPL"})" → { name, args: "ticker: AAPL" } */
  private parseToolCall(raw: string): ToolInvocation {
    const match = /^([\w.-]+)\((.*)\)$/s.exec(raw.trim());
    if (!match) return { name: raw, args: '' };
    const [, name, payload] = match;
    try {
      const parsed = JSON.parse(payload || '{}') as Record<string, unknown>;
      const args = Object.entries(parsed)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ');
      return { name, args };
    } catch {
      return { name, args: payload };
    }
  }

  private startTimer(): void {
    this.elapsedSeconds = 0;
    this.elapsedTimer = setInterval(() => this.elapsedSeconds++, 1000);
  }

  private stopTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }
}

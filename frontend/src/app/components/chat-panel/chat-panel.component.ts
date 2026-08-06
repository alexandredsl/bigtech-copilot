import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ChatService } from '../../services/chat.service';
import { MarkdownPipe } from '../../pipes/markdown.pipe';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  toolCalls: string[];
  pending?: boolean;
}

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, InputTextModule, ButtonModule, MarkdownPipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss'
})
export class ChatPanelComponent implements OnDestroy {
  input = '';
  sending = false;
  turns: ChatTurn[] = [];
  stage = '';
  elapsedSeconds = 0;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private chat: ChatService) {}

  ngOnDestroy(): void {
    this.stopTimer();
  }

  async send(): Promise<void> {
    const message = this.input.trim();
    if (!message || this.sending) return;

    this.turns.push({ role: 'user', text: message, toolCalls: [] });
    const assistantTurn: ChatTurn = { role: 'assistant', text: '', toolCalls: [], pending: true };
    this.turns.push(assistantTurn);

    this.input = '';
    this.sending = true;
    this.stage = 'pensando';
    this.startTimer();

    try {
      for await (const event of this.chat.streamChat(message)) {
        if (event.type === 'tool_call') {
          assistantTurn.toolCalls.push(event.data);
          const toolName = event.data.split('(')[0];
          this.stage = `consultando ${toolName}`;
        } else if (event.type === 'delta') {
          assistantTurn.text += event.data;
          assistantTurn.pending = false;
        } else if (event.type === 'error') {
          assistantTurn.text = `Erro: ${event.data}`;
          assistantTurn.pending = false;
        }
      }
    } finally {
      this.sending = false;
      this.stopTimer();
      assistantTurn.pending = false;
      if (!assistantTurn.text) {
        assistantTurn.text = 'Sem resposta do modelo — tente de novo.';
      }
    }
  }

  private startTimer(): void {
    this.elapsedSeconds = 0;
    this.elapsedTimer = setInterval(() => {
      this.elapsedSeconds++;
    }, 1000);
  }

  private stopTimer(): void {
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }
}

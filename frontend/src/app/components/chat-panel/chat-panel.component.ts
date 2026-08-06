import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ChatService } from '../../services/chat.service';

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  toolCalls: string[];
}

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, InputTextModule, ButtonModule],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss'
})
export class ChatPanelComponent {
  input = '';
  sending = false;
  turns: ChatTurn[] = [];

  constructor(private chat: ChatService) {}

  async send(): Promise<void> {
    const message = this.input.trim();
    if (!message || this.sending) return;

    this.turns.push({ role: 'user', text: message, toolCalls: [] });
    const assistantTurn: ChatTurn = { role: 'assistant', text: '', toolCalls: [] };
    this.turns.push(assistantTurn);

    this.input = '';
    this.sending = true;

    try {
      for await (const event of this.chat.streamChat(message)) {
        if (event.type === 'tool_call') {
          assistantTurn.toolCalls.push(event.data);
        } else if (event.type === 'delta') {
          assistantTurn.text += event.data;
        } else if (event.type === 'error') {
          assistantTurn.text = `Erro: ${event.data}`;
        }
      }
    } finally {
      this.sending = false;
      if (!assistantTurn.text) {
        assistantTurn.text = 'Sem resposta do modelo — tente de novo.';
      }
    }
  }
}

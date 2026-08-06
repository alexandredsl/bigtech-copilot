import { Injectable } from '@angular/core';

export interface ChatStreamEvent {
  type: 'tool_call' | 'delta' | 'done' | 'error';
  data: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  // POST + SSE — EventSource não suporta POST, então parseia o stream manualmente.
  async *streamChat(message: string): AsyncGenerator<ChatStreamEvent> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.body) {
      yield { type: 'error', data: 'Sem corpo de resposta do servidor.' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event:'));
        const dataLine = lines.find((l) => l.startsWith('data:'));
        if (!eventLine || !dataLine) continue;

        const type = eventLine.slice('event:'.length).trim() as ChatStreamEvent['type'];
        const raw = dataLine.slice('data:'.length).trim();
        let data: string;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        yield { type, data };
      }
    }
  }
}

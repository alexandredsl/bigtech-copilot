import { Injectable } from '@angular/core';

export type ChatEventType = 'tool_call' | 'delta' | 'reasoning' | 'done' | 'error';

export interface ChatStreamEvent {
  type: ChatEventType;
  data: string;
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  // POST + SSE — EventSource não suporta POST, então parseia o stream manualmente.
  // `signal` permite o usuário abortar uma resposta longa sem recarregar a página.
  async *streamChat(
    message: string,
    history: ChatHistoryTurn[] = [],
    signal?: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    let response: Response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      yield { type: 'error', data: 'Não consegui falar com o servidor. Verifique a conexão e tente de novo.' };
      return;
    }

    if (!response.ok) {
      yield { type: 'error', data: `O servidor respondeu ${response.status}. Tente de novo em instantes.` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', data: 'Resposta sem corpo — o stream não abriu.' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
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

          const type = eventLine.slice('event:'.length).trim() as ChatEventType;
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
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      yield { type: 'error', data: 'O stream caiu no meio da resposta. Pergunte de novo.' };
    } finally {
      reader.cancel().catch(() => undefined);
    }
  }
}

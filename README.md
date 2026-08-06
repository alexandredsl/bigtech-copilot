# bigtech-copilot

Dashboard de ações da Apple (AAPL) e Microsoft (MSFT) com um copiloto de IA embutido: você pergunta em linguagem natural, o modelo decide qual dado real precisa buscar (preço, histórico ou fundamentos) via **function calling**, chama o endpoint correspondente, e só então responde — sem alucinar números.

## Por quê function calling, não RAG solto

Um dashboard financeiro não pode "chutar" um preço de ação. A alternativa mais comum — jogar tudo num prompt e deixar o modelo compor a resposta — não dá garantia de que o número citado é real. Aqui, cada resposta numérica passa por uma chamada de função (`getQuote`, `getHistory`, `getOverview`) que bate direto no dado de mercado. O modelo só escreve texto depois de ter o resultado da tool na mão — a IU mostra exatamente qual function foi chamada antes da resposta, tornando a ancoragem visível, não uma promessa.

## Stack

- **Frontend:** Angular v18 + PrimeNG + Chart.js/ng2-charts
- **Backend:** Node/Express + TypeScript
- **Dado de mercado:** [`yahoo-finance2`](https://www.npmjs.com/package/yahoo-finance2) (sem key), cache in-memory de 10min por endpoint para evitar rate-limit
- **LLM:** [NVIDIA NIM](https://build.nvidia.com/) — `openai/gpt-oss-20b`, endpoint OpenAI-compatible, tool calling nativo

## Arquitetura

```
Frontend (Angular)  ──HTTP──▶  Backend (Express)
                                 ├─ GET  /api/stocks/:ticker/quote
                                 ├─ GET  /api/stocks/:ticker/history
                                 ├─ GET  /api/stocks/:ticker/overview
                                 └─ POST /api/chat (SSE)
                                       └─ NVIDIA NIM (tool_choice=auto)
                                             ├─ getQuote → /quote
                                             ├─ getHistory → /history
                                             └─ getOverview → /overview
```

A key da NIM nunca chega ao browser — todo o tool-calling roda no backend, o frontend só consome o stream SSE de eventos (`tool_call`, `delta`, `done`).

## Rodando localmente

```bash
# backend
cd backend
cp .env.example .env   # preencha NVIDIA_NIM_API_KEY
npm install
npm run dev             # http://localhost:3000

# frontend (outro terminal)
cd frontend
npm install
npm start                # http://localhost:4200, proxy /api → :3000
```

## Deploy (Docker)

```bash
cp .env.example .env   # preencha NVIDIA_NIM_API_KEY
docker compose up -d --build
```

Sobe um único container (build multi-stage: Angular buildado como estático, servido pelo próprio Express) na porta host `8091`.

## Roadmap

- Streaming token-a-token real da resposta do LLM (hoje o texto final chega de uma vez, só as tool calls são incrementais)
- HTTPS/domínio custom (Caddy + DuckDNS)
- Fallback Finnhub se o Yahoo quebrar (rate-limit não documentado)

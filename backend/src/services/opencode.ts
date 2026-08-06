import OpenAI from "openai";
import { getHistory, getOverview, getQuote } from "./market";

// OpenCode Zen expõe endpoint OpenAI-compatible (deepseek-v4-flash-free, sem
// limite de tool calling que a NIM impôs) — reusa o SDK oficial da OpenAI
// trocando apenas baseURL + key. Auth: opencode.ai/auth (grátis, sem cartão).
// Fallback dummy evita crash no boot quando OPENCODE_API_KEY não está setada —
// endpoints de mercado seguem funcionando, só /api/chat falha na hora do uso.
const zen = new OpenAI({
  apiKey: process.env.OPENCODE_API_KEY ?? "unset",
  baseURL: "https://opencode.ai/zen/v1",
});

export const MODEL = "deepseek-v4-flash-free";

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getQuote",
      description: "Preço atual e variação do dia de uma ação (AAPL ou MSFT).",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", enum: ["AAPL", "MSFT"] } },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getHistory",
      description: "Série histórica de preço de fechamento de uma ação.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", enum: ["AAPL", "MSFT"] },
          range: { type: "string", enum: ["1mo", "3mo", "6mo", "1y", "5y"] },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getOverview",
      description: "Fundamentos: market cap, P/E, dividend yield, 52w high/low, beta.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", enum: ["AAPL", "MSFT"] } },
        required: ["ticker"],
      },
    },
  },
];

async function callTool(name: string, args: Record<string, string>) {
  switch (name) {
    case "getQuote":
      return getQuote(args.ticker);
    case "getHistory":
      return getHistory(args.ticker, args.range ?? "1y");
    case "getOverview":
      return getOverview(args.ticker);
    default:
      throw new Error(`Tool desconhecida: ${name}`);
  }
}

const SYSTEM_PROMPT =
  "Você é um assistente de análise de ações da Apple (AAPL) e Microsoft (MSFT). " +
  "Sempre que precisar de preço, histórico ou fundamentos, chame a function correspondente " +
  "em vez de inventar números. Responda em português, direto, com os dados retornados pelas tools.";

export interface ChatEvent {
  type: "tool_call" | "delta" | "done" | "error";
  data: string;
}

// Loop de function calling com streaming de volta pro chamador via callback.
// Não usa RAG solto: cada resposta numérica é ancorada em chamada real de tool.
export async function* streamChat(userMessage: string): AsyncGenerator<ChatEvent> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  for (let iteration = 0; iteration < 4; iteration++) {
    const completion = await zen.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
      stream: false,
    });

    const choice = completion.choices[0];
    const toolCalls = choice.message.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      messages.push(choice.message);
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        const args = JSON.parse(call.function.arguments || "{}");
        yield { type: "tool_call", data: `${call.function.name}(${JSON.stringify(args)})` };
        try {
          const result = await callTool(call.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: (err as Error).message }),
          });
        }
      }
      continue;
    }

    const finalText = choice.message.content ?? "";
    yield { type: "delta", data: finalText };
    yield { type: "done", data: "" };
    return;
  }

  yield { type: "error", data: "Limite de iterações de tool calling atingido." };
}

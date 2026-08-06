import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

// Troca do SDK OpenAI (NIM/Zen direto) pra CLI opencode como motor de chat:
// tool calling roda contra um MCP server local (src/mcp/market-mcp-server.ts,
// exposto via ../../opencode.json) em vez de function-calling nativo do SDK —
// evita o limite de tool calling que a NVIDIA NIM impôs, e por padrão usa um
// modelo grátis do OpenCode Zen (zero key, zero cadastro).
//
// PROJECT_ROOT: opencode.json vive na raiz do projeto (sobe 3 níveis a partir
// de dist/services ou src/services — mesma profundidade em dev e produção).
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
// "opencode/big-pickle" (modelo anônimo/rotativo) e mesmo deepseek-v4-flash-free
// ocasionalmente vazam tokens de tool-call crus (formato DSML não reconhecido
// pelo parser do opencode) em vez de disparar um tool_use de verdade —
// instabilidade do modelo grátis, não do nosso MCP. Mitigado com retry abaixo.
const DEFAULT_MODEL = process.env.OPENCODE_MODEL || "opencode/deepseek-v4-flash-free";
const RUN_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const LEAK_PATTERN = /｜｜|<\|.*tool_call|invoke name=/i;

export interface ChatEvent {
  type: "tool_call" | "delta" | "done" | "error";
  data: string;
}

interface OpencodeToolPart {
  tool: string;
  state: { status: string; input?: Record<string, unknown>; error?: string };
}

interface OpencodeTextPart {
  text: string;
}

interface OpencodeEvent {
  type: string;
  part?: OpencodeToolPart | OpencodeTextPart;
}

// Sem system prompt dedicado (diferente do SDK antigo), o agente "build"
// padrão do opencode tenta explorar o projeto com tools genéricas (bash/ls) —
// negadas via opencode.json — e vaza a tentativa como texto. Prefixa a
// mensagem com instrução explícita pra restringir ao escopo de mercado.
const SYSTEM_PROMPT =
  "Você é um assistente de análise de ações da Apple (AAPL) e Microsoft (MSFT). " +
  "As únicas ferramentas disponíveis são bigtech-market_getQuote, bigtech-market_getHistory " +
  "e bigtech-market_getOverview — use-as sempre que precisar de preço, histórico ou " +
  "fundamentos, em vez de inventar números ou tentar outras ferramentas. " +
  "Responda em português, direto, com os dados retornados pelas tools.";

interface RunResult {
  events: ChatEvent[];
  leaked: boolean;
  error: (Error & NodeJS.ErrnoException) | null;
}

// Uma execução completa do opencode CLI, com todos os eventos coletados
// (não emitidos ainda) pra permitir detectar vazamento e re-tentar antes
// de expor qualquer coisa pro cliente.
function runOnce(prompt: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "opencode",
      ["run", prompt, "--format", "json", "--model", DEFAULT_MODEL],
      { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );

    const timeout = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const rl = createInterface({ input: child.stdout });
    const events: ChatEvent[] = [];
    let leaked = false;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let parsed: OpencodeEvent;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed.type === "tool_use" && parsed.part && "tool" in parsed.part) {
        const toolPart = parsed.part as OpencodeToolPart;
        const shortName = toolPart.tool.replace(/^bigtech-market_/, "");
        events.push({
          type: "tool_call",
          data: `${shortName}(${JSON.stringify(toolPart.state.input ?? {})})`,
        });
      } else if (parsed.type === "text" && parsed.part && "text" in parsed.part) {
        const textPart = parsed.part as OpencodeTextPart;
        if (textPart.text) {
          if (LEAK_PATTERN.test(textPart.text)) leaked = true;
          events.push({ type: "delta", data: textPart.text });
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      resolvePromise({ events, leaked, error: err as Error & NodeJS.ErrnoException });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const error =
        code !== 0 ? (new Error(stderr.trim() || `opencode run saiu com código ${code}`) as Error & NodeJS.ErrnoException) : null;
      resolvePromise({ events, leaked, error });
    });
  });
}

// Loop de function calling delegado ao opencode CLI: cada resposta numérica
// segue ancorada em chamada real de tool (MCP local), não inventada.
// Buffera a execução (não streama token a token — o CLI já entrega os
// blocos de texto inteiros) pra poder re-tentar em caso de vazamento antes
// de expor qualquer coisa pro cliente.
export async function* streamChat(userMessage: string): AsyncGenerator<ChatEvent> {
  const prompt = `${SYSTEM_PROMPT}\n\nPergunta do usuário: ${userMessage}`;

  let result: RunResult | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    result = await runOnce(prompt);
    if (result.error) break;
    if (!result.leaked) break;
  }

  if (!result) return;

  if (result.error) {
    const message =
      result.error.code === "ENOENT"
        ? "opencode CLI não encontrado no servidor. Instale com: npm install -g opencode-ai"
        : result.error.message;
    yield { type: "error", data: message };
    return;
  }

  if (result.leaked) {
    yield {
      type: "error",
      data: "Modelo grátis instável nessa resposta (formato de tool call inválido). Tenta de novo.",
    };
    return;
  }

  for (const event of result.events) yield event;
  yield { type: "done", data: "" };
}

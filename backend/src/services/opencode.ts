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
// "opencode/big-pickle" vaza tokens de tool-call crus (formato não
// reconhecido pelo parser do opencode) com frequência alta — testado
// 2026-08-06. Causa raiz real da instabilidade (não é escolha de modelo):
// `opencode run` sozinho sobe sessão + MCP do zero a cada chamada; via
// child_process.spawn a partir do Node, o MCP local (bigtech-market) às
// vezes não termina de conectar antes do modelo listar tools disponíveis —
// aí ele responde "não tenho acesso a essas ferramentas" em vez de chamar
// de verdade. Fix real: sobe UM `opencode serve` persistente (MCP conecta
// uma vez, fica quente) e cada `opencode run` usa `--attach` nele em vez de
// sessão fresca. Testado: 5/5 limpo com --attach vs. falha quase total sem.
const DEFAULT_MODEL = process.env.OPENCODE_MODEL || "opencode/mimo-v2.5-free";
const RUN_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const LEAK_PATTERN = /｜｜|<\|.*tool_call|invoke name=|<tool_call>|<function=/i;
const REFUSAL_PATTERN = /não tenho acesso|not available|tools? (disponíve|available)/i;
const SERVER_PORT = Number(process.env.OPENCODE_SERVE_PORT || 4097);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Servidor `opencode serve` persistente pra vida inteira do processo backend —
// spawnado uma vez (lazy, na primeira mensagem de chat) e reusado por todo
// request seguinte via --attach. Mantém o MCP local sempre conectado.
let serverReady: Promise<void> | null = null;

function ensureServer(): Promise<void> {
  if (serverReady) return serverReady;
  serverReady = new Promise((resolvePromise, rejectPromise) => {
    const server = spawn(
      "opencode",
      ["serve", "--port", String(SERVER_PORT), "--hostname", "127.0.0.1"],
      { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: false },
    );
    const timeout = setTimeout(() => {
      rejectPromise(new Error("opencode serve não subiu a tempo"));
    }, 15_000);

    const onLine = (chunk: Buffer) => {
      if (/listening on/i.test(chunk.toString())) {
        clearTimeout(timeout);
        server.stdout.off("data", onLine);
        resolvePromise();
      }
    };
    server.stdout.on("data", onLine);
    server.stderr.on("data", onLine);

    server.on("error", (err) => {
      clearTimeout(timeout);
      rejectPromise(err);
    });
    server.on("exit", () => {
      // Se o server persistente morrer, próxima chamada sobe outro.
      serverReady = null;
    });
    // Não mata `server` ao sair do request — fica vivo até o processo
    // backend inteiro morrer (unref pra não segurar o event loop sozinho).
    server.unref();
  });
  return serverReady;
}

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
  sessionID?: string;
  part?: OpencodeToolPart | OpencodeTextPart;
}

interface OpencodeMessagePart {
  type: string;
  text?: string;
}

interface OpencodeMessage {
  info: { finish?: string };
  parts: OpencodeMessagePart[];
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

// Achado 2026-08-06: `opencode run --attach` sai (exit 0) assim que o
// próximo step (pós tool-call) começa no servidor, sem esperar a resposta
// de texto terminar de gerar — o stdout do processo local fecha antes do
// evento "text" chegar, mesmo a mensagem completando com sucesso no
// `opencode serve` segundos depois (confirmado via GET /session/:id/message).
// Fallback: se o processo fechou com tool_call mas zero texto, consulta a
// API HTTP do servidor persistente até a última mensagem assistente
// terminar (finish !== undefined), em vez de confiar no exit do child.
const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 500;

async function pollSessionForText(sessionID: string): Promise<string[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    try {
      const res = await fetch(`${SERVER_URL}/session/${sessionID}/message`);
      if (!res.ok) continue;
      const messages = (await res.json()) as OpencodeMessage[];
      const last = messages[messages.length - 1];
      if (!last || last.info.finish === undefined) continue;
      const texts = last.parts.filter((p) => p.type === "text" && p.text).map((p) => p.text as string);
      if (texts.length > 0) return texts;
      // Mensagem terminou (finish presente) mas sem parte de texto —
      // não adianta continuar tentando essa mensagem específica.
      return [];
    } catch {
      // Servidor pode estar ocupado escrevendo — tenta de novo até o deadline.
    }
  }
  return [];
}

// Uma execução completa do opencode CLI, com todos os eventos coletados
// (não emitidos ainda) pra permitir detectar vazamento e re-tentar antes
// de expor qualquer coisa pro cliente.
async function runOnce(prompt: string): Promise<RunResult> {
  try {
    await ensureServer();
  } catch (err) {
    return { events: [], leaked: false, error: err as Error & NodeJS.ErrnoException };
  }
  return new Promise((resolvePromise) => {
    const child = spawn(
      "opencode",
      ["run", prompt, "--format", "json", "--model", DEFAULT_MODEL, "--attach", SERVER_URL],
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
    let sessionID: string | undefined;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let parsed: OpencodeEvent;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed.sessionID) sessionID = parsed.sessionID;
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

    child.on("close", async (code) => {
      clearTimeout(timeout);
      const error =
        code !== 0 ? (new Error(stderr.trim() || `opencode run saiu com código ${code}`) as Error & NodeJS.ErrnoException) : null;
      // Sem tool_call real e texto nega acesso à tool = MCP não conectou a
      // tempo pro modelo enxergar (race condition, ver comentário acima) —
      // trata igual a leak: descarta a tentativa e re-tenta.
      const hasToolCall = events.some((e) => e.type === "tool_call");
      const hasDelta = events.some((e) => e.type === "delta");
      const refused = !hasToolCall && events.some((e) => e.type === "delta" && REFUSAL_PATTERN.test(e.data));

      // Processo fechou com tool_call mas sem texto: run --attach saiu cedo
      // demais (ver comentário em pollSessionForText). Busca a resposta que
      // continuou terminando de gerar no servidor antes de desistir.
      if (!error && hasToolCall && !hasDelta && sessionID) {
        const texts = await pollSessionForText(sessionID);
        for (const text of texts) {
          if (LEAK_PATTERN.test(text)) leaked = true;
          events.push({ type: "delta", data: text });
        }
      }

      resolvePromise({ events, leaked: leaked || refused, error });
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

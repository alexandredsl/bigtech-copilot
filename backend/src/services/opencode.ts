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
// 60s matava run legítimo: com o serve compartilhado e duas perguntas ao mesmo
// tempo, um run com tool call passou de 90s e voltou como "código null" pro
// usuário (medido 2026-08-18). 120s cobre o pior caso observado sem prender o
// cliente pra sempre — o frontend ainda tem botão de parar.
const RUN_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
const LEAK_PATTERN = /｜｜|<\|.*tool_call|invoke name=|<tool_call>|<function=/i;
// mimo-v2.5 (Xiaomi) ocasionalmente troca de idioma no meio da resposta e
// vaza caracteres chineses ("发生在", "催化剂") em texto português — visto em
// teste real 2026-08-06. Trata como leak: descarta a tentativa e re-tenta.
const CJK_PATTERN = /[㐀-鿿぀-ヿ]/;
const REFUSAL_PATTERN = /não tenho acesso|not available|tools? (disponíve|available)/i;
const SERVER_PORT = Number(process.env.OPENCODE_SERVE_PORT || 4097);
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Servidor `opencode serve` persistente pra vida inteira do processo backend —
// spawnado uma vez (lazy, na primeira mensagem de chat) e reusado por todo
// request seguinte via --attach. Mantém o MCP local sempre conectado.
let serverReady: Promise<void> | null = null;

// Alguém já responde na porta? (sobra de um run anterior do backend, ou serve
// externo) — reusa em vez de spawnar um segundo processo que morreria com
// EADDRINUSE sem nunca imprimir "listening on".
async function probeExistingServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/app`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

function ensureServer(): Promise<void> {
  if (serverReady) return serverReady;
  serverReady = (async () => {
    if (await probeExistingServer()) return;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const server = spawn(
        "opencode",
        ["serve", "--port", String(SERVER_PORT), "--hostname", "127.0.0.1"],
        { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: false },
      );
      const timeout = setTimeout(() => {
        // Reset ANTES de rejeitar: sem isso a promise rejeitada fica cacheada
        // pra sempre e todo chat seguinte falha, mesmo o serve terminando de
        // subir segundos depois (bug real visto 2026-08-06 em cold start).
        serverReady = null;
        rejectPromise(new Error("opencode serve não subiu a tempo"));
      }, 30_000);

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
        serverReady = null;
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
  })();
  return serverReady;
}

export interface ChatEvent {
  type: "tool_call" | "delta" | "reasoning" | "done" | "error";
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
function buildSystemPrompt(): string {
  const today = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (
    `Hoje é ${today}. Você é um assistente de análise de ações de big techs. ` +
    "Tickers suportados pelas ferramentas: AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA. " +
    "As únicas ferramentas disponíveis são bigtech-market_getQuote, bigtech-market_getHistory " +
    "e bigtech-market_getOverview — use-as sempre que precisar de preço, histórico ou " +
    "fundamentos, em vez de inventar números ou tentar outras ferramentas. " +
    "Se perguntarem sobre empresa sem capital aberto (ex: OpenAI, Anthropic), responda em texto " +
    "que ela não é listada em bolsa e portanto não tem preço de ação ou P/E público — não chame tool. " +
    "Se perguntarem sobre ticker listado fora da lista suportada, diga que este dashboard cobre só as big techs acima. " +
    "Responda SEMPRE e somente em português (nunca use caracteres chineses), direto, com os dados retornados pelas tools."
  );
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

// Cada `opencode run` é uma sessão nova, então o multi-turno vive no prompt:
// os últimos turnos entram como contexto para "e a Microsoft?" fazer sentido.
// Dado vindo do browser é não confiável — corta formato, quantidade e tamanho.
function buildHistoryBlock(history: unknown): string {
  if (!Array.isArray(history)) return "";
  const turns = history
    .filter(
      (t): t is HistoryTurn =>
        !!t &&
        typeof t === "object" &&
        ((t as HistoryTurn).role === "user" || (t as HistoryTurn).role === "assistant") &&
        typeof (t as HistoryTurn).text === "string" &&
        (t as HistoryTurn).text.trim().length > 0,
    )
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Usuário" : "Você"}: ${t.text.trim().slice(0, 1200)}`);

  if (!turns.length) return "";
  return (
    "\n\nConversa até agora (contexto; os números abaixo podem estar desatualizados — " +
    "consulte as tools de novo se precisar deles):\n" +
    turns.join("\n")
  );
}

interface RunResult {
  events: ChatEvent[];
  leaked: boolean;
  error: (Error & NodeJS.ErrnoException) | null;
}

// `opencode run --format json` NÃO emite as partes de reasoning no stdout —
// mas o `opencode serve` persistente expõe um bus SSE global (GET /event) com
// `message.part.delta` token a token, incluindo reasoning (confirmado
// 2026-08-07 com mimo-v2.5-free: 51 tokens de reasoning por resposta).
// Tap: assina o bus durante o run e repassa só os deltas de reasoning da
// nossa sessão — feedback imediato pro usuário enquanto a resposta final
// (essa sim validada contra leak antes de expor) ainda está sendo gerada.
//
// Deltas chegam com partID mas o tipo da parte (reasoning vs text vs tool) só
// é conhecido via `message.part.updated` — que pode chegar depois do primeiro
// delta. E o sessionID do nosso run só é conhecido quando o stdout emite o
// primeiro evento. Por isso o buffer `pending`: segura delta até saber tipo da
// parte E sessão; descarta o que for de outra sessão ou de parte text/tool
// (texto final segue o caminho bufferizado com detecção de leak).
interface ReasoningTap {
  setSession(id: string): void;
  close(): void;
}

function tapReasoning(onDelta: (text: string) => void): ReasoningTap {
  const controller = new AbortController();
  const partTypes = new Map<string, string>();
  const pending: { sessionID: string; partID: string; delta: string }[] = [];
  let session: string | null = null;

  const flush = () => {
    if (!session) return;
    for (let i = 0; i < pending.length; ) {
      const item = pending[i];
      const type = partTypes.get(item.partID);
      if (item.sessionID !== session || (type && type !== "reasoning")) {
        pending.splice(i, 1);
      } else if (type === "reasoning") {
        pending.splice(i, 1);
        // Reasoning é display-only (não passa pelo retry de leak) — filtra
        // CJK aqui mesmo pra não vazar chinês do mimo na tela.
        if (!CJK_PATTERN.test(item.delta)) onDelta(item.delta);
      } else {
        i++;
      }
    }
  };

  (async () => {
    try {
      const res = await fetch(`${SERVER_URL}/event`, { signal: controller.signal });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let ev: {
            type?: string;
            properties?: {
              part?: { id?: string; type?: string };
              sessionID?: string;
              partID?: string;
              delta?: unknown;
            };
          };
          try {
            ev = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (ev.type === "message.part.updated") {
            const part = ev.properties?.part;
            if (part?.id && part.type) {
              partTypes.set(part.id, part.type);
              flush();
            }
          } else if (ev.type === "message.part.delta") {
            const p = ev.properties;
            if (p?.partID && p.sessionID && typeof p.delta === "string") {
              pending.push({ sessionID: p.sessionID, partID: p.partID, delta: p.delta });
              if (pending.length > 400) pending.shift();
              flush();
            }
          }
        }
      }
    } catch {
      // Abort no fim do run, ou serve caiu — reasoning é opcional, segue sem.
    }
  })();

  return {
    setSession(id: string) {
      session = id;
      flush();
    },
    close() {
      controller.abort();
    },
  };
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
async function runOnce(prompt: string, onReasoning?: (text: string) => void): Promise<RunResult> {
  try {
    await ensureServer();
  } catch (err) {
    return { events: [], leaked: false, error: err as Error & NodeJS.ErrnoException };
  }
  const tap = onReasoning ? tapReasoning(onReasoning) : null;
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
      if (parsed.sessionID && !sessionID) {
        sessionID = parsed.sessionID;
        tap?.setSession(sessionID);
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
          if (LEAK_PATTERN.test(textPart.text) || CJK_PATTERN.test(textPart.text)) leaked = true;
          events.push({ type: "delta", data: textPart.text });
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      tap?.close();
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

      // Processo fechou sem texto: run --attach saiu cedo demais (ver
      // comentário em pollSessionForText). Vale COM tool_call (resposta pós
      // tool ainda gerando) e SEM tool_call (resposta texto-puro ainda
      // gerando — ex: pergunta sobre empresa privada, modelo responde sem
      // chamar tool; visto em teste real 2026-08-06 travando o frontend
      // no "..."). Busca a resposta no servidor antes de desistir.
      if (!error && !hasDelta && sessionID) {
        // Tap fica aberto durante o poll: a resposta (e o reasoning dela)
        // ainda pode estar sendo gerada no servidor após o exit do child.
        const texts = await pollSessionForText(sessionID);
        for (const text of texts) {
          if (LEAK_PATTERN.test(text) || CJK_PATTERN.test(text)) leaked = true;
          events.push({ type: "delta", data: text });
        }
      }

      tap?.close();
      resolvePromise({ events, leaked: leaked || refused, error });
    });
  });
}

// Loop de function calling delegado ao opencode CLI: cada resposta numérica
// segue ancorada em chamada real de tool (MCP local), não inventada.
// Buffera a execução (não streama token a token — o CLI já entrega os
// blocos de texto inteiros) pra poder re-tentar em caso de vazamento antes
// de expor qualquer coisa pro cliente.
export async function* streamChat(
  userMessage: string,
  history: unknown = [],
): AsyncGenerator<ChatEvent> {
  const prompt = `${buildSystemPrompt()}${buildHistoryBlock(history)}\n\nPergunta do usuário: ${userMessage}`;

  // Fila assíncrona: eventos "reasoning" chegam ao vivo (via tap no bus do
  // serve) ENQUANTO o run roda — o generator os repassa imediatamente pro
  // cliente ter feedback rápido, sem abrir mão do buffer+retry do texto final.
  const state: {
    queue: ChatEvent[];
    wake: (() => void) | null;
    final: RunResult | null;
    finished: boolean;
  } = { queue: [], wake: null, final: null, finished: false };

  const push = (ev: ChatEvent) => {
    state.queue.push(ev);
    state.wake?.();
    state.wake = null;
  };

  (async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) push({ type: "reasoning", data: "\n⟲ resposta instável, tentando de novo…\n" });
      const result = await runOnce(prompt, (text) => push({ type: "reasoning", data: text }));
      state.final = result;
      if (result.error) break;
      // Sem nenhum texto mesmo depois do poll fallback = tentativa perdida
      // (modelo terminou sem gerar resposta) — re-tenta igual a leak.
      const hasText = result.events.some((e) => e.type === "delta");
      if (!result.leaked && hasText) break;
    }
    state.finished = true;
    state.wake?.();
    state.wake = null;
  })();

  while (!state.finished || state.queue.length > 0) {
    if (state.queue.length > 0) {
      yield state.queue.shift() as ChatEvent;
      continue;
    }
    await new Promise<void>((r) => {
      state.wake = r;
    });
  }

  const result = state.final;
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

  if (!result.events.some((e) => e.type === "delta")) {
    yield {
      type: "error",
      data: "O modelo não gerou resposta desta vez. Tenta de novo.",
    };
    return;
  }

  for (const event of result.events) yield event;
  yield { type: "done", data: "" };
}

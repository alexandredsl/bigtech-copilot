import { Router } from "express";
import { streamChat } from "../services/opencode";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const { message, history } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Campo 'message' obrigatório." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Caddy/nginx na frente não podem bufferizar o SSE, senão o stream chega de uma vez.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Abort do cliente (botão "parar", aba fechada) encerra o loop sem escrever em
  // socket morto. Tem que ser `res`, não `req`: desde o Node 16 o IncomingMessage
  // emite "close" assim que o corpo termina de ser lido — usar req aqui aborta o
  // stream antes do primeiro evento sair.
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  try {
    for await (const event of streamChat(message.slice(0, 2000), history)) {
      if (closed) break;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (err) {
    if (!closed) res.write(`event: error\ndata: ${JSON.stringify((err as Error).message)}\n\n`);
  } finally {
    res.end();
  }
});

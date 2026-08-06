import { Router } from "express";
import { streamChat } from "../services/nim";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Campo 'message' obrigatório." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    for await (const event of streamChat(message)) {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify((err as Error).message)}\n\n`);
  } finally {
    res.end();
  }
});

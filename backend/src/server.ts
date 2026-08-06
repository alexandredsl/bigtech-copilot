import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { chatRouter } from "./routes/chat";
import { stocksRouter } from "./routes/stocks";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.use("/api/stocks", stocksRouter);
app.use("/api/chat", chatRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Em produção, o build do Angular fica em ../frontend-dist (copiado pelo Dockerfile).
const staticDir = path.join(__dirname, "../frontend-dist");
app.use(express.static(staticDir));
app.get("/*splat", (_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"), (err) => {
    if (err) res.status(404).send("Frontend build não encontrado. Rode o build do Angular.");
  });
});

app.listen(PORT, () => {
  console.log(`bigtech-copilot backend rodando na porta ${PORT}`);
});

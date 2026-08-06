import { Router } from "express";
import { getHistory, getOverview, getQuote } from "../services/market";

export const stocksRouter = Router();

stocksRouter.get("/:ticker/quote", async (req, res) => {
  try {
    res.json(await getQuote(req.params.ticker));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

stocksRouter.get("/:ticker/history", async (req, res) => {
  try {
    const range = typeof req.query.range === "string" ? req.query.range : "1y";
    res.json(await getHistory(req.params.ticker, range));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

stocksRouter.get("/:ticker/overview", async (req, res) => {
  try {
    res.json(await getOverview(req.params.ticker));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

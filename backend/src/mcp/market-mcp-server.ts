#!/usr/bin/env node
// Servidor MCP (stdio) que expõe as 3 funções de mercado da bigtech-copilot
// pro opencode CLI chamar via tool calling — substitui o function-calling
// nativo do SDK OpenAI usado com NVIDIA NIM/OpenCode Zen.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getHistory, getOverview, getQuote, TICKERS } from "../services/market";

const server = new McpServer({ name: "bigtech-copilot-market", version: "1.0.0" });

const tickerSchema = z.enum(TICKERS);

server.registerTool(
  "getQuote",
  {
    description: "Preço atual e variação do dia de uma ação (AAPL ou MSFT).",
    inputSchema: { ticker: tickerSchema },
  },
  async ({ ticker }) => {
    const data = await getQuote(ticker);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "getHistory",
  {
    description: "Série histórica de preço de fechamento de uma ação.",
    inputSchema: {
      ticker: tickerSchema,
      range: z.enum(["1mo", "3mo", "6mo", "1y", "5y"]).optional(),
    },
  },
  async ({ ticker, range }) => {
    const data = await getHistory(ticker, range ?? "1y");
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

server.registerTool(
  "getOverview",
  {
    description: "Fundamentos: market cap, P/E, dividend yield, 52w high/low, beta.",
    inputSchema: { ticker: tickerSchema },
  },
  async ({ ticker }) => {
    const data = await getOverview(ticker);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  },
);

const transport = new StdioServerTransport();
server.connect(transport);

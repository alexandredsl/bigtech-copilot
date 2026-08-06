# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM node:22-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# opencode CLI is the chat engine (see backend/src/services/opencode.ts) —
# needs to be on PATH, spawned as subprocess by the backend.
RUN npm install -g opencode-ai
# opencode.json lives at PROJECT_ROOT (backend/src/services/opencode.ts
# resolves it 3 levels up from dist/services -> here, /app).
COPY opencode.json ./opencode.json
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
# MCP server runs from source via tsx (opencode.json command), not compiled —
# src/mcp + src/services must exist at runtime alongside node_modules/.bin/tsx.
COPY backend/src/mcp ./src/mcp
COPY backend/src/services ./src/services
COPY --from=frontend-build /app/frontend/dist/frontend/browser ./frontend-dist
WORKDIR /app
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]

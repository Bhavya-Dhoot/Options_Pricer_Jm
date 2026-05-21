# ── Stage 1: Build the frontend ──
FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ── Stage 2: Production runtime ──
FROM node:20-slim

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy server code and shared utilities
COPY server/ ./server/
COPY src/ ./src/

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Expose the port (Render injects PORT env var)
EXPOSE 3001

# Start the server
CMD ["node", "server/proxy.js"]

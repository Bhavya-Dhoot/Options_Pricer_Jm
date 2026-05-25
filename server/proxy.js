import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createClient } from 'redis';
import mongoSanitize from 'express-mongo-sanitize';
import { getAngelSession, smartApiRequest } from './angelOneAuth.js';
import { 
  ensureScripMasterInitialized,
  getUnderlyingToken, 
  getOptionTokens, 
  getAvailableExpiries, 
  getFutureToken,
  getAvailableFutureExpiries,
  getLotSize 
} from './scripMaster.js';
import { connectDB } from './src/infrastructure/db.js';
import { seedSuperUser } from './src/application/seed.js';
import { startPriceCacheLoop } from './src/application/priceCache.js';
import authRouter from './src/presentation/authRouter.js';
import tradeRouter from './src/presentation/tradeRouter.js';
import strategyRouter from './src/presentation/strategyRouter.js';
import backtestRouter from './src/presentation/backtestRouter.js';
import agentRoutes from './src/presentation/agentRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1); // CRITICAL FOR PRODUCTION: Trust Load Balancer IPs for Rate Limiting
const PORT = process.env.PORT || 3001;

const server = http.createServer(app);
export const io = new SocketIOServer(server, {
  cors: { origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'], credentials: true }
});

// Load Balancer Fix: Keep-Alive Timeouts
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000;   // slightly higher than keepAlive

// Redis Configuration
export const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

let redisErrorLogged = false;
redisClient.on('error', (err) => {
  if (!redisErrorLogged) {
    console.warn('[Redis] Connection Error - Defaulting to in-memory fallback map.');
    redisErrorLogged = true;
  }
});
redisClient.connect().then(() => console.log('[Redis] Connected')).catch(() => {
  // Catch handles the initial promise rejection silently to prevent unhandled rejection crashes
});

// Security Optimization: HTTP Headers
app.use(helmet({
  contentSecurityPolicy: false // Disabled for local Vite dev injection if needed, but headers secured
}));

// Security Optimization: Strict CORS
// In production, origins should be whitelisted. For this simulation, we lock down to local/frontend.
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'], credentials: true }));

// Security Optimization: Payload limits & NoSQL Injection protection
app.use(express.json({ limit: '10kb' }));

// Sanitize user-supplied data to prevent MongoDB Operator Injection
// Explicit in-place mutation to fix Express 5 "getter only" crash on req.query
app.use((req, res, next) => {
  ['body', 'query', 'params'].forEach(key => {
    if (req[key]) mongoSanitize.sanitize(req[key], { replaceWith: '_' });
  });
  next();
});

// Security Optimization: Inbound Rate Limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs for auth
  message: { error: 'Too many auth requests from this IP, please try again after 15 minutes' }
});

const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 150, // Limit each IP to 150 API requests per minute
  message: { error: 'Too many requests from this IP, please try again after a minute' }
});

// Apply Rate Limiters
app.use('/api/auth', authLimiter);
app.use('/api', globalLimiter);

// Network Optimization: Gzip compress all JSON payloads (reduces 50KB to 3KB)
app.use(compression());

connectDB().then(() => {
  seedSuperUser();
  startPriceCacheLoop();
});

app.use('/api/auth', authRouter);
app.use('/api/trades', tradeRouter);
app.use('/api/strategies', strategyRouter);
app.use('/api/backtest', backtestRouter);
app.use('/api/agent', agentRoutes);

// Serve static frontend from 'dist' directory in production
app.use(express.static(path.join(__dirname, '../dist')));

// Initialize Scrip Master on startup
ensureScripMasterInitialized().catch(err => {
  console.error("Failed to initialize Scrip Master:", err);
});

// Authenticate on startup to test credentials
getAngelSession().then(() => {
  console.log("Angel One connection established.");
}).catch(err => {
  console.error("Angel One initial auth failed:", err.message);
});

import { fetchMarketDataChain, formatExpiry, chainCache } from './src/application/marketDataService.js';

app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase() || 'NIFTY';
  const force = req.query.force === 'true';
  const targetExpiry = req.query.optExpiry || req.query.expiry;
  const futureExpiry = req.query.futExpiry;

  console.log(`[/api/option-chain] Request for ${symbol}`);

  if (!force) {
    if (redisClient.isOpen) {
      const cachedStr = await redisClient.get(`chain:${symbol}`);
      if (cachedStr) {
        return res.json(JSON.parse(cachedStr));
      }
    } else {
      const cached = chainCache.get(symbol);
      if (cached && (Date.now() - cached.timestamp < 15000)) {
        return res.json(cached.data);
      }
    }
  }

  try {
    const finalResponse = await fetchMarketDataChain(symbol, targetExpiry, futureExpiry);
    res.json(finalResponse);
  } catch (error) {
    console.error(`[/api/option-chain] Error for ${symbol}:`, error.message);
    res.status(error.message.includes('not found') ? 404 : 500).json({ error: error.message });
  }
});

app.get('/api/expiries', (req, res) => {
  try {
    const symbol = req.query.symbol || 'NIFTY';
    const optExpiries = getAvailableExpiries(symbol);
    const futExpiries = getAvailableFutureExpiries(symbol);

    res.json({ 
      expiries: optExpiries.map(formatExpiry),
      optExpiries: optExpiries.map(formatExpiry), 
      futExpiries: futExpiries.map(formatExpiry) 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// All other GET requests not handled by API will return the React app
app.get('/*path', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

server.listen(PORT, () => {
  console.log(`[Proxy] Server running on port ${PORT}`);
  console.log(`[Proxy] Using Angel One SmartAPI and Socket.io`);
});

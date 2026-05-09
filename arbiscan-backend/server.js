import db, {
  insertOpportunity,
  getFreshOpportunities,
  getFreshOpportunitiesByPair,
  getHistoryByPair,
  deleteExpiredOpportunities,
} from './db/database.js';

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import ccxt from 'ccxt';

const app = express();
const PORT = 3000;
const WS_PORT = 8080;
const OPPORTUNITY_MAX_AGE_MS = Number(process.env.OPPORTUNITY_MAX_AGE_MS ?? 30_000);
const DB_RETENTION_MS = Number(process.env.DB_RETENTION_MS ?? 5 * 60_000);
const PRICE_POLL_INTERVAL = parseInt(process.env.PRICE_POLL_INTERVAL) || 5000;
const MIN_THRESHOLD = Number(process.env.MIN_SPREAD_THRESHOLD ?? 0.002);

app.use(cors());
app.use(express.json());

// -------------------- REST API --------------------

app.get('/', (req, res) => {
  res.json({ message: 'ArbiScan backend running 🚀' });
});

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

app.get(['/opportunities', '/api/opportunities'], (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const maxAgeSeconds = parsePositiveInt(req.query.maxAgeSeconds, Math.ceil(OPPORTUNITY_MAX_AGE_MS / 1000));
    const freshSince = Date.now() - maxAgeSeconds * 1000;
    const pair = req.query.pair;
    const result = pair
      ? getFreshOpportunitiesByPair.all(pair, freshSince, limit)
      : getFreshOpportunities.all(freshSince, limit);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/history', '/api/history'], (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/USDT';
    const limit = parseInt(req.query.limit) || 100;
    const history = getHistoryByPair.all(pair, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`HTTP Server running on http://localhost:${PORT}`);
});

// -------------------- WEBSOCKET --------------------

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);

const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// -------------------- SMART BROADCAST CONTROL --------------------

let lastOpportunity = null;

function broadcastIfNew(opportunity) {
  if (
    !lastOpportunity ||
    lastOpportunity.pair !== opportunity.pair ||   // FIX: compare per pair
    Math.abs(opportunity.netSpread - lastOpportunity.netSpread) > 0.0005
  ) {
    broadcast(opportunity);
    lastOpportunity = opportunity;
  }
}

// -------------------- CCXT EXCHANGES --------------------

const binance = new ccxt.binance();
const coinbase = new ccxt.coinbase();
const kraken = new ccxt.kraken();

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'];

// -------------------- PRICE FETCHING --------------------

async function fetchPrices() {
  for (const symbol of SYMBOLS) {
    try {
      let binanceTicker = null;
      let coinbaseTicker = null;
      let krakenTicker = null;

      try {
        binanceTicker = await binance.fetchTicker(symbol);
      } catch (e) {
        console.warn(`[Binance] No ticker for ${symbol}:`, e.message);
      }

      try {
        coinbaseTicker = await coinbase.fetchTicker(symbol.replace('USDT', 'USD'));
      } catch (e) {
        console.warn(`[Coinbase] No ticker for ${symbol}:`, e.message);
      }

      try {
        krakenTicker = await kraken.fetchTicker(symbol.replace('USDT', 'USD'));
      } catch (e) {
        console.warn(`[Kraken] No ticker for ${symbol}:`, e.message);
      }

      const data = [
        ...(binanceTicker  ? [{ exchange: 'Binance',  bid: binanceTicker.bid,  ask: binanceTicker.ask  }] : []),
        ...(coinbaseTicker ? [{ exchange: 'Coinbase', bid: coinbaseTicker.bid, ask: coinbaseTicker.ask }] : []),
        ...(krakenTicker   ? [{ exchange: 'Kraken',   bid: krakenTicker.bid,   ask: krakenTicker.ask   }] : []),
      ];

      if (data.length >= 2) {
        findArbitrage(data, symbol);
      } else {
        console.warn(`[${symbol}] Not enough exchange data to compare`);
      }

    } catch (err) {
      console.error(`[fetchPrices] Unexpected error for ${symbol}:`, err.message);
    }
  }
}

// -------------------- ARBITRAGE ENGINE --------------------

const fees = {
  Binance:  0.001,
  Coinbase: 0.001,
  Kraken:   0.0016,
};

function findArbitrage(data, symbol) {
  console.log(`🔍 Running arbitrage check for ${symbol}...`);
  console.log('Data:', data);

  let bestBuy = null;
  let bestSell = null;

  for (const d of data) {
    if (!d.bid || !d.ask) continue;
    if (!bestBuy  || d.ask < bestBuy.ask)   bestBuy  = d;
    if (!bestSell || d.bid > bestSell.bid)  bestSell = d;
  }

  if (!bestBuy || !bestSell) return;
  if (bestBuy.exchange === bestSell.exchange) return;

  const buyPrice   = bestBuy.ask;
  const sellPrice  = bestSell.bid;
  const grossSpread = (sellPrice - buyPrice) / buyPrice;
  const totalFees   = (fees[bestBuy.exchange] || 0.001) + (fees[bestSell.exchange] || 0.001);
  const netSpread   = grossSpread - totalFees;

  console.log(`Checked ${symbol} → Net Spread: ${(netSpread * 100).toFixed(4)}%`);

  if (netSpread > MIN_THRESHOLD) {
    const opportunity = {
      pair:      symbol,
      buyOn:     bestBuy.exchange,
      sellOn:    bestSell.exchange,
      buyPrice:  buyPrice,
      sellPrice: sellPrice,
      netSpread: netSpread,
      estProfit: 1000 * netSpread,
      timestamp: Date.now(),
    };

    insertOpportunity.run(
      opportunity.pair,
      opportunity.buyOn,
      opportunity.sellOn,
      opportunity.buyPrice,
      opportunity.sellPrice,
      opportunity.netSpread,
      opportunity.estProfit,
      opportunity.timestamp
    );

    broadcastIfNew(opportunity);
    console.log(`✅ Opportunity saved: ${symbol} | Net: ${(netSpread * 100).toFixed(4)}%`);
  }
}

// -------------------- SCHEDULERS --------------------

// Start polling AFTER everything is defined
setInterval(async () => {
  try {
    await fetchPrices();
  } catch (err) {
    console.error('[Scheduler] Error in polling loop:', err.message);
  }
}, PRICE_POLL_INTERVAL);

console.log(`[Scheduler] Price monitoring started — polling every ${PRICE_POLL_INTERVAL}ms`);

// Cleanup old DB records
setInterval(() => {
  try {
    const cutoff = Date.now() - DB_RETENTION_MS;
    const result = deleteExpiredOpportunities.run(cutoff);
    if (result.changes > 0) {
      console.log(`[Cleanup] Deleted ${result.changes} expired opportunities`);
    }
  } catch (err) {
    console.error('[Cleanup] Error deleting expired opportunities:', err.message);
  }
}, OPPORTUNITY_MAX_AGE_MS);

// -------------------- GRACEFUL SHUTDOWN --------------------

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

function gracefulShutdown(signal) {
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  wss.close(() => console.log('[WebSocket] Server closed'));
  db.close();
  console.log('[Database] SQLite connection closed');
  process.exit(0);
}
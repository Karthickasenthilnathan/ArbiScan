# ArbiScan

ArbiScan is a crypto arbitrage monitoring dashboard that tracks live exchange prices, detects spread opportunities, stores recent opportunities in Redis, and displays them in a React dashboard.

The app is split into two projects:

- `arbiscan-backend` - Node.js, Express, WebSocket, CCXT, Redis
- `arbiscan-frontend` - Vite, React, TypeScript, Tailwind CSS, shadcn/ui

## Features

- Live crypto price polling with `ccxt`
- Coinbase and Kraken ticker checks for `BTC/USD` and `ETH/USD`
- Arbitrage spread calculation with estimated exchange fees
- Redis-backed recent opportunity storage with TTL cleanup
- REST endpoints for fresh opportunities and pair history
- WebSocket stream for live opportunity updates
- Responsive trading-dashboard UI
- Search, exchange filters, spread filtering, and active opportunity details
- Demo fallback data when the frontend cannot reach the backend

## Project Structure

```txt
ArbiScan/
  arbiscan-backend/
    config/
      redis.js
    db/
      database.js
    server.js
    package.json

  arbiscan-frontend/
    public/
      arbiscan-logo.png
    src/
      pages/
        Index.tsx
      components/
      hooks/
      lib/
    vite.config.ts
    package.json

  .env
  README.md
```

## How It Works

1. The backend polls Coinbase and Kraken prices on an interval.
2. For each watched symbol, it compares the lowest ask against the highest bid.
3. Estimated trading fees are subtracted from the gross spread.
4. If the spread passes the current threshold, the backend stores the opportunity in Redis.
5. New opportunities are broadcast to connected WebSocket clients.
6. The frontend loads stored opportunities from the REST API and listens for live WebSocket updates.

## Tech Stack

### Backend

- Node.js
- Express
- `ws`
- CCXT
- Redis
- dotenv
- CORS

### Frontend

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Radix UI
- lucide-react
- TanStack React Query
- Vitest
- Playwright

## Requirements

- Node.js
- npm
- Redis instance or hosted Redis URL

## Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
REDIS_URL=redis://localhost:6379
PRICE_POLL_INTERVAL=5000
OPPORTUNITY_MAX_AGE_MS=30000
DB_RETENTION_MS=300000
FRONTEND_URL=http://localhost:5174
```

For local frontend development, create `arbiscan-frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

Notes:

- The backend WebSocket server is currently attached to the same HTTP server as Express, so local WebSocket traffic uses `ws://localhost:3000`.
- `PRICE_POLL_INTERVAL=5000` means prices are checked every 5 seconds.
- `OPPORTUNITY_MAX_AGE_MS=30000` means the dashboard treats opportunities older than 30 seconds as stale.
- `DB_RETENTION_MS=300000` keeps Redis opportunity keys for about 5 minutes.
- The backend currently has a testing threshold hardcoded in `server.js` as `MIN_THRESHOLD = -1`.

## Backend Setup

```bash
cd arbiscan-backend
npm install
npm start
```

The backend runs at:

```txt
http://localhost:3000
ws://localhost:3000
```

## Frontend Setup

```bash
cd arbiscan-frontend
npm install
npm run dev
```

The frontend runs at:

```txt
http://localhost:5174
```

## API Endpoints

### Fresh Opportunities

```http
GET /opportunities
GET /api/opportunities
```

Query parameters:

```txt
limit=50
pair=BTC/USD
maxAgeSeconds=30
```

Example:

```txt
http://localhost:3000/opportunities?limit=20&maxAgeSeconds=30
```

### Pair History

```http
GET /history?pair=BTC/USD&limit=100
GET /api/history?pair=BTC/USD&limit=100
```

## WebSocket Payloads

The backend broadcasts live price snapshots and arbitrage opportunities.

Example opportunity payload:

```json
{
  "pair": "ETH/USD",
  "buyOn": "Coinbase",
  "sellOn": "Kraken",
  "buyPrice": 3450.1,
  "sellPrice": 3475.5,
  "netSpread": 0.0041,
  "estProfit": 4.1,
  "timestamp": 1779345600000
}
```

Example price payload:

```json
{
  "type": "prices",
  "symbol": "BTC/USD",
  "data": [
    {
      "exchange": "Coinbase",
      "bid": 64200.5,
      "ask": 64210.2
    },
    {
      "exchange": "Kraken",
      "bid": 64230.8,
      "ask": 64240.1
    }
  ]
}
```

## Frontend Behavior

The dashboard shows:

- Total visible opportunities
- Best spread
- Estimated available profit
- Markets watched
- Opportunity table
- Active opportunity detail bar
- Exchange filters
- Minimum spread filter
- Pair search
- Backend connection status

If the REST API fails, the frontend falls back to demo opportunities so the UI can still be previewed.

## Scripts

Backend:

```bash
npm start
```

Frontend:

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run preview
```

## Development Notes

- Real arbitrage opportunities can be rare because fees often erase small spreads.
- Redis must be reachable before starting the backend.
- The frontend defaults to the deployed API URL unless `VITE_API_BASE_URL` is set locally.
- Set `VITE_WS_URL=ws://localhost:3000` for local WebSocket updates.
- The frontend watchlist includes `BTC/USDT`, `ETH/USDT`, `SOL/USDT`, `XRP/USDT`, `BNB/USDT`, and `DOGE/USDT`, while the backend currently polls `BTC/USD` and `ETH/USD`.
- The frontend normalizes `/USD` pairs into `/USDT` for display.



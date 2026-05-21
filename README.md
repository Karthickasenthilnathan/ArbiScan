# ArbiScan

ArbiScan is a crypto arbitrage monitoring dashboard that scans multiple exchanges, identifies price spreads, stores detected opportunities in SQLite, and streams fresh opportunities to a React frontend in real time.

The project is split into two apps:

- `arbiscan-backend`: Express, WebSocket, CCXT, SQLite
- `arbiscan-frontend`: Vite, React, TypeScript, Tailwind CSS

## Features

- Live exchange price polling with `ccxt`
- Arbitrage spread calculation after exchange fees
- SQLite persistence with freshness filtering
- WebSocket updates for newly detected opportunities
- REST API for recent opportunities and pair history
- Dark trading-dashboard frontend
- Exchange filters, search, spread filtering, and active opportunity view
- Opportunity expiry logic so stale rows do not stay on the dashboard

## Project Structure

```txt
ArbiScan/
  arbiscan-backend/
    db/database.js
    server.js
    package.json
  arbiscan-frontend/
    src/
    public/
    index.html
    package.json
  .env
  README.md
```

## How It Works

1. The backend polls exchange tickers every few seconds.
2. It finds the lowest ask price and highest bid price across exchanges.
3. It subtracts estimated trading fees.
4. If the net spread is above the configured threshold, the backend:
   - saves the opportunity to SQLite
   - broadcasts it over WebSocket
5. The frontend loads fresh opportunities from REST and listens for live WebSocket updates.

Only fresh opportunities are shown by default. This prevents long-dead arbitrage rows from staying on the dashboard.

## Backend

### Tech

- Node.js
- Express
- WebSocket `ws`
- CCXT
- SQLite via `better-sqlite3`

### Install

```powershell
cd arbiscan-backend
npm install
```

### Run

```powershell
npm.cmd start
```

Backend services:

```txt
REST API:  http://localhost:3000
WebSocket: ws://localhost:8080
```

## Frontend

### Tech

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui components
- lucide-react icons

### Install

```powershell
cd arbiscan-frontend
npm install
```

### Run

```powershell
npm.cmd run dev
```

Frontend runs at:

```txt
http://127.0.0.1:5174
```

## Environment Variables

Create or update the root `.env` file:

```env
PORT=3000
WS_PORT=8080
PRICE_POLL_INTERVAL=5000
MIN_SPREAD_THRESHOLD=0.002
OPPORTUNITY_MAX_AGE_MS=30000
DB_RETENTION_MS=300000
TRADING_PAIRS=BTC/USDT,ETH/USDT
```

### Important Settings

`MIN_SPREAD_THRESHOLD`

Controls when an opportunity is saved.

```txt
0.002 = 0.2% net spread
```

For real use, keep this positive. For frontend testing, you can temporarily use a negative value so non-profitable test rows appear.

`OPPORTUNITY_MAX_AGE_MS`

Controls how fresh an opportunity must be to appear in `/opportunities`.

```txt
30000 = 30 seconds
```

`DB_RETENTION_MS`

Controls how long expired rows stay in SQLite before cleanup.

```txt
300000 = 5 minutes
```

## API Endpoints

### Health Check

```http
GET /
```

### Fresh Opportunities

```http
GET /opportunities
GET /api/opportunities
```

Query parameters:

```txt
limit=50
pair=BTC/USDT
maxAgeSeconds=30
```

Example:

```txt
http://localhost:3000/opportunities?limit=20&maxAgeSeconds=30
```

### Pair History

```http
GET /history?pair=BTC/USDT&limit=100
GET /api/history?pair=BTC/USDT&limit=100
```

## WebSocket

The backend broadcasts newly detected opportunities at:

```txt
ws://localhost:8080
```

Example payload:

```json
{
  "pair": "ETH/USDT",
  "buyOn": "Coinbase",
  "sellOn": "Binance",
  "buyPrice": 2315.84,
  "sellPrice": 2316.36,
  "netSpread": 0.0021,
  "estProfit": 2.1,
  "timestamp": 1779345600000
}
```

## Development Notes

- Real arbitrage opportunities may be rare because exchange fees often erase small spreads.
- If the backend logs spreads but the frontend shows no rows, the spreads are probably below `MIN_SPREAD_THRESHOLD` or older than `OPPORTUNITY_MAX_AGE_MS`.
- If `/opportunities` returns `[]`, the backend is connected but no fresh opportunities are currently available.
- Use `/history` when you want older saved rows for debugging.

## Build

Frontend production build:

```powershell
cd arbiscan-frontend
npm.cmd run build
```

Backend syntax check:

```powershell
cd arbiscan-backend
node --check server.js
```

## License

ISC

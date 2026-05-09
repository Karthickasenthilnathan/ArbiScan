# ArbiScan Backend: Implementation Reference Guide

Complete mapping of current implementation vs. what needs to be built based on the implementation plan.

---

## 1. CURRENT STATUS CHECKLIST

### ✅ WORKING & COMPLETE
- **HTTP Server (Express)** - Running on port 3000, CORS enabled
- **WebSocket Server** - Running on port 8080, client connection tracking operational
- **CCXT Integration** - Binance and Coinbase exchanges initialized
- **Arbitrage Algorithm** - `findArbitrage()` function mathematically correct:
  - Fee calculation: `(sellPrice - buyPrice) / buyPrice - totalFees`
  - Spread threshold: Only broadcasts if > 0.2% (0.002)
  - Prevents same-exchange arbitrage
- **WebSocket Broadcasting** - `broadcast()` and `broadcastIfNew()` functions working
- **Client Connection Management** - Tracks connected clients, handles disconnect

### ⚠️ PARTIALLY COMPLETE
- **REST Endpoints** - Structure exists but returns hardcoded/dummy data
  - `GET /` - Health check works
  - `GET /opportunities` - Returns mock data with undefined variable (syntax error: `symbol`)
  - `GET /history` - Returns empty array, no filtering
- **Error Handling** - Only basic try-catch in `fetchPrices()`, incomplete elsewhere
- **Configuration** - dotenv installed but not being used; hardcoded ports (3000, 8080)

### ❌ NOT IMPLEMENTED
- **Price Monitoring Scheduler** - `fetchPrices()` defined but never called (CRITICAL)
- **Database Layer** - No MongoDB, no persistence
- **Opportunity Storage** - No tracking of detected opportunities
- **Historical Data** - No tracking of past data for `/history` endpoint
- **Logging System** - Only console.log, no structured logging
- **Input Validation** - No validation on REST endpoints
- **Rate Limiting** - No protection against abuse
- **Authentication** - No token validation, endpoint protection
- **Environment Configuration** - .env not loaded
- **Graceful Shutdown** - No cleanup on process termination
- **Docker Support** - No containerization files

---

## 2. CRITICAL FIX: Add Price Monitoring Scheduler

**Status:** BLOCKING - Without this, system does nothing  
**Location:** [arbiscan-backend/server.js](arbiscan-backend/server.js)  
**Impact:** Enables entire data flow

### What to Add (After line 108, after HTTP server listener)

```javascript
// Add this after: app.listen(PORT, ...)
// and after: console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);

// -------------------- PRICE MONITORING SCHEDULER --------------------

const PRICE_POLL_INTERVAL = 5000; // milliseconds

setInterval(async () => {
  try {
    await fetchPrices();
  } catch (error) {
    console.error("Error in price polling loop:", error.message);
  }
}, PRICE_POLL_INTERVAL);

console.log(`Price monitoring started (polling every ${PRICE_POLL_INTERVAL}ms)`);
```

### Why This Matters
- `fetchPrices()` is defined but never called
- Without this scheduler, the system never checks for arbitrage opportunities
- This is the "heartbeat" of the entire backend

### Testing
1. Start the server
2. Check console logs for "Price monitoring started..."
3. Watch for logs every 5 seconds showing price fetches
4. Connect WebSocket client and see opportunity broadcasts

---

## 3. ENDPOINT IMPLEMENTATION REQUIREMENTS

### Current Issues

**GET /opportunities**
```javascript
// CURRENT (WRONG) - Line 19-26
app.get("/opportunities", (req, res) => {
  res.json([
    {
      pair: symbol,  // ❌ UNDEFINED - should be string
      buyOn: "Binance",
      sellOn: "Coinbase",
      netSpread: 0.45,
      est_profit: 4.5,
    },
  ]);
});
```

**GET /history**
```javascript
// CURRENT (WRONG) - Line 28-30
app.get("/history", (req, res) => {
  res.json([]); // ❌ ALWAYS EMPTY - no data tracking
});
```

### What Needs to Happen

1. **Store opportunities in memory or database** as they're detected by `findArbitrage()`
2. **Return real data** from `/opportunities` instead of hardcoded mock
3. **Implement filtering** in `/opportunities` endpoint:
   - Query parameter: `?pair=BTC/USDT` (filter by trading pair)
   - Query parameter: `?limit=50` (limit results)
4. **Implement `/history` endpoint**:
   - Query parameter: `?startDate=2024-01-01` (ISO format)
   - Query parameter: `?endDate=2024-01-31`
   - Query parameter: `?pair=BTC/USDT`
   - Return historical opportunities with timestamps

### Solution Architecture

**In-Memory (Phase 1 - Temporary)**
```javascript
let lastOpportunities = []; // Store last N opportunities
let opportunityHistory = [];  // All opportunities ever detected

// In findArbitrage() when spread > threshold:
const opportunity = {
  pair: symbol,
  buyOn: exchange1,
  sellOn: exchange2,
  buyPrice: lowestAsk,
  sellPrice: highestBid,
  netSpread: netSpread,
  profit: buyPrice * quantity * netSpread,
  timestamp: new Date().toISOString()
};
lastOpportunities.push(opportunity);
opportunityHistory.push(opportunity);
broadcastIfNew(opportunity);
```

**With Database (Phase 2 - Persistent)**
```javascript
// Replace in-memory with MongoDB queries
// See "Database Integration" section below
```

---

## 4. DATABASE INTEGRATION PLAN

### Installation
```bash
npm install mongoose@^8.0.0
```

### Schema Files to Create

**models/Opportunity.js**
```javascript
const mongoose = require("mongoose");

const opportunitySchema = new mongoose.Schema({
  pair: { type: String, required: true, index: true },
  buyOn: { type: String, required: true },
  sellOn: { type: String, required: true },
  buyPrice: { type: Number, required: true },
  sellPrice: { type: Number, required: true },
  grossSpread: { type: Number, required: true },
  netSpread: { type: Number, required: true },
  estimatedProfit: { type: Number },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("Opportunity", opportunitySchema);
```

**models/HistoricalData.js**
```javascript
const mongoose = require("mongoose");

const historicalDataSchema = new mongoose.Schema({
  pair: { type: String, required: true, index: true },
  dailyHigh: { type: Number },
  dailyLow: { type: Number },
  volume: { type: Number },
  dailyNetSpreadAvg: { type: Number },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("HistoricalData", historicalDataSchema);
```

**db/connection.js**
```javascript
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/arbiscan"
    );
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
};

module.exports = connectDB;
```

### Updated Endpoints with Database

**GET /opportunities (with filtering)**
```javascript
const Opportunity = require("../models/Opportunity");

app.get("/opportunities", async (req, res) => {
  try {
    const { pair, limit = 50, offset = 0 } = req.query;
    
    const filter = {};
    if (pair) filter.pair = pair;
    
    const opportunities = await Opportunity.find(filter)
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit));
    
    res.json(opportunities);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**GET /history (with date range)**
```javascript
const HistoricalData = require("../models/HistoricalData");

app.get("/history", async (req, res) => {
  try {
    const { pair, startDate, endDate, limit = 100 } = req.query;
    
    const filter = {};
    if (pair) filter.pair = pair;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const data = await HistoricalData.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## 5. ENVIRONMENT CONFIGURATION

### Create `.env` file

```env
# Server Configuration
PORT=3000
WS_PORT=8080

# Database
MONGODB_URI=mongodb://localhost:27017/arbiscan

# Trading Configuration
EXCHANGE_FEES=0.001
MIN_SPREAD_THRESHOLD=0.002
PRICE_POLL_INTERVAL=5000

# Monitoring Pairs (comma-separated)
TRADING_PAIRS=BTC/USDT,ETH/USDT,SOL/USDT

# Logging
LOG_LEVEL=info
```

### Load in server.js (Top of file)

```javascript
require("dotenv").config(); // Already installed, just needs to be loaded

const PORT = process.env.PORT || 3000;
const WS_PORT = process.env.WS_PORT || 8080;
const PRICE_POLL_INTERVAL = parseInt(process.env.PRICE_POLL_INTERVAL || 5000);
const MIN_THRESHOLD = parseFloat(process.env.MIN_SPREAD_THRESHOLD || 0.002);
```

---

## 6. LOGGING SYSTEM

### Installation
```bash
npm install winston@^3.11.0
```

### Create utils/logger.js

```javascript
const winston = require("winston");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "arbiscan-backend" },
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

module.exports = logger;
```

### Usage in server.js

```javascript
const logger = require("./utils/logger");

// Replace console.log with:
logger.info("HTTP Server running on port " + PORT);
logger.error("Error in price polling:", error);
logger.warn("Spread threshold not met: 0.15%");
```

---

## 7. INPUT VALIDATION

### Installation
```bash
npm install express-validator@^7.0.0
```

### Create middleware/validators.js

```javascript
const { query, validationResult } = require("express-validator");

const validateOpportunitiesQuery = [
  query("pair")
    .optional()
    .matches(/^[A-Z]+\/[A-Z]+$/)
    .withMessage("Invalid pair format (use BTC/USDT)"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage("Limit must be between 1-1000"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

module.exports = { validateOpportunitiesQuery };
```

### Apply to Endpoints

```javascript
const { validateOpportunitiesQuery } = require("../middleware/validators");

app.get("/opportunities", validateOpportunitiesQuery, async (req, res) => {
  // ... implementation
});
```

---

## 8. RATE LIMITING

### Installation
```bash
npm install express-rate-limit@^7.0.0
```

### Create middleware/rateLimiter.js

```javascript
const rateLimit = require("express-rate-limit");

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: "Too many requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = limiter;
```

### Apply to App

```javascript
const limiter = require("./middleware/rateLimiter");

app.use("/api/", limiter); // Apply to all /api routes
// Or specific endpoints:
// app.get("/opportunities", limiter, ...);
```

---

## 9. ERROR HANDLING MIDDLEWARE

### Create middleware/errorHandler.js

```javascript
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  logger.error("Unhandled error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(err.status || 500).json({
    error: {
      message: err.message,
      status: err.status || 500,
    },
  });
};

module.exports = errorHandler;
```

### Apply to App (Last middleware)

```javascript
// After all route definitions
app.use(require("./middleware/errorHandler"));
```

---

## 10. GRACEFUL SHUTDOWN

### Add to server.js

```javascript
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  
  wss.close(() => logger.info("WebSocket server closed"));
  
  // Close database connection if using MongoDB
  if (mongoose) {
    await mongoose.disconnect();
    logger.info("MongoDB connection closed");
  }
  
  process.exit(0);
});
```

---

## 11. IMPLEMENTATION PHASES & TIMELINE

### Phase 1: Core Activation (1-2 hours) ⭐ START HERE
- [ ] Add price monitoring scheduler
- [ ] Fix `/opportunities` endpoint (real data)
- [ ] Fix `/history` endpoint structure
- [ ] Test end-to-end with WebSocket client

### Phase 2: Database (2-3 hours)
- [ ] Install mongoose
- [ ] Create Opportunity and HistoricalData schemas
- [ ] Create MongoDB connection file
- [ ] Update endpoints to use database
- [ ] Test persistence across restarts

### Phase 3: Configuration (30 minutes)
- [ ] Create .env file
- [ ] Load dotenv in server.js
- [ ] Replace hardcoded values with env vars
- [ ] Test with different .env values

### Phase 4: Logging (1-2 hours)
- [ ] Install winston
- [ ] Create logger utility
- [ ] Replace all console.log with logger calls
- [ ] Create logs directory structure
- [ ] Test error logging

### Phase 5: Validation & Limiting (1 hour)
- [ ] Install express-validator and express-rate-limit
- [ ] Add query validators to endpoints
- [ ] Apply rate limiter to API routes
- [ ] Test with invalid inputs

### Phase 6: Production Hardening (2-3 hours)
- [ ] Add error handler middleware
- [ ] Add graceful shutdown handlers
- [ ] Create unit tests for arbitrage logic
- [ ] Create Docker files
- [ ] Add authentication (optional)

---

## 12. KEY CODE REFERENCES

### Working Arbitrage Algorithm (Reuse As-Is)
**Location:** [arbiscan-backend/server.js](arbiscan-backend/server.js#L110-L185)
- Correctly calculates: `grossSpread - totalFees = netSpread`
- Correctly filters: only broadcasts if netSpread > MIN_THRESHOLD
- Correctly prevents: same-exchange arbitrage
- **Do not modify this logic - it's correct**

### Working WebSocket Broadcasting (Reuse Pattern)
**Location:** [arbiscan-backend/server.js](arbiscan-backend/server.js#L59-L81)
- `broadcast()` - sends to all clients (line 59-67)
- `broadcastIfNew()` - prevents duplicates with delta check (line 69-81)
- **Use these patterns for real opportunities**

### Working CCXT Setup (Reuse Pattern)
**Location:** [arbiscan-backend/server.js](arbiscan-backend/server.js#L83-L89)
- Shows how to initialize Binance and Coinbase
- Shows how to format pair names (BTC/USDT)
- **Extend this for adding more exchanges**

---

## 13. QUICK START CHECKLIST

```bash
# 1. Install additional dependencies
npm install mongoose winston express-validator express-rate-limit

# 2. Create .env file
cp .env.example .env

# 3. Start MongoDB (if not running)
mongod

# 4. Add scheduler to server.js (after line 108)
# See Section 2 above

# 5. Create models/ and db/ directories
mkdir models db middleware utils

# 6. Create database connection file (see Section 4)

# 7. Create logger utility (see Section 6)

# 8. Start server
npm start

# 9. Test with curl or WebSocket client
curl http://localhost:3000/opportunities
```

---

## 14. DEBUGGING TIPS

**"fetchPrices is not defined"**
- Ensure `fetchPrices()` function is defined before scheduler runs
- Scheduler should be added AFTER function definition

**"Cannot GET /opportunities"**
- Check endpoints are defined before `app.listen()`
- Check Express middleware order (cors, json should be first)

**"WebSocket not connecting"**
- Verify WS_PORT (8080) is not blocked by firewall
- Check WebSocket client URL format: `ws://localhost:8080` (not `http://`)

**"No opportunities being detected"**
- Scheduler might not be running - check logs for "Price monitoring started"
- CCXT API might be rate limited - increase PRICE_POLL_INTERVAL
- Arbitrage gap might be too small - lower MIN_SPREAD_THRESHOLD

**"MongoDB connection failed"**
- Verify MongoDB is running: `mongosh` should connect
- Check MONGODB_URI in .env
- Default: `mongodb://localhost:27017/arbiscan`

---

## 15. NEXT STEPS

1. **This Week:** Complete Phases 1-2 (Core + Database)
2. **Next Week:** Complete Phases 3-4 (Config + Logging)
3. **Following Week:** Complete Phases 5-6 (Validation + Hardening)

Start with Section 2 (Price Monitoring Scheduler) - it's the highest priority and will unlock the entire system.

---

**Questions?** Refer back to the specific section or check [arbiscan-backend/server.js](arbiscan-backend/server.js) for current implementation details.


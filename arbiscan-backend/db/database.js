import Database from 'better-sqlite3';

const db = new Database('arbitrage.db');

// Run once on startup — creates table only if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS opportunities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pair        TEXT    NOT NULL,
    buy_exchange  TEXT  NOT NULL,
    sell_exchange TEXT  NOT NULL,
    buy_price   REAL    NOT NULL,
    sell_price  REAL    NOT NULL,
    net_spread  REAL    NOT NULL,
    est_profit  REAL,
    detected_at INTEGER NOT NULL  -- Unix timestamp in ms
  )
`);

// Prepared statements — write these once, reuse them efficiently
export const insertOpportunity = db.prepare(`
  INSERT INTO opportunities
    (pair, buy_exchange, sell_exchange, buy_price, sell_price, net_spread, est_profit, detected_at)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?)
`);

export const getRecentOpportunities = db.prepare(`
  SELECT * FROM opportunities
  ORDER BY detected_at DESC
  LIMIT ?
`);

export const getFreshOpportunities = db.prepare(`
  SELECT * FROM opportunities
  WHERE detected_at >= ?
  ORDER BY detected_at DESC
  LIMIT ?
`);

export const getFreshOpportunitiesByPair = db.prepare(`
  SELECT * FROM opportunities
  WHERE pair = ?
    AND detected_at >= ?
  ORDER BY detected_at DESC
  LIMIT ?
`);

export const getHistoryByPair = db.prepare(`
  SELECT * FROM opportunities
  WHERE pair = ?
  ORDER BY detected_at DESC
  LIMIT ?
`);

export const deleteExpiredOpportunities = db.prepare(`
  DELETE FROM opportunities
  WHERE detected_at < ?
`);

export default db;

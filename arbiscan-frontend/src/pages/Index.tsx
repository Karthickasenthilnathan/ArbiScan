import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CircleDollarSign,
  Filter,
  Gauge,
  RefreshCw,
  Search,
  Signal,
  SlidersHorizontal,
  TrendingUp,
  Wifi,
  WifiOff,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080";

const EXCHANGES = ["Binance", "Coinbase", "Kraken", "OKX"] as const;
const WATCHED_PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT", "DOGE/USDT"];
const TRADE_SIZE = 1000;

type ConnectionState = "connecting" | "live" | "offline";
type DataState = "loading" | "connected" | "empty" | "demo";

interface ApiOpportunity {
  id?: number | string;
  pair?: string;
  buyOn?: string;
  sellOn?: string;
  buyPrice?: number;
  sellPrice?: number;
  netSpread?: number;
  estProfit?: number;
  timestamp?: number;
  buy_exchange?: string;
  sell_exchange?: string;
  buy_price?: number;
  sell_price?: number;
  net_spread?: number;
  est_profit?: number;
  detected_at?: number;
}

interface Opportunity {
  id: string;
  pair: string;
  buyOn: string;
  sellOn: string;
  buyPrice: number;
  sellPrice: number;
  netSpread: number;
  estProfit: number;
  timestamp: number;
  source: "live" | "stored" | "demo";
}

const demoOpportunities: Opportunity[] = [
  { id: "demo-xrp", pair: "XRP/USDT", buyOn: "Kraken", sellOn: "Binance", buyPrice: 0.621, sellPrice: 0.629, netSpread: 0.0121, estProfit: 12.08, timestamp: Date.now() - 19_000, source: "demo" },
  { id: "demo-sol-a", pair: "SOL/USDT", buyOn: "Binance", sellOn: "OKX", buyPrice: 145.2, sellPrice: 146.8, netSpread: 0.011, estProfit: 11.02, timestamp: Date.now() - 14_000, source: "demo" },
  { id: "demo-btc", pair: "BTC/USDT", buyOn: "Binance", sellOn: "Coinbase", buyPrice: 64250.5, sellPrice: 64780.2, netSpread: 0.0082, estProfit: 8.24, timestamp: Date.now() - 17_000, source: "demo" },
  { id: "demo-eth", pair: "ETH/USDT", buyOn: "OKX", sellOn: "Kraken", buyPrice: 3450.1, sellPrice: 3475.5, netSpread: 0.0074, estProfit: 7.36, timestamp: Date.now() - 38_000, source: "demo" },
  { id: "demo-sol-b", pair: "SOL/USDT", buyOn: "Coinbase", sellOn: "Kraken", buyPrice: 144.98, sellPrice: 145.56, netSpread: 0.0041, estProfit: 4.14, timestamp: Date.now() - 29_000, source: "demo" },
  { id: "demo-eth-b", pair: "ETH/USDT", buyOn: "Binance", sellOn: "Coinbase", buyPrice: 3448, sellPrice: 3462.08, netSpread: 0.0041, estProfit: 4.06, timestamp: Date.now() - 13_000, source: "demo" },
];

function normalizeOpportunity(item: ApiOpportunity, source: Opportunity["source"]): Opportunity | null {
  const buyOn = item.buyOn ?? item.buy_exchange;
  const sellOn = item.sellOn ?? item.sell_exchange;
  const buyPrice = Number(item.buyPrice ?? item.buy_price);
  const sellPrice = Number(item.sellPrice ?? item.sell_price);
  const netSpread = Number(item.netSpread ?? item.net_spread ?? ((sellPrice - buyPrice) / buyPrice));
  const timestamp = Number(item.timestamp ?? item.detected_at ?? Date.now());

  if (!item.pair || !buyOn || !sellOn || !Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) {
    return null;
  }

  return {
    id: String(item.id ?? `${item.pair}-${buyOn}-${sellOn}-${timestamp}`),
    pair: item.pair.endsWith("/USD") ? item.pair.replace("/USD", "/USDT") : item.pair,
    buyOn,
    sellOn,
    buyPrice,
    sellPrice,
    netSpread,
    estProfit: Number(item.estProfit ?? item.est_profit ?? TRADE_SIZE * netSpread),
    timestamp,
    source,
  };
}

function formatPrice(value: number) {
  if (value < 1) return value.toFixed(3);
  if (value >= 10_000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ageLabel(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${seconds}s`;
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Activity }) {
  return (
    <section className="metric-card">
      <div className="flex items-center justify-between gap-3">
        <p>{label}</p>
        <Icon size={18} className="text-cyan-200/70" />
      </div>
      <strong>{value}</strong>
    </section>
  );
}

function ExchangeBadge({ name }: { name: string }) {
  return <span className="exchange-badge">{name}</span>;
}

export default function Index() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [, setClock] = useState(Date.now());
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [dataState, setDataState] = useState<DataState>("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [enabledExchanges, setEnabledExchanges] = useState<string[]>([...EXCHANGES]);
  const [minSpread, setMinSpread] = useState(-0.5);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadStoredOpportunities() {
      try {
        const response = await fetch(`${API_BASE_URL}/opportunities?limit=50`);
        if (!response.ok) throw new Error(`Backend returned ${response.status}`);
        const payload: ApiOpportunity[] = await response.json();
        const normalized = payload
          .map((item) => normalizeOpportunity(item, "stored"))
          .filter(Boolean) as Opportunity[];

        if (!cancelled && normalized.length > 0) {
          setOpportunities(normalized);
          setSelectedId(normalized[0].id);
          setDataState("connected");
        } else if (!cancelled) {
          setOpportunities([]);
          setDataState("empty");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not reach backend REST API");
          setOpportunities(demoOpportunities);
          setSelectedId(demoOpportunities[0].id);
          setDataState("demo");
        }
      }
    }

    loadStoredOpportunities();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      setConnection("live");
      setError("");
    };

    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      const items = Array.isArray(payload) ? payload : [payload];
      const normalized = items
        .map((item) => normalizeOpportunity(item, "live"))
        .filter(Boolean) as Opportunity[];

      if (normalized.length === 0) return;

      setDataState("connected");
      setOpportunities((current) => {
        const next = [...normalized, ...current.filter((item) => item.source !== "demo")];
        const unique = new Map(next.map((item) => [item.id, item]));
        return [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 80);
      });
      setSelectedId((current) => current || normalized[0].id);
    };

    socket.onerror = () => {
      setConnection("offline");
      setError("Live WebSocket is not available yet");
    };

    socket.onclose = () => {
      setConnection((current) => (current === "live" ? "offline" : current));
    };

    return () => socket.close();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const filtered = useMemo(() => {
    return opportunities
      .filter((item) => {
        if (enabledExchanges.length === EXCHANGES.length) return true;
        return enabledExchanges.includes(item.buyOn) || enabledExchanges.includes(item.sellOn);
      })
      .filter((item) => item.netSpread * 100 >= minSpread)
      .filter((item) => item.pair.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => b.netSpread - a.netSpread);
  }, [enabledExchanges, minSpread, opportunities, search]);

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const bestSpread = filtered[0]?.netSpread ?? 0;
  const totalProfit = filtered.reduce((sum, item) => sum + item.estProfit, 0);

  const statusText = connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Offline";
  const StatusIcon = connection === "live" ? Wifi : WifiOff;
  const bannerText =
    dataState === "demo"
      ? "Demo fallback - backend data could not be loaded."
      : dataState === "empty"
        ? "Backend connected - waiting for real arbitrage opportunities."
        : dataState === "loading"
          ? "Connecting to backend data..."
          : "Backend connected - showing stored and live opportunities.";

  return (
    <main className="arbiscan-shell">
      <header className="top-strip">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle size={16} className={dataState === "demo" ? "text-amber-300" : "text-emerald-300"} />
          <span className="truncate">{bannerText}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`status-dot ${connection === "live" ? "bg-emerald-300" : "bg-rose-300"}`} />
          <StatusIcon size={15} />
          <span>{statusText}</span>
          <span className="hidden sm:inline">/ {enabledExchanges.length} exchanges</span>
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="main-panel">
          <div className="brand-row">
            <div className="brand-lockup">
              <img src="/arbiscan-logo.png" alt="ArbiScan" />
              <div>
                <p className="eyebrow">ArbiScan Market Monitor</p>
                <h1>Crypto arbitrage opportunities</h1>
              </div>
            </div>
            <div className="search-box">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pair" />
            </div>
          </div>

          <div className="metric-grid">
            <StatCard label="Opportunities Today" value={String(filtered.length)} icon={Activity} />
            <StatCard label="Best Spread" value={`+${(bestSpread * 100).toFixed(2)}%`} icon={TrendingUp} />
            <StatCard label="Available Profit" value={`$${totalProfit.toFixed(2)}`} icon={CircleDollarSign} />
            <StatCard label="Markets Watched" value={String(WATCHED_PAIRS.length * enabledExchanges.length)} icon={Gauge} />
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Buy On</th>
                  <th>Buy Price</th>
                  <th>Sell On</th>
                  <th>Sell Price</th>
                  <th>Spread %</th>
                  <th>Est. Profit</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className={selected?.id === item.id ? "active-row" : ""} onClick={() => setSelectedId(item.id)}>
                    <td className="pair-cell">{item.pair}</td>
                    <td><ExchangeBadge name={item.buyOn} /></td>
                    <td>${formatPrice(item.buyPrice)}</td>
                    <td><ExchangeBadge name={item.sellOn} /></td>
                    <td>${formatPrice(item.sellPrice)}</td>
                    <td className="positive">+{(item.netSpread * 100).toFixed(2)}%</td>
                    <td className="profit">${item.estProfit.toFixed(2)}</td>
                    <td className="age-cell">{ageLabel(item.timestamp)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {dataState === "empty" ? "Backend is connected, but no opportunities are saved yet." : "No opportunities match the current filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="filters-panel">
          <div className="panel-title">
            <Filter size={17} />
            <span>Filters</span>
          </div>

          <div className="filter-group">
            <p>Exchanges</p>
            {EXCHANGES.map((exchange) => {
              const checked = enabledExchanges.includes(exchange);
              const toggleExchange = () => {
                setEnabledExchanges((current) =>
                  checked ? current.filter((item) => item !== exchange) : [...current, exchange],
                );
              };
              return (
                <label key={exchange} className="check-row" onClick={toggleExchange}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-pressed={checked}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleExchange();
                    }}
                  >
                    {checked && <Check size={14} />}
                  </button>
                  <span>{exchange}</span>
                </label>
              );
            })}
          </div>

          <div className="filter-group">
            <div className="range-label">
              <p>Min Spread</p>
              <strong>{minSpread.toFixed(1)}%</strong>
            </div>
            <input min="-0.5" max="2" step="0.1" type="range" value={minSpread} onChange={(event) => setMinSpread(Number(event.target.value))} />
          </div>

          <div className="filter-group">
            <p>Pair Watchlist</p>
            <div className="watchlist">
              {WATCHED_PAIRS.map((pair) => <span key={pair}>{pair}</span>)}
            </div>
          </div>

          <div className="system-card">
            <Signal size={18} />
            <div>
              <p>Backend endpoints</p>
              <span>REST {API_BASE_URL}</span>
              <span>WS {WS_URL}</span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="active-ticket">
        <div>
          <p>Active Opportunity</p>
          <strong>{selected?.pair ?? "Waiting"}</strong>
        </div>
        <span className="ticket-spread">+{(((selected?.netSpread ?? 0) * 100)).toFixed(2)}%</span>
        <div>
          <p>Buy Fee (0.1%)</p>
          <strong>${(((selected?.buyPrice ?? 0) * 0.001)).toFixed(2)}</strong>
        </div>
        <div>
          <p>Sell Fee (0.1%)</p>
          <strong>${(((selected?.sellPrice ?? 0) * 0.001)).toFixed(2)}</strong>
        </div>
        <div>
          <p>Gross Spread</p>
          <strong>{(((selected?.sellPrice ?? 0) - (selected?.buyPrice ?? 0)) / (selected?.buyPrice || 1) * 100).toFixed(2)}%</strong>
        </div>
        <div>
          <p>Net Spread</p>
          <strong>{(((selected?.netSpread ?? 0) * 100)).toFixed(2)}%</strong>
        </div>
        <button type="button" onClick={() => window.location.reload()} aria-label="Refresh dashboard">
          <RefreshCw size={17} />
        </button>
      </footer>

      {error && (
        <div className="toast-note">
          <SlidersHorizontal size={16} />
          <span>{error}</span>
        </div>
      )}
    </main>
  );
}

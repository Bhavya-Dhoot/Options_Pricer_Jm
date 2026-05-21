# NIFTY Options Pricer

A production-grade **Black-Scholes-Merton** options pricing engine built for **NIFTY index options**, featuring real-time NSE data integration, interactive Greeks visualization, theta decay simulation, scenario analysis, and a comprehensive multi-leg strategies builder.

Built with React 19, Vite 8, Recharts, and a Node.js proxy with Puppeteer for live NSE data.

---

## Features

### 📊 Options Pricer

- **Black-Scholes-Merton pricing** with continuous dividend yield adjustment
- **Full Greeks dashboard** — Delta (Δ), Gamma (Γ), Theta (Θ), Vega (ν), Rho (ρ) displayed as interactive cards with contextual color coding
- **Live NSE data** — fetches real-time NIFTY spot price, option chain, and implied volatility directly from NSE India
- **ATM strike auto-detection** — automatically selects the at-the-money strike from live option chain data
- **IV extraction** — pulls market-implied volatility from NSE's live option chain for accurate pricing
- **Scenario simulator** — interactive spot price vs. IV sensitivity heatmaps and payoff diagrams

### ⏱️ Theta Decay Simulator

- **Dual decay curves** — BSM theoretical value decay vs. market-implied decay (using Newton-Raphson IV solver)
- **Daily theta breakdown** — shows daily theta loss with acceleration zones:
  - 🟢 **Safe** (>30 DTE): slow, predictable decay
  - 🟡 **Warning** (15–30 DTE): accelerating decay
  - 🔴 **Danger** (<15 DTE): exponential theta crush
- **Multi-strike comparison** — compare ITM, ATM, and OTM decay curves side-by-side
- **P&L heatmap** — days held × spot price change matrix showing profit/loss scenarios
- **Market premium input** — enter the premium you actually paid and see real P&L projections
- **Forward trading days slider** — scrub through 1–60 days to visualize time decay progression

### 🧩 Options Strategies Builder

- **29 Pre-built Strategies** — instantly load standard setups spanning Single-Leg, Vertical Spreads, Neutral/Volatility, Calendar/Diagonal, Ratio Spreads, and Synthetic combinations.
- **Custom Strategy Sandbox** — build arbitrary structures by adding/removing legs (Call, Put, or Spot), editing strikes, and adjusting quantities. Save them locally to use later.
- **Advanced Math Modeling** — uses exact BSM pricing across legs to model current P&L, 50% DTE P&L, and expiry payoff curves.
- **Probability Analysis** — calculates the Probability of Profit (PoP) and Expected Value (EV) by integrating a lognormal distribution of the underlying asset.
- **Multi-Strategy Comparison** — select up to 3 different strategies and overlay their payoff graphs on a single chart with side-by-side risk/reward metrics.

### 🔧 Technical Highlights

- **Abramowitz & Stegun CDF** — uses the Horner method approximation (max error < 7.5×10⁻⁸) for the cumulative normal distribution
- **Newton-Raphson IV solver** — iteratively solves for implied volatility from market prices with convergence tolerance of 1×10⁻⁶
- **No external math libraries** — all BSM calculations are pure JavaScript with zero dependencies
- **Responsive design** — works on desktop, tablet, and mobile
- **Dark theme** — sleek dark UI with glassmorphism effects

---

## Architecture

```
Options Pricer/
├── src/                          # Frontend (React)
│   ├── App.jsx                   # Tab navigation (Pricer / Theta Decay / Strategies)
│   ├── OptionsPricer.jsx         # Main pricing interface + live data
│   ├── ThetaDecaySimulator.jsx   # Theta decay analysis engine
│   ├── OptionsStrategies.jsx     # Complex multi-leg strategies tab
│   ├── components/strategies/    # Modular UI components for strategies tab
│   ├── ScenarioSimulator.jsx     # Spot/IV sensitivity charts
│   ├── GreeksDashboard.jsx       # Greeks display cards
│   ├── bsm.js                    # Black-Scholes-Merton math engine
│   ├── strategyDefinitions.js    # 29 predefined options strategy structures
│   ├── useLiveData.js            # React hook for NSE data fetching
│   ├── index.css                 # Global styles + design system
│   └── main.jsx                  # React entry point
│
├── server/                       # Backend (Node.js proxy)
│   ├── proxy.js                  # Express server + caching layer
│   └── nse-session.js            # Puppeteer session manager for NSE
│
├── Dockerfile                    # Multi-stage Docker build
├── render.yaml                   # Render deployment config
├── vite.config.js                # Vite build config with proxy
└── package.json
```

### Data Flow

```
┌──────────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐
│   React UI   │────▸│  Vite Proxy  │────▸│  Express Proxy      │────▸│   NSE India  │
│  (Browser)   │◂────│  /api/*      │◂────│  + Puppeteer Cache   │◂────│   Website    │
└──────────────┘     └─────────────┘     └─────────────────────┘     └─────────────┘
                                              │
                                              ▼
                                     ┌─────────────────┐
                                     │  Headless Chrome  │
                                     │  (intercepts XHR) │
                                     └─────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19, Vite 8 | UI framework + build tool |
| **Charts** | Recharts 3.8 | Interactive data visualization |
| **Icons** | Lucide React | UI iconography |
| **Styling** | TailwindCSS 4 | Utility-first CSS |
| **Backend** | Express 5, Node.js 20 | API proxy server |
| **Scraping** | Puppeteer 25 | Headless Chrome for NSE session management |
| **Deployment** | Docker, Render | Containerized cloud deployment |
| **Math** | Pure JavaScript | BSM engine, CDF, IV solver |

---

## Getting Started

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **npm 10+**
- Google Chrome or Chromium (for Puppeteer — auto-downloaded on install)

### Installation

```bash
# Clone the repository
git clone https://github.com/Bhavya-Dhoot/Options_Pricer_Jm.git
cd Options_Pricer_Jm

# Install dependencies
npm install
```

### Running Locally

```bash
# Start both the proxy server and Vite dev server
npm run dev:full
```

This starts:
- **Vite dev server** at `http://localhost:5173` (frontend)
- **Express proxy** at `http://localhost:3001` (NSE data proxy)

The Vite config automatically proxies `/api/*` requests to the Express server.

### Individual Commands

```bash
# Frontend only (no live data)
npm run dev

# Proxy server only
npm run proxy

# Both together
npm run dev:full

# Production build
npm run build

# Preview production build
npm run preview
```

---

## How Live Data Works

The app fetches real-time option chain data from NSE India (National Stock Exchange). Here's how:

1. **Puppeteer** launches a headless Chrome browser
2. For each fetch request, it opens a new tab and navigates to `nseindia.com/option-chain`
3. A **response interceptor** captures the XHR call NSE's page makes to its internal API
4. The intercepted JSON data (spot price, strikes, premiums, IVs) is returned to the frontend
5. The tab is closed after each fetch (browser stays alive for subsequent requests)

### Why Puppeteer?

NSE India uses **Akamai Bot Manager** for anti-scraping protection. Their session cookies (`nsit`, `nseappid`, `bm_sv`) are set by client-side JavaScript — not HTTP `Set-Cookie` headers. This means:

- ❌ Simple HTTP requests (fetch/axios) return `{}` — empty responses
- ❌ Cookie extraction without JS execution fails
- ✅ Only a real browser with full JavaScript execution can establish a valid session

### Cache Strategy

The proxy implements a short-lived cache (15s TTL) to avoid hammering NSE:
- **Auto-refresh**: Background polling every 30 seconds
- **Force refresh**: Click "Fetch Live Prices" to bypass cache
- **Stale data**: Cache falls back to last known data on errors

---

## Deployment

### Render (Docker)

The app deploys to Render as a Docker web service:

```bash
# render.yaml is pre-configured
# Just connect your GitHub repo to Render
```

The `Dockerfile` uses a multi-stage build:
1. **Stage 1** (builder): Builds the Vite frontend
2. **Stage 2** (runtime): Installs Chromium + production deps, copies built frontend

### Vercel (Static)

For a static deployment without live data:

1. Import the repo on [vercel.com/new](https://vercel.com/new)
2. Vercel auto-detects Vite and builds/deploys
3. The app works as a manual-input pricer (no live NSE data)

---

## Black-Scholes-Merton Implementation

### Core Formulas

The pricing engine implements the canonical BSM model with continuous dividend yield:

```
d₁ = [ln(S/K) + (r - q + σ²/2) · T] / (σ · √T)
d₂ = d₁ - σ · √T

Call = S · e^(-qT) · N(d₁) - K · e^(-rT) · N(d₂)
Put  = K · e^(-rT) · N(-d₂) - S · e^(-qT) · N(-d₁)
```

Where:
- **S** = Spot price (NIFTY index level)
- **K** = Strike price
- **T** = Time to expiry (in years)
- **r** = Risk-free rate (Indian 10Y government bond yield)
- **q** = Continuous dividend yield
- **σ** = Implied volatility
- **N(·)** = Cumulative standard normal distribution

### Greeks

| Greek | Formula | Interpretation |
|-------|---------|---------------|
| **Delta (Δ)** | `e^(-qT) · N(d₁)` | Price sensitivity per ₹1 spot move |
| **Gamma (Γ)** | `e^(-qT) · φ(d₁) / (S · σ · √T)` | Delta's rate of change |
| **Theta (Θ)** | `-(S · φ(d₁) · σ · e^(-qT)) / (2√T) - ...` | Daily time decay (₹/day) |
| **Vega (ν)** | `S · e^(-qT) · φ(d₁) · √T` | Price sensitivity per 1% IV change |
| **Rho (ρ)** | `K · T · e^(-rT) · N(d₂)` | Price sensitivity per 1% rate change |

### Implied Volatility Solver

The Newton-Raphson iterative solver extracts IV from market prices:

```
σ_{n+1} = σ_n - [BSM(σ_n) - MarketPrice] / Vega(σ_n)
```

- **Convergence**: Tolerance of 1×10⁻⁶
- **Max iterations**: 100
- **Initial guess**: 0.3 (30% IV)
- **Bounds**: 0.01 to 5.0 (1% to 500%)

---

## Known Limitations

### ⚠️ Live Data Limitations

#### 1. Cloud Hosting (Render/AWS/GCP/Azure) is Blocked

**NSE India's Akamai Bot Manager actively blocks cloud provider IP ranges.** This means:

- ✅ **Live data works perfectly when running locally** — your machine has a residential IP that NSE accepts
- ❌ **Live data fails on Render, AWS, GCP, Azure, Heroku, etc.** — these platforms use datacenter IPs that NSE blocks

#### What Happens on Cloud

When deployed to Render (or any cloud provider):
1. The Puppeteer browser launches successfully
2. It navigates to NSE's option-chain page
3. NSE's Akamai WAF detects the datacenter IP and either:
   - Serves the page without the API call (times out after 30s)
   - Returns empty responses (`{}`) to direct API requests
4. The proxy returns a 502 error to the frontend

#### Attempted Workarounds

| Approach | Result |
|----------|--------|
| Puppeteer + XHR intercept | ✅ Works locally, ❌ 30s timeout on Render |
| Direct API with browser cookies | ❌ Returns `{}` (Akamai blocks) |
| HTTP-only with Set-Cookie extraction | ❌ Critical cookies are JS-only |
| Hybrid (Puppeteer cookies + HTTP API) | ❌ Akamai cookies require active browser session |
| Memory optimization (block images/fonts) | ❌ IP blocking, not resource issue |
| `--single-process` Chrome flag | ❌ Causes "detached frame" errors |

#### Possible Solutions (Not Implemented)

1. **Deploy on a VPS with residential IP** — e.g., a home server or Indian ISP-hosted VPS
2. **Use a residential proxy service** — route through residential IPs (costs ~$5-15/month)
3. **Third-party market data API** — use a service that already handles NSE scraping
4. **Oracle Cloud Free Tier** — their India region may have non-blocked IPs (untested)

#### Current Behavior on Cloud

The deployed version at `https://options-pricer-d61g.onrender.com` works as a **fully functional manual-input pricer**. All BSM calculations, Greeks, theta decay simulation, and scenario analysis work perfectly — only the "Fetch Live Prices" button will fail on cloud hosting.

#### 2. Dynamic Ticker Symbol Support is Restricted Locally

Even when running locally on a residential IP, NSE's Web Application Firewall (WAF) enforces strict session and origin checks that limit automated dynamic fetching.

- ✅ **Default Index (NIFTY)**: Works flawlessly. Puppeteer navigates to the default option chain page and naturally intercepts the XHR request triggered natively by NSE's React application.
- ❌ **Equities & Other Indices (RELIANCE, BANKNIFTY, etc.)**: Blocked or highly unreliable.

**Why dynamic tickers fail:**
1. **API Endpoint Migration**: NSE recently migrated to a unified `v3` API (`/api/option-chain-v3`) that requires specific, dynamic tokens generated purely by frontend interactions.
2. **Fetch Hooking**: Akamai hooks `window.fetch` and `XMLHttpRequest` in the browser. Using `page.evaluate()` to programmatically call the API endpoints using valid cookies results in connection resets or empty responses (`{}`).
3. **URL Rewriting Blocked**: Intercepting the natural NIFTY request and rewriting the URL to fetch a different symbol fails because the WAF strictly validates the exact `Referer`, query parameters, and `expiry` date combinations.
4. **Iframe Sandboxing**: Injecting an invisible `<iframe>` to trigger native browser navigation to the API endpoints results in Cross-Origin DOM blocks.

**Conclusion**: The frontend and proxy server are fully architected to support dynamic tickers, but due to these aggressive WAF protections, the app practically only guarantees live data for the default **NIFTY** index.

---

## Project Structure Deep Dive

### Frontend Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `OptionsPricer.jsx` | ~600 | Main pricing UI, input controls, live data integration |
| `ThetaDecaySimulator.jsx` | ~1500 | Theta decay curves, P&L heatmaps, multi-strike comparison |
| `ScenarioSimulator.jsx` | ~300 | Spot/IV sensitivity analysis charts |
| `GreeksDashboard.jsx` | ~130 | Greeks display cards with color coding |
| `bsm.js` | ~160 | Pure BSM math engine |
| `useLiveData.js` | ~100 | React hook for NSE proxy communication |

### Server Components

| Component | Lines | Purpose |
|-----------|-------|---------|
| `proxy.js` | ~200 | Express server, caching, CORS, health checks |
| `nse-session.js` | ~170 | Puppeteer lifecycle, XHR interception, error recovery |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Express server port (Render auto-injects) |
| `PUPPETEER_EXECUTABLE_PATH` | Auto-detected | Path to Chromium binary (Docker sets this) |
| `NODE_OPTIONS` | `--max-old-space-size=512` | Node.js memory limit |

### Vite Proxy Config

```javascript
// vite.config.js
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    }
  }
}
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is open source and available under the [MIT License](LICENSE).

---

## Acknowledgments

- **Black-Scholes-Merton model** — Fischer Black, Myron Scholes, Robert Merton (1973)
- **Abramowitz & Stegun** — CDF approximation method (Handbook of Mathematical Functions, 1964)
- **NSE India** — National Stock Exchange of India for market data
- **Recharts** — React charting library
- **Puppeteer** — Headless Chrome automation

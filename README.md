# Options Pricer & Trading Terminal

A production-grade **Black-Scholes-Merton** options pricing engine and full-fledged **Paper Trading Terminal** built for Indian Equities and Indices. It features real-time data integration via the **Angel One SmartAPI**, interactive Greeks visualization, theta decay simulation, and a comprehensive multi-leg strategies builder with smart margin calculation.

Built with React 19, Vite 8, Recharts, and a Node.js Express Backend.

---

## Intelligent Architectural Decisions

### 🚦 Advanced API Rate Limiting (Token Bucket Round-Robin)
To comply with strict broker API limits (3 requests per second) while supporting concurrent users, the backend utilizes a sophisticated **Round-Robin Queue Manager**.
- It guarantees exactly 3 HTTP requests are dispatched per second (1 every 333ms).
- It features a **1/3 Priority Guarantee**: If a Super User (e.g., admin) queues requests, the manager guarantees that every 3rd request is pulled exclusively from the High Priority Queue, ensuring VIP users never experience bottlenecks from standard traffic.

### 📈 Probability of Profit (POP) via Lognormal Integration
Instead of basic standard-deviation approximations, the Probability Engine uses a full **Lognormal PDF Integration** derived from the BSM model. It computes the risk-neutral drift `(r - q - σ²/2)` and standard deviation `σ√T`, then numerically integrates the probability mass function across the entire range of profitable intrinsic values at expiry.

### 🛡️ Smart Hedge Margin Calculator
The margin estimation system behaves closely to NSE SPAN margin rules. If you build a complex multi-leg strategy (e.g., Iron Condor), the backend's `processShorts` algorithm intelligently detects offsetting long legs and automatically pairs them with naked short legs, reducing the required margin strictly to the maximum loss (width of the spread) rather than calculating them as independent naked shorts.

### ⚡ Unified Paper Trading Terminal
The Strategy Builder is deeply integrated into the Paper Trading Dashboard. Unauthenticated users get a pure mathematical sandbox, while authenticated users can save custom templates, utilize 1-click strategy generation (Straddles, Spreads, Condors), and execute virtual trades seamlessly into a MongoDB portfolio with real-time MTM (Mark-To-Market) tracking.

---

## Features

### 📊 Options Pricer
- **Black-Scholes-Merton pricing** with continuous dividend yield adjustment.
- **Full Greeks dashboard** — Delta (Δ), Gamma (Γ), Theta (Θ), Vega (ν), Rho (ρ) displayed as interactive cards with contextual color coding.
- **Live Market Data** — fetches real-time spot price, option chains, and futures directly from the Angel One SmartAPI.
- **Newton-Raphson IV Solver** — Extracts implied volatility dynamically from live market premiums.

### ⏱️ Theta Decay Simulator
- **Dual decay curves** — BSM theoretical value decay vs. market-implied decay.
- **Daily theta breakdown** — shows daily theta loss with acceleration zones (Safe, Warning, Danger).
- **P&L Scenario Heatmap** — Dynamic matrix displaying spot price change vs. specific days to expiry.

### 🧩 Options Strategies Builder
- **29 Pre-built Standard Strategies** — One-click generation of complex setups.
- **Visual Payoff Charts** — Instant generation of expiration profit/loss zones.
- **Real-time Greeks Surface** — 3D projection representations of Delta and Gamma across varying spot prices.

---

## Architecture

```
Options Pricer/
├── src/                          # Frontend (React)
│   ├── App.jsx                   # Tab navigation
│   ├── PaperTradeDashboard.jsx   # Unified Trading Terminal & Portfolio
│   ├── LiveStrategyBuilder.jsx   # Core analytical sandbox
│   ├── bsm.js                    # Pure Black-Scholes-Merton math engine
│   ├── index.css                 # Global styles + design system
│   └── main.jsx                  # React entry point
│
├── server/                       # Backend (Node.js)
│   ├── proxy.js                  # Express server + routing
│   ├── angelOneAuth.js           # Angel One SmartAPI Client & Token Manager
│   ├── scripMaster.js            # Official NSE/NFO token resolution & lot sizes
│   └── src/
│       ├── application/          # Service layer (priceCache, tradeManager)
│       ├── domain/               # Mongoose schemas (User, Trade, SavedStrategy)
│       └── presentation/         # API Routers
│
├── Dockerfile                    # Multi-stage Docker build
├── render.yaml                   # Render deployment config
└── vite.config.js                # Vite build config with proxy
```

### Data Flow

```
┌──────────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│   React UI   │────▸│  Vite Proxy  │────▸│  Node.js Backend    │────▸│ Angel One SmartAPI│
│  (Browser)   │◂────│  /api/*      │◂────│  + Priority Queue   │◂────│   (Market Data)  │
└──────────────┘     └─────────────┘     └─────────────────────┘     └──────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 8, TailwindCSS 4 |
| **Charts** | Recharts 3.8 |
| **Backend** | Express 5, Node.js 20, MongoDB (Mongoose) |
| **Market Data**| Angel One SmartAPI |
| **Deployment** | Docker, Render |
| **Math** | Pure JavaScript BSM engine, Lognormal Integrator, Newton-Raphson |

---

## Getting Started

### Setup Credentials

To fetch live data, the backend requires an Angel One SmartAPI account and a MongoDB connection. Create a `.env` file in the root directory:

```env
ANGEL_CLIENT_ID=your_client_id
ANGEL_PIN=your_4_digit_pin
ANGEL_API_KEY=your_smartapi_key
ANGEL_TOTP_SECRET=your_totp_secret
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_signing_secret
```

### Installation & Running Locally

```bash
# Clone the repository
git clone https://github.com/Bhavya-Dhoot/Options_Pricer_Jm.git
cd Options_Pricer_Jm

# Install dependencies
npm install

# Start both the proxy server and Vite dev server
npm run dev:full
```

The backend server will authenticate with SmartAPI on boot, download the official OpenAPIScripMaster JSON for exact token matching, connect to MongoDB, and start the Round-Robin queue.

---

## Deployment (Render)

This application is fully containerized and designed for deployment on **Render** as a Web Service.

1. Connect your GitHub repository to Render.
2. Ensure you add all `.env` variables into the Render Environment Variables tab.
3. The included `Dockerfile` utilizes a lightweight Node image to serve both the Express backend and the compiled static Vite frontend concurrently from a single dyno.

---

## License

This project is open source and available under the [MIT License](LICENSE).

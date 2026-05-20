# NIFTY Options Pricer

A production-grade Black-Scholes-Merton options pricing engine built with React + Vite, designed for NIFTY index options with real-time NSE data integration.

## Features

### 📊 Options Pricer
- Black-Scholes-Merton pricing with continuous dividend yield
- Full Greeks dashboard (Delta, Gamma, Theta, Vega, Rho)
- Scenario simulator with spot/IV sensitivity charts
- Live NSE data fetching with ATM strike auto-detection

### ⏱️ Theta Decay Simulator
- **Dual decay curves** — BSM theoretical vs market-implied (Newton-Raphson IV solver)
- **Daily theta breakdown** with acceleration zones (danger/warning/safe)
- **Multi-strike comparison** (ITM/ATM/OTM decay comparison)
- **P&L heatmap** (days held × spot price change)
- **Market premium input** — enter what you paid and see real P&L

## Tech Stack

- **Frontend**: React 19 + Vite 8 + Recharts + Lucide Icons
- **Math Engine**: Pure JS Black-Scholes-Merton with analytical Greeks
- **Live Data**: Node.js proxy with Puppeteer (local development only)
- **Deployment**: Vercel (static)

## Deploy on Vercel

1. Import this repo on [vercel.com/new](https://vercel.com/new)
2. Vercel auto-detects Vite — no config changes needed
3. Build command: `npm run build`
4. Output directory: `dist`
5. Click **Deploy**

> **Note**: The "Fetch Live" button requires the local proxy server (`npm run dev:full`). On Vercel, all pricing features work with manual parameter input. The live NSE data feed is local-only because NSE requires a headless browser to bypass Akamai bot protection.

## Local Development

```bash
# Install dependencies
npm install

# Start frontend only (manual inputs)
npm run dev

# Start frontend + NSE proxy (live data)
npm run dev:full
```

## Project Structure

```
src/
├── App.jsx                  # Tab shell (Pricer | Theta Decay)
├── OptionsPricer.jsx        # Main pricing UI
├── ThetaDecaySimulator.jsx  # Theta decay analysis
├── GreeksDashboard.jsx      # Greeks visualization
├── ScenarioSimulator.jsx    # What-if scenario charts
├── bsm.js                   # Black-Scholes-Merton math engine
├── useLiveData.js           # Live NSE data hook
├── index.css                # Design system
└── main.jsx                 # Entry point

server/
├── proxy.js                 # Express proxy for NSE API
└── nse-session.js           # Puppeteer session manager
```

## License

MIT

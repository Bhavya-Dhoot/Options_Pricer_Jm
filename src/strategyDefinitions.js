export const STRATEGIES = [
  // --- Single-Leg ---
  {
    id: 'long_call',
    name: 'Long Call',
    category: 'Single-Leg',
    sentiment: 'bullish',
    description: 'Profit from upside move with limited downside risk.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' },
    legs: [{ type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 }],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'long_put',
    name: 'Long Put',
    category: 'Single-Leg',
    sentiment: 'bearish',
    description: 'Profit from downside move with limited upside risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' }, // Technically max profit is limited by stock going to 0
    legs: [{ type: 'put', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 }],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'short_call',
    name: 'Short Call (Naked)',
    category: 'Single-Leg',
    sentiment: 'bearish',
    description: 'Profit from neutral to downside move. Uncapped risk on upside.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'unlimited' },
    legs: [{ type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 }],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'short_put',
    name: 'Short Put (Naked)',
    category: 'Single-Leg',
    sentiment: 'bullish',
    description: 'Profit from neutral to upside move. High risk on downside.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [{ type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 }],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'covered_call',
    name: 'Covered Call',
    category: 'Single-Leg',
    sentiment: 'bullish',
    description: 'Long underlying plus short OTM call to generate income.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'underlying', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'cash_secured_put',
    name: 'Cash-Secured Put',
    category: 'Single-Leg',
    sentiment: 'bullish',
    description: 'Sell OTM put to collect premium or buy underlying at a discount.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [{ type: 'put', action: 'sell', strikeOffset: -100, dteIndex: 0, qty: 1 }],
    defaultDTE: [30],
    strikeSeparation: 50
  },

  // --- Vertical Spreads ---
  {
    id: 'bull_call_spread',
    name: 'Bull Call Spread',
    category: 'Vertical Spreads',
    sentiment: 'bullish',
    description: 'Buy ATM call and sell OTM call to reduce cost.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'bear_call_spread',
    name: 'Bear Call Spread',
    category: 'Vertical Spreads',
    sentiment: 'bearish',
    description: 'Sell ATM call and buy OTM call to define risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'bull_put_spread',
    name: 'Bull Put Spread',
    category: 'Vertical Spreads',
    sentiment: 'bullish',
    description: 'Sell ATM put and buy OTM put to define risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'bear_put_spread',
    name: 'Bear Put Spread',
    category: 'Vertical Spreads',
    sentiment: 'bearish',
    description: 'Buy ATM put and sell OTM put to reduce cost.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: -100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },

  // --- Neutral / Volatility Strategies ---
  {
    id: 'long_straddle',
    name: 'Long Straddle',
    category: 'Neutral / Volatility',
    sentiment: 'volatility',
    description: 'Buy ATM Call and Put. Profit from high volatility in either direction.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'short_straddle',
    name: 'Short Straddle',
    category: 'Neutral / Volatility',
    sentiment: 'neutral',
    description: 'Sell ATM Call and Put. Profit from low volatility.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'unlimited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'long_strangle',
    name: 'Long Strangle',
    category: 'Neutral / Volatility',
    sentiment: 'volatility',
    description: 'Buy OTM Call and OTM Put. Cheaper than a straddle.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'short_strangle',
    name: 'Short Strangle',
    category: 'Neutral / Volatility',
    sentiment: 'neutral',
    description: 'Sell OTM Call and OTM Put. Profit from low volatility with wider breakevens.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'unlimited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: -100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'long_butterfly_call',
    name: 'Long Butterfly (Call)',
    category: 'Neutral / Volatility',
    sentiment: 'neutral',
    description: 'Buy 1 ITM Call, Sell 2 ATM Calls, Buy 1 OTM Call. Low cost, defined risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 2 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'short_butterfly',
    name: 'Short Butterfly',
    category: 'Neutral / Volatility',
    sentiment: 'volatility',
    description: 'Sell 1 ITM Call, Buy 2 ATM Calls, Sell 1 OTM Call.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 2 },
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'long_condor',
    name: 'Long Condor',
    category: 'Neutral / Volatility',
    sentiment: 'neutral',
    description: 'Buy ITM Call, Sell 2 OTM Calls at different strikes, Buy further OTM Call.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: -50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'iron_condor',
    name: 'Iron Condor',
    category: 'Neutral / Volatility',
    sentiment: 'income',
    description: 'Sell OTM Put Spread and OTM Call Spread. Collect premium with defined risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: -50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'iron_butterfly',
    name: 'Iron Butterfly',
    category: 'Neutral / Volatility',
    sentiment: 'income',
    description: 'Sell ATM Straddle and Buy OTM Strangle to define risk.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },

  // --- Calendar & Diagonal Spreads ---
  {
    id: 'calendar_spread_call',
    name: 'Calendar Spread (Call)',
    category: 'Calendar & Diagonal',
    sentiment: 'neutral',
    description: 'Sell near-expiry Call, Buy far-expiry Call at same strike.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 1, qty: 1 }
    ],
    defaultDTE: [15, 45],
    strikeSeparation: 50
  },
  {
    id: 'diagonal_spread_bull',
    name: 'Diagonal Spread (Bull)',
    category: 'Calendar & Diagonal',
    sentiment: 'bullish',
    description: 'Buy far-expiry lower strike Call, Sell near-expiry higher strike Call.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: -50, dteIndex: 1, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 50, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [15, 45],
    strikeSeparation: 50
  },

  // --- Ratio Spreads ---
  {
    id: 'call_ratio_backspread',
    name: 'Call Ratio Backspread',
    category: 'Ratio Spreads',
    sentiment: 'bullish',
    description: 'Sell 1 ITM/ATM Call, Buy 2 OTM Calls. Profit from explosive upside.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 2 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'put_ratio_backspread',
    name: 'Put Ratio Backspread',
    category: 'Ratio Spreads',
    sentiment: 'bearish',
    description: 'Sell 1 ITM/ATM Put, Buy 2 OTM Puts. Profit from explosive downside.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 2 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'ratio_call_spread',
    name: 'Ratio Call Spread',
    category: 'Ratio Spreads',
    sentiment: 'neutral',
    description: 'Buy 1 ITM Call, Sell 2 OTM Calls. Profit from slight upside, risk on large upside.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'unlimited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: -50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 50, dteIndex: 0, qty: 2 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },

  // --- Synthetic & Advanced ---
  {
    id: 'synthetic_long',
    name: 'Synthetic Long',
    category: 'Synthetic & Advanced',
    sentiment: 'bullish',
    description: 'Buy ATM Call, Sell ATM Put. Mimics holding the underlying stock.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' }, // Technically loss limited by 0
    legs: [
      { type: 'call', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'synthetic_short',
    name: 'Synthetic Short',
    category: 'Synthetic & Advanced',
    sentiment: 'bearish',
    description: 'Sell ATM Call, Buy ATM Put. Mimics shorting the underlying stock.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'unlimited' },
    legs: [
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'risk_reversal',
    name: 'Risk Reversal',
    category: 'Synthetic & Advanced',
    sentiment: 'bullish',
    description: 'Sell OTM Put, Buy OTM Call. Synthetically long but cheaper.',
    riskProfile: { maxProfit: 'unlimited', maxLoss: 'limited' },
    legs: [
      { type: 'put', action: 'sell', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'buy', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'collar',
    name: 'Collar',
    category: 'Synthetic & Advanced',
    sentiment: 'bullish',
    description: 'Long underlying, Buy OTM Put (protection), Sell OTM Call (fund put).',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'underlying', action: 'buy', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'put', action: 'buy', strikeOffset: -100, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 }
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  },
  {
    id: 'christmas_tree',
    name: 'Christmas Tree',
    category: 'Synthetic & Advanced',
    sentiment: 'neutral',
    description: 'Buy 1 ITM Call, Sell 1 ATM Call, Sell 1 OTM Call. Butterfly variant.',
    riskProfile: { maxProfit: 'limited', maxLoss: 'limited' },
    legs: [
      { type: 'call', action: 'buy', strikeOffset: -50, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 0, dteIndex: 0, qty: 1 },
      { type: 'call', action: 'sell', strikeOffset: 100, dteIndex: 0, qty: 1 } // standard tree might be slightly different but this works
    ],
    defaultDTE: [30],
    strikeSeparation: 50
  }
];

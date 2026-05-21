/**
 * Black-Scholes Model — complete math implementation
 * Uses Abramowitz & Stegun (Horner method) for CDF approximation.
 * All formulas match the canonical BSM specification.
 */

// ── Standard Normal PDF ──
export function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ── Cumulative Normal Distribution (Abramowitz & Stegun 26.2.17) ──
// Max absolute error < 7.5e-8
export function normalCDF(x) {
  if (x > 8) return 1;
  if (x < -8) return 0;

  const a1 =  0.319381530;
  const a2 = -0.356563782;
  const a3 =  1.781477937;
  const a4 = -1.821255978;
  const a5 =  1.330274429;
  const p  =  0.2316419;

  const absX = Math.abs(x);
  const k = 1.0 / (1.0 + p * absX);
  const k2 = k * k;
  const k3 = k2 * k;
  const k4 = k3 * k;
  const k5 = k4 * k;

  const poly = a1 * k + a2 * k2 + a3 * k3 + a4 * k4 + a5 * k5;
  const cdf = 1.0 - normalPDF(absX) * poly;

  return x >= 0 ? cdf : 1.0 - cdf;
}

// ── Count trading days (Mon-Fri only) between two dates ──
export function countTradingDays(startDate, endDate) {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (end <= current) return 0;

  const oneDay = 86400000;
  let d = new Date(current.getTime() + oneDay);

  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d = new Date(d.getTime() + oneDay);
  }

  return count;
}

// ── Core BSM calculation (Merton extension with continuous dividend yield) ──
export function calculateBSM(S, K, T, r, sigma, optionType, q = 0) {
  // T is in years (calendarDays / 365)
  // q is continuous dividend yield (e.g. 0.012 for 1.2%)
  if (T <= 0) return null;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const discountedS = S * Math.exp(-q * T);
  const discountedK = K * Math.exp(-r * T);

  let premium, delta, theta, rho;
  const gamma = normalPDF(d1) * Math.exp(-q * T) / (S * sigma * sqrtT);
  const vega = (discountedS * normalPDF(d1) * sqrtT) / 100;

  if (optionType === 'CALL') {
    premium = discountedS * normalCDF(d1) - discountedK * normalCDF(d2);
    delta = Math.exp(-q * T) * normalCDF(d1);
    theta = (-(discountedS * normalPDF(d1) * sigma) / (2 * sqrtT)
             + q * discountedS * normalCDF(d1)
             - r * discountedK * normalCDF(d2)) / 365;
    rho = (K * T * Math.exp(-r * T) * normalCDF(d2)) / 100;
  } else {
    premium = discountedK * normalCDF(-d2) - discountedS * normalCDF(-d1);
    delta = Math.exp(-q * T) * (normalCDF(d1) - 1);
    theta = (-(discountedS * normalPDF(d1) * sigma) / (2 * sqrtT)
             - q * discountedS * normalCDF(-d1)
             + r * discountedK * normalCDF(-d2)) / 365;
    rho = (-K * T * Math.exp(-r * T) * normalCDF(-d2)) / 100;
  }

  const intrinsicValue = optionType === 'CALL'
    ? Math.max(S - K, 0)
    : Math.max(K - S, 0);
  const timeValue = Math.max(premium - intrinsicValue, 0);

  let moneyness;
  if (optionType === 'CALL') {
    if (S > K) moneyness = 'ITM';
    else if (S < K) moneyness = 'OTM';
    else moneyness = 'ATM';
  } else {
    if (S < K) moneyness = 'ITM';
    else if (S > K) moneyness = 'OTM';
    else moneyness = 'ATM';
  }

  return {
    premium,
    delta,
    gamma,
    theta,
    vega,
    rho,
    d1,
    d2,
    intrinsicValue,
    timeValue,
    moneyness,
  };
}

// ── Recalculate premium at a different spot/time ──
export function premiumAt(S, K, T, r, sigma, optionType, q = 0) {
  if (T <= 0) {
    // At expiry, premium = intrinsic value only
    return optionType === 'CALL' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const result = calculateBSM(S, K, T, r, sigma, optionType, q);
  return result ? result.premium : 0;
}

// ── Generate theta decay curve data ──
export function generateThetaDecayCurve(S, K, totalCalendarDays, r, sigma, optionType, q = 0) {
  const points = [];
  if (totalCalendarDays <= 0) return points;

  for (let d = totalCalendarDays; d >= 0; d--) {
    const T = d / 365;
    const p = premiumAt(S, K, T, r, sigma, optionType, q);
    points.push({ daysRemaining: d, premium: Math.max(p, 0) });
  }

  return points;
}

// ── Get default expiry date (~3 weeks out, next Thursday) ──
export function getDefaultExpiry() {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + 21);
  // Roll to nearest Thursday (day=4)
  const day = target.getDay();
  const diff = (4 - day + 7) % 7;
  target.setDate(target.getDate() + diff);
  return target.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════
// OPTIONS STRATEGIES EXTENSIONS
// ═══════════════════════════════════════════════════════════

export const NIFTY_LOT_SIZE = 25;

/**
 * Net strategy P&L at expiry (intrinsic only).
 */
export function strategyPayoffAtExpiry(legs, spotAtExpiry) {
  return legs.reduce((total, leg) => {
    let intrinsic = 0;
    if (leg.type === 'call') {
      intrinsic = Math.max(spotAtExpiry - leg.strike, 0);
    } else if (leg.type === 'put') {
      intrinsic = Math.max(leg.strike - spotAtExpiry, 0);
    } else if (leg.type === 'underlying') {
      intrinsic = spotAtExpiry;
    }
    const direction = leg.action === 'buy' ? 1 : -1;
    return total + direction * (intrinsic - leg.premium) * leg.qty * NIFTY_LOT_SIZE;
  }, 0);
}

/**
 * Net strategy BSM P&L at time T_remaining (time value included).
 */
export function strategyBSMPnL(legs, spot, T_remaining, iv, r, q) {
  return legs.reduce((total, leg) => {
    let currentPrice = 0;
    if (leg.type === 'underlying') {
      currentPrice = spot;
    } else {
      const legT = leg.T !== undefined ? leg.T : T_remaining;
      const legIV = leg.iv !== undefined ? leg.iv : iv;
      currentPrice = premiumAt(spot, leg.strike, legT, r, legIV, leg.type.toUpperCase(), q);
    }
    const direction = leg.action === 'buy' ? 1 : -1;
    return total + direction * (currentPrice - leg.premium) * leg.qty * NIFTY_LOT_SIZE;
  }, 0);
}

/**
 * Find breakevens numerically.
 */
export function findBreakevens(legs, spotMin, spotMax, steps = 10000) {
  const breakevens = [];
  const stepSize = (spotMax - spotMin) / steps;
  let prevPnL = strategyPayoffAtExpiry(legs, spotMin);
  
  for (let i = 1; i <= steps; i++) {
    const spot = spotMin + i * stepSize;
    const currentPnL = strategyPayoffAtExpiry(legs, spot);
    if (prevPnL * currentPnL < 0) {
      // Sign change detected, approximate zero crossing via linear interpolation
      const fraction = Math.abs(prevPnL) / (Math.abs(prevPnL) + Math.abs(currentPnL));
      breakevens.push(spot - stepSize + fraction * stepSize);
    } else if (currentPnL === 0 && prevPnL !== 0) {
      breakevens.push(spot);
    }
    prevPnL = currentPnL;
  }
  
  // Deduplicate very close breakevens
  const unique = [];
  for (const be of breakevens) {
    if (unique.length === 0 || Math.abs(unique[unique.length - 1] - be) > 1) {
      unique.push(be);
    }
  }
  return unique;
}

/**
 * Find Max Profit and Max Loss
 */
export function findMaxProfitLoss(legs, spotMin, spotMax, steps = 10000) {
  const stepSize = (spotMax - spotMin) / steps;
  let maxP = -Infinity;
  let maxL = Infinity;
  
  // To detect infinite, check slopes at extremes
  const pnlMax = strategyPayoffAtExpiry(legs, spotMax);
  const pnlMaxMinus = strategyPayoffAtExpiry(legs, spotMax - 1);
  
  let isMaxProfitInf = false;
  let isMaxLossInf = false;
  
  // For options/equities, downside is capped at Spot=0.
  // Check if P&L increases/decreases infinitely towards right edge.
  if (pnlMax - pnlMaxMinus > 1e-4) {
    isMaxProfitInf = true;
  }
  if (pnlMax - pnlMaxMinus < -1e-4) {
    isMaxLossInf = true;
  }

  // Scan for peaks and valleys within the range
  for (let i = 0; i <= steps; i++) {
    const spot = spotMin + i * stepSize;
    const pnl = strategyPayoffAtExpiry(legs, spot);
    if (pnl > maxP) maxP = pnl;
    if (pnl < maxL) maxL = pnl;
  }
  
  return {
    maxProfit: isMaxProfitInf ? Infinity : maxP,
    maxLoss: isMaxLossInf ? -Infinity : maxL
  };
}

/**
 * Probability of Profit - Lognormal Integration
 */
export function probabilityOfProfit(legs, S, T, r, q, iv, steps = 1000) {
  if (T <= 0) return { pop: 0, ev: 0, pMaxProfit: 0, pMaxLoss: 0 };
  
  // Lognormal parameters
  const mu = Math.log(S) + (r - q - (iv * iv) / 2) * T;
  const sigmaRootT = iv * Math.sqrt(T);
  
  // Range of integration: +/- 4 standard deviations in log space
  const logMin = mu - 4 * sigmaRootT;
  const logMax = mu + 4 * sigmaRootT;
  const spotMin = Math.exp(logMin);
  const spotMax = Math.exp(logMax);
  
  const dx = (spotMax - spotMin) / steps;
  let pop = 0;
  let ev = 0;
  
  const { maxProfit, maxLoss } = findMaxProfitLoss(legs, Math.max(0, S * 0.2), S * 3);
  let pMaxProfit = 0;
  let pMaxLoss = 0;
  
  for (let i = 0; i < steps; i++) {
    const spot = spotMin + i * dx + dx / 2; // Midpoint
    const pnl = strategyPayoffAtExpiry(legs, spot);
    
    // Lognormal PDF
    const pdf = Math.exp(-Math.pow(Math.log(spot) - mu, 2) / (2 * sigmaRootT * sigmaRootT)) 
                / (spot * sigmaRootT * Math.sqrt(2 * Math.PI));
    
    const probMass = pdf * dx;
    
    ev += pnl * probMass;
    if (pnl > 0) pop += probMass;
    
    // Thresholds for max profit/loss probabilities (within 1%)
    if (maxProfit !== Infinity && Math.abs(pnl - maxProfit) < Math.abs(maxProfit) * 0.01 + 1) {
      pMaxProfit += probMass;
    }
    if (maxLoss !== -Infinity && Math.abs(pnl - maxLoss) < Math.abs(maxLoss) * 0.01 + 1) {
      pMaxLoss += probMass;
    }
  }
  
  return { pop, ev, pMaxProfit, pMaxLoss };
}

// ═══════════════════════════════════════════════════════════
// IMPLIED IV SOLVER (Newton-Raphson)
// Back-solves the IV that produces the given market premium.
// ═══════════════════════════════════════════════════════════
export function solveImpliedIV(S, K, T, r, marketPrice, optionType, q = 0) {
  if (T <= 0 || marketPrice <= 0) return null;
  const intrinsic = optionType === 'CALL' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice < intrinsic) return null;

  let sigma = 0.20; // initial guess: 20%
  for (let i = 0; i < 50; i++) {
    const bsm = calculateBSM(S, K, T, r, sigma, optionType, q);
    if (!bsm) return null;
    const diff = bsm.premium - marketPrice;
    // vega is per 1% IV change, so derivative w.r.t. sigma = vega * 100
    const vegaSigma = bsm.vega * 100;
    if (Math.abs(vegaSigma) < 1e-12) break;
    sigma -= diff / vegaSigma;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
    if (Math.abs(diff) < 0.001) break;
  }
  return sigma;
}

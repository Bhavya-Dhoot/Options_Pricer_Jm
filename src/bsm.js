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

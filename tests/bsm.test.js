import { describe, it, expect } from 'vitest';
import { solveImpliedIV, normalCDF } from '../src/bsm.js';

describe('BSM Math Engine Validation', () => {
  it('should correctly approximate CDF using Horner method', () => {
    // Standard normal distribution known values
    expect(normalCDF(0)).toBeCloseTo(0.5, 3);
    expect(normalCDF(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCDF(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('should accurately calculate Implied Volatility for CALL options', async () => {
    const spot = 24500;
    const strike = 24500;
    const t = 30 / 365; // 30 DTE
    const r = 0.065; // 6.5% risk free
    const q = 0.012; // 1.2% dividend
    const targetPremium = 350;

    // IV Solver Newton-Raphson simulation
    const iv = await solveImpliedIV(spot, strike, t, r, targetPremium, 'CALL', q, 0.15);
    
    // Result should be roughly around 14-16% for these parameters
    expect(iv).toBeGreaterThan(0.05);
    expect(iv).toBeLessThan(0.30);
  });

  it('should accurately calculate Implied Volatility for PUT options', async () => {
    const spot = 24500;
    const strike = 24500;
    const t = 30 / 365;
    const r = 0.065;
    const q = 0.012;
    const targetPremium = 320; // Put is generally slightly cheaper or similar depending on rates

    const iv = await solveImpliedIV(spot, strike, t, r, targetPremium, 'PUT', q, 0.15);
    
    expect(iv).toBeGreaterThan(0.05);
    expect(iv).toBeLessThan(0.30);
  });
});

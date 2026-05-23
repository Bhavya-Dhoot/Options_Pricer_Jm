/**
 * marginCalculator.js
 * 
 * Provides rule-based margin estimation for Options and Futures strategies.
 * Note: Actual margin is calculated by the broker using SPAN + Exposure. 
 * This is an approximation for UI planning purposes.
 */

export const getLotSize = (symbol) => {
  if (symbol === 'NIFTY') return 25;
  if (symbol === 'BANKNIFTY') return 15;
  if (symbol === 'FINNIFTY') return 40;
  if (symbol === 'MIDCPNIFTY') return 75;
  if (symbol === 'SENSEX') return 10;
  if (symbol === 'BANKEX') return 15;
  return 1;
};

export function estimateMargin(legs, spotPrice, symbol = 'NIFTY') {
  const zeroMargin = {
    spanMargin: 0,
    exposureMargin: 0,
    additionalMargin: 0,
    preExpiryMargin: 0,
    exposureSpreadBenefit: 0,
    specialMargin: 0,
    tenderMargin: 0,
    deliveryMargin: 0,
    totalMarginRequired: 0
  };

  if (!legs || legs.length === 0 || !spotPrice) return zeroMargin;
  
  const lotSize = legs[0]?.lotSize || getLotSize(symbol);
  
  let totalMargin = 0;
  
  // Naked margin percentages (approximate for indices)
  const NAKED_SHORT_OPT_PERCENT = 0.15; // 15% of contract value
  const FUTURE_MARGIN_PERCENT = 0.12;   // 12% of contract value
  
  const parseExpiry = (expiryStr) => {
    if (!expiryStr) return 0;
    try {
      const day = parseInt(expiryStr.slice(0, 2), 10);
      const monthStr = expiryStr.slice(3, 6);
      const year = parseInt(expiryStr.slice(7), 10);
      const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
      const month = months[monthStr];
      if (month === undefined) return 0;
      return new Date(year, month, day).getTime();
    } catch (e) {
      return 0;
    }
  };

  const processedLegs = legs.map(l => ({ ...l, expiryTime: parseExpiry(l.expiry) }));

  const longCalls = processedLegs.filter(l => l.type === 'call' && l.action === 'buy');
  const shortCalls = processedLegs.filter(l => l.type === 'call' && l.action === 'sell');
  const longPuts = processedLegs.filter(l => l.type === 'put' && l.action === 'buy');
  const shortPuts = processedLegs.filter(l => l.type === 'put' && l.action === 'sell');
  const longFutures = processedLegs.filter(l => l.type === 'future' && l.action === 'buy');
  const shortFutures = processedLegs.filter(l => l.type === 'future' && l.action === 'sell');
  const futures = processedLegs.filter(l => l.type === 'future');
  
  // 1. Long Options (Premium is paid in cash, NOT held as Margin)
  // The net premium is already calculated and displayed separately in the UI.

  // 2. Futures Margin
  // Calculate directional margin for ALL futures first.
  futures.forEach(leg => {
    const futureMargin = (leg.premium || spotPrice) * lotSize * leg.qty * FUTURE_MARGIN_PERCENT;
    totalMargin += futureMargin;
  });

  // 3. Futures Hedging (Covered Calls & Covered Puts)
  const availableLongFutures = JSON.parse(JSON.stringify(longFutures));
  const availableShortFutures = JSON.parse(JSON.stringify(shortFutures));

  shortCalls.forEach(shortCall => {
    let remainingQty = shortCall.qty;
    for (let i = 0; i < availableLongFutures.length; i++) {
      const fut = availableLongFutures[i];
      if (fut.qty <= 0) continue;
      // Future expiry must be >= option expiry to cover it safely
      if (fut.expiryTime === 0 || fut.expiryTime >= shortCall.expiryTime) {
        const hedgedQty = Math.min(remainingQty, fut.qty);
        remainingQty -= hedgedQty;
        fut.qty -= hedgedQty;
        if (remainingQty === 0) break;
      }
    }
    shortCall.qty = remainingQty;
  });

  shortPuts.forEach(shortPut => {
    let remainingQty = shortPut.qty;
    for (let i = 0; i < availableShortFutures.length; i++) {
      const fut = availableShortFutures[i];
      if (fut.qty <= 0) continue;
      if (fut.expiryTime === 0 || fut.expiryTime >= shortPut.expiryTime) {
        const hedgedQty = Math.min(remainingQty, fut.qty);
        remainingQty -= hedgedQty;
        fut.qty -= hedgedQty;
        if (remainingQty === 0) break;
      }
    }
    shortPut.qty = remainingQty;
  });

  // 4. Option Spreads (Debit & Credit Spreads)
  const processShorts = (shorts, longs, isCall) => {
    let margin = 0;
    
    // Sort shorts from most ATM to OTM to pair logically
    const sortedShorts = [...shorts].sort((a, b) => isCall ? a.strike - b.strike : b.strike - a.strike);
    const availableLongs = [...longs].sort((a, b) => isCall ? a.strike - b.strike : b.strike - a.strike);
    
    sortedShorts.forEach(shortLeg => {
      let remainingShortQty = shortLeg.qty;
      if (remainingShortQty <= 0) return;
      
      for (let i = 0; i < availableLongs.length; i++) {
        const longLeg = availableLongs[i];
        if (longLeg.qty <= 0) continue;
        
        // Phase 1: Expiry Matching (Long must expire >= Short to be a valid hedge)
        if (longLeg.expiryTime > 0 && shortLeg.expiryTime > 0 && longLeg.expiryTime < shortLeg.expiryTime) {
          continue; // Cannot hedge with a shorter-dated option (reverse calendar risk)
        }
        
        const hedgedQty = Math.min(remainingShortQty, longLeg.qty);
        if (hedgedQty <= 0) continue;
        
        // Phase 2: Debit vs Credit Spread
        const isCreditSpread = isCall ? longLeg.strike > shortLeg.strike : longLeg.strike < shortLeg.strike;
        
        if (isCreditSpread) {
          // Spread max loss = Width of spread * lotsize * qty
          const width = Math.abs(longLeg.strike - shortLeg.strike);
          const spreadRisk = width * lotSize * hedgedQty;
          margin += spreadRisk;
        } else {
          // Debit spread: The short option is fully protected by the deeper ITM long option.
          // Margin requirement for the spread structure is 0.
          margin += 0;
        }
        
        remainingShortQty -= hedgedQty;
        longLeg.qty -= hedgedQty; // consume the hedge
        
        if (remainingShortQty === 0) break;
      }
      
      // Any unhedged remaining quantity is a naked short
      if (remainingShortQty > 0) {
        const nakedMargin = spotPrice * lotSize * remainingShortQty * NAKED_SHORT_OPT_PERCENT;
        margin += nakedMargin;
      }
    });
    
    return margin;
  };

  const _longCalls = JSON.parse(JSON.stringify(longCalls));
  const _longPuts = JSON.parse(JSON.stringify(longPuts));
  
  totalMargin += processShorts(shortCalls, _longCalls, true);
  totalMargin += processShorts(shortPuts, _longPuts, false);
  
  // Split into SPAN and Exposure (Approximation: 80% SPAN, 20% Exposure)
  const spanMargin = totalMargin * 0.80;
  const exposureMargin = totalMargin * 0.20;
  
  return {
    spanMargin: spanMargin,
    exposureMargin: exposureMargin,
    additionalMargin: 0,
    preExpiryMargin: 0,
    exposureSpreadBenefit: 0,
    specialMargin: 0,
    tenderMargin: 0,
    deliveryMargin: 0,
    totalMarginRequired: totalMargin
  };
}

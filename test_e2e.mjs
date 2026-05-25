import axios from 'axios';

const API_URL = 'http://localhost:3001/api';
let token = '';

async function runTests() {
  console.log('--- Starting Options Pricer E2E Tests ---');

  try {
    console.log('[1/5] Registering test user...');
    const username = `testuser_${Date.now()}`;
    const registerRes = await axios.post(`${API_URL}/auth/register`, {
      username,
      password: 'password123'
    });
    token = registerRes.data.token;
    
    let profile = await axios.get(`${API_URL}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } });
    let startingCapital = profile.data.virtualCapital;
    console.log(`Starting capital: ₹${startingCapital.toFixed(2)}`);

    console.log('[2/5] Waiting for backend to fetch live NIFTY prices (Polling due to rate limits)...');
    let niftyData = null;
    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 3000));
        console.log(`Fetching live NIFTY prices... (Attempt ${i+1})`);
        const liveRes = await axios.get(`${API_URL}/trades/live-prices?symbols=NIFTY`, { headers: { Authorization: `Bearer ${token}` } });
        if (liveRes.data && liveRes.data.NIFTY && liveRes.data.NIFTY.byExpiry) {
            niftyData = liveRes.data.NIFTY;
            break;
        }
    }
    
    if (!niftyData) {
        throw new Error('NIFTY Market data unavailable after polling. Rate limit might be stuck.');
    }
    const expiries = Object.keys(niftyData.byExpiry);
    const firstExpiry = expiries[0];
    const chain = niftyData.byExpiry[firstExpiry];
    
    // Find a strike with valid askPrice to buy
    const validOpt = chain.find(s => s.call && s.call.askPrice > 0);
    if (!validOpt) throw new Error('No valid call option found with askPrice');
    const targetStrike = validOpt.strikePrice || validOpt.strike;
    const expectedPremium = validOpt.call.askPrice;

    console.log(`[3/5] Test: Buy Long Call Option (Strike: ${targetStrike}, Expiry: ${firstExpiry})`);
    const buyRes = await axios.post(`${API_URL}/trades/batch`, {
      legs: [{
        symbol: 'NIFTY',
        type: 'call',
        action: 'buy',
        strike: targetStrike,
        expiry: firstExpiry,
        qty: 1,
        lotSize: 25,
        orderType: 'market'
      }]
    }, { headers: { Authorization: `Bearer ${token}` } });
    
    const tradeId = buyRes.data[0]._id;
    const executedPrice = buyRes.data[0].entryPrice;
    const executedLotSize = buyRes.data[0].lotSize;
    console.log(`Trade executed! ID: ${tradeId}, Entry Price: ₹${executedPrice}, Lot Size: ${executedLotSize}`);

    profile = await axios.get(`${API_URL}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } });
    let postBuyCapital = profile.data.virtualCapital;
    console.log(`Capital after buy: ₹${postBuyCapital.toFixed(2)}`);
    
    const expectedCapital = startingCapital - (executedPrice * 1 * executedLotSize);
    if (Math.abs(postBuyCapital - expectedCapital) > 0.01) {
        throw new Error(`CASHFLOW MISMATCH! Expected ${expectedCapital}, Got ${postBuyCapital}`);
    }
    console.log('-> SUCCESS: Capital correctly deducted on purchase.');

    console.log('[4/5] Test: Symbol Consistency Cross-Leg Exploit');
    try {
        await axios.post(`${API_URL}/trades/batch`, {
          legs: [
            { symbol: 'NIFTY', type: 'future', action: 'buy', expiry: firstExpiry, qty: 1, orderType: 'market' },
            { symbol: 'RELIANCE', type: 'future', action: 'buy', expiry: firstExpiry, qty: 1, orderType: 'market' }
          ]
        }, { headers: { Authorization: `Bearer ${token}` } });
        throw new Error('Exploit succeeded! Batch trade mixed symbols were not rejected.');
    } catch (e) {
        if (e.response && e.response.status === 400 && e.response.data.error.includes('mix symbols')) {
            console.log('-> SUCCESS: Symbol Exploit correctly blocked by server: ' + e.response.data.error);
        } else {
            throw e;
        }
    }

    console.log('[5/5] Test: Sell to Close & Verify Exit Cashflow');
    const exitRes = await axios.post(`${API_URL}/trades/exit`, {
        tradeId,
        exitQty: 1,
        exitPrice: 0 // Market exit
    }, { headers: { Authorization: `Bearer ${token}` } });
    
    const exitPrice = exitRes.data.exitPrice;
    console.log(`Trade closed at ₹${exitPrice}. PnL: ₹${exitRes.data.realizedPnL}`);
    
    profile = await axios.get(`${API_URL}/auth/profile`, { headers: { Authorization: `Bearer ${token}` } });
    let postExitCapital = profile.data.virtualCapital;
    console.log(`Final Capital: ₹${postExitCapital.toFixed(2)}`);
    
    const finalExpectedCapital = postBuyCapital + (exitPrice * 1 * executedLotSize);
    if (Math.abs(postExitCapital - finalExpectedCapital) > 0.01) {
        throw new Error(`EXIT CASHFLOW MISMATCH! Expected ${finalExpectedCapital}, Got ${postExitCapital}`);
    }
    console.log('-> SUCCESS: Capital correctly credited on exit. Cashflow ledger is perfectly balanced!');

    console.log('\n✅ ALL E2E TESTS PASSED SUCCESSFULLY! The paper trading portal is robust.');

  } catch (error) {
      console.error('\n❌ E2E TEST FAILED!');
      if (error.response) {
          console.error(error.response.data);
      } else {
          console.error(error.message);
      }
      process.exit(1);
  }
}

runTests();

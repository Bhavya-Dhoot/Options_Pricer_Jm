import { ensureScripMasterInitialized, getAvailableExpiries } from './server/scripMaster.js';

async function testExpiries() {
    await ensureScripMasterInitialized();
    console.log('BANKNIFTY Expiries:', getAvailableExpiries('BANKNIFTY'));
    console.log('SIEMENS Expiries:', getAvailableExpiries('SIEMENS'));
}
testExpiries();

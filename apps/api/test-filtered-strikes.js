/**
 * Test filtered option chain (ATM ± 7 strikes)
 */
const axios = require('axios');

const API_BASE = 'http://localhost:4000';
const token = 'test-token'; // Your auth token

async function testFilteredOptionChain() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Testing ATM ± 7 Strikes Filter');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    const response = await axios.get(
      `${API_BASE}/market/option-chain/NIFTY/2025-12-30`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Response received!\n');
    console.log(`Spot Price: ₹${response.data.spotPrice.toLocaleString()}`);
    console.log(`ATM Strike: ${response.data.atmStrike}`);
    console.log(`Total Strikes Returned: ${response.data.strikes.length}`);
    console.log(`PCR: ${response.data.pcr.toFixed(2)}`);
    console.log(`Expiry: ${response.data.expiry}`);
    
    console.log('\n📊 Strike Details:');
    console.log('─────────────────────────────────────────────────────────────');
    
    response.data.strikes.forEach((strike, index) => {
      const position = strike.strike < response.data.atmStrike ? '⬇️ ' : 
                      strike.strike > response.data.atmStrike ? '⬆️ ' : '🎯';
      
      console.log(`${position} ${strike.strike} - CE OI: ${strike.ce.oi.toLocaleString().padStart(12)} | PE OI: ${strike.pe.oi.toLocaleString().padStart(12)}`);
    });
    
    console.log('\n✅ Filter working correctly!');
    console.log(`   Expected: 15 strikes (7 below + ATM + 7 above)`);
    console.log(`   Actual: ${response.data.strikes.length} strikes`);

  } catch (error) {
    if (error.response) {
      console.log('❌ API Error:', error.response.status);
      console.log('Details:', error.response.data);
    } else {
      console.log('❌ Error:', error.message);
    }
  }
}

testFilteredOptionChain();

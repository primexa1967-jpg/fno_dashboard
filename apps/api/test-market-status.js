/**
 * Test market status by checking spot prices
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testMarketStatus() {
  console.log('🔍 Testing market status by checking NIFTY spot price...\n');

  try {
    const response = await axios.post(
      'https://api.dhan.co/v2/marketfeed/quote',
      {
        "NSE_EQ": [],
        "NSE_FNO": [],
        "NSE_CURRENCY": [],
        "NSE_INDEX": ["13"], // NIFTY
        "BSE_EQ": [],
        "BSE_INDEX": [],
        "MCX": []
      },
      {
        headers: {
          'access-token': token,
          'client-id': clientId,
          'Content-Type': 'application/json',
        },
        timeout: 15000
      }
    );
    
    console.log('✅ Spot price response received!');
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.status === 'success' && response.data.data['NSE_INDEX']) {
      const niftyData = response.data.data['NSE_INDEX']['13'];
      if (niftyData) {
        console.log('\n📊 NIFTY Status:');
        console.log(`  LTP: ₹${niftyData.LTP}`);
        console.log(`  Open: ₹${niftyData.open}`);
        console.log(`  High: ₹${niftyData.high}`);
        console.log(`  Low: ₹${niftyData.low}`);
        console.log(`  Volume: ${niftyData.volume}`);
        console.log(`  Last trade time: ${niftyData.last_trade_time}`);
        
        if (niftyData.volume > 0) {
          console.log('\n✅ MARKET IS TRADING (Volume > 0)');
        } else {
          console.log('\n⚠️ NO TRADING VOLUME - Market might be closed');
        }
      }
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ FAILED:', error.response.status, error.response.data);
    } else {
      console.log('❌ ERROR:', error.message);
    }
  }
}

testMarketStatus();

/**
 * NIFTY50 Option Chain - ATM Strikes (7 above + 7 below)
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function getATMStrikes() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  NIFTY50 OPTION CHAIN - ATM STRIKES ANALYSIS');
  console.log('  Expiry: December 30, 2025');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const url = 'https://api.dhan.co/v2/optionchain';
  const payload = {
    UnderlyingScrip: 13,
    UnderlyingSeg: 'IDX_I',
    Expiry: '2025-12-30'
  };

  console.log('📋 API REQUEST');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`URL: ${url}`);
  console.log('Method: POST');
  console.log('Payload:', JSON.stringify(payload, null, 2));
  console.log('\n');

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'access-token': token,
        'client-id': clientId,
        'Content-Type': 'application/json',
      },
      timeout: 15000
    });

    console.log('✅ API RESPONSE RECEIVED');
    console.log('─────────────────────────────────────────────────────────────\n');
    console.log(`Status: ${response.data.status}`);
    console.log(`Spot Price: ₹${response.data.data.last_price.toLocaleString()}\n`);

    if (response.data.data?.oc) {
      const spotPrice = response.data.data.last_price;
      const optionChain = response.data.data.oc;
      
      // Get all strikes and sort them
      const allStrikes = Object.keys(optionChain)
        .map(strike => parseFloat(strike))
        .sort((a, b) => a - b);
      
      console.log(`Total Strikes Available: ${allStrikes.length}`);
      console.log(`Strike Range: ${allStrikes[0]} - ${allStrikes[allStrikes.length - 1]}\n`);

      // Find ATM strike (closest to spot)
      const atmStrike = allStrikes.reduce((closest, strike) => {
        const currentDiff = Math.abs(strike - spotPrice);
        const closestDiff = Math.abs(closest - spotPrice);
        return currentDiff < closestDiff ? strike : closest;
      });

      console.log(`🎯 ATM Strike: ${atmStrike} (Spot: ${spotPrice})`);
      console.log(`   Difference: ${Math.abs(atmStrike - spotPrice).toFixed(2)} points\n`);

      // Get ATM index
      const atmIndex = allStrikes.indexOf(atmStrike);
      
      // Get 7 strikes above and 7 below ATM
      const startIndex = Math.max(0, atmIndex - 7);
      const endIndex = Math.min(allStrikes.length - 1, atmIndex + 7);
      const relevantStrikes = allStrikes.slice(startIndex, endIndex + 1);

      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`  SHOWING ${relevantStrikes.length} STRIKES (7 Below + ATM + 7 Above)`);
      console.log('═══════════════════════════════════════════════════════════════\n');

      relevantStrikes.forEach((strike, index) => {
        const strikeKey = strike.toFixed(6);
        const strikeData = optionChain[strikeKey];
        
        if (!strikeData) return;

        const isATM = strike === atmStrike;
        const position = strike < atmStrike ? 'OTM' : strike > atmStrike ? 'OTM' : 'ATM';
        
        console.log('─────────────────────────────────────────────────────────────');
        console.log(`Strike: ${strike} ${isATM ? '🎯 [ATM]' : `[${position}]`}`);
        console.log('─────────────────────────────────────────────────────────────');
        
        // Call Option (CE)
        const ce = strikeData.ce;
        console.log('\n📗 CALL OPTION (CE):');
        console.log(`   Security ID: ${ce.security_id}`);
        console.log(`   LTP: ₹${ce.last_price.toFixed(2)}`);
        console.log(`   Previous Close: ₹${ce.previous_close_price.toFixed(2)}`);
        console.log(`   Change: ₹${(ce.last_price - ce.previous_close_price).toFixed(2)}`);
        console.log(`   OI: ${ce.oi.toLocaleString()}`);
        console.log(`   OI Change: ${(ce.oi - ce.previous_oi).toLocaleString()}`);
        console.log(`   Volume: ${ce.volume.toLocaleString()}`);
        console.log(`   IV: ${ce.implied_volatility.toFixed(2)}%`);
        console.log(`   Bid: ₹${ce.top_bid_price} (${ce.top_bid_quantity})`);
        console.log(`   Ask: ₹${ce.top_ask_price} (${ce.top_ask_quantity})`);
        console.log(`   Greeks:`);
        console.log(`     Delta: ${ce.greeks.delta.toFixed(4)}`);
        console.log(`     Gamma: ${ce.greeks.gamma.toFixed(4)}`);
        console.log(`     Theta: ${ce.greeks.theta.toFixed(4)}`);
        console.log(`     Vega: ${ce.greeks.vega.toFixed(4)}`);

        // Put Option (PE)
        const pe = strikeData.pe;
        console.log('\n📕 PUT OPTION (PE):');
        console.log(`   Security ID: ${pe.security_id}`);
        console.log(`   LTP: ₹${pe.last_price.toFixed(2)}`);
        console.log(`   Previous Close: ₹${pe.previous_close_price.toFixed(2)}`);
        console.log(`   Change: ₹${(pe.last_price - pe.previous_close_price).toFixed(2)}`);
        console.log(`   OI: ${pe.oi.toLocaleString()}`);
        console.log(`   OI Change: ${(pe.oi - pe.previous_oi).toLocaleString()}`);
        console.log(`   Volume: ${pe.volume.toLocaleString()}`);
        console.log(`   IV: ${pe.implied_volatility.toFixed(2)}%`);
        console.log(`   Bid: ₹${pe.top_bid_price} (${pe.top_bid_quantity})`);
        console.log(`   Ask: ₹${pe.top_ask_price} (${pe.top_ask_quantity})`);
        console.log(`   Greeks:`);
        console.log(`     Delta: ${pe.greeks.delta.toFixed(4)}`);
        console.log(`     Gamma: ${pe.greeks.gamma.toFixed(4)}`);
        console.log(`     Theta: ${pe.greeks.theta.toFixed(4)}`);
        console.log(`     Vega: ${pe.greeks.vega.toFixed(4)}`);

        // PCR calculation
        const pcr = ce.oi > 0 ? (pe.oi / ce.oi).toFixed(2) : 0;
        console.log(`\n   📊 PCR (Put-Call Ratio): ${pcr}`);
        console.log('');
      });

      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  COMPLETE JSON FOR ATM STRIKES');
      console.log('═══════════════════════════════════════════════════════════════\n');

      const atmStrikesData = {};
      relevantStrikes.forEach(strike => {
        const strikeKey = strike.toFixed(6);
        atmStrikesData[strikeKey] = optionChain[strikeKey];
      });

      console.log(JSON.stringify({
        spot_price: spotPrice,
        atm_strike: atmStrike,
        expiry: '2025-12-30',
        strikes_count: relevantStrikes.length,
        option_chain: atmStrikesData
      }, null, 2));

    }

  } catch (error) {
    console.log('❌ REQUEST FAILED\n');
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log('Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('Error:', error.message);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

getATMStrikes();

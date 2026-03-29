/**
 * Detailed API call test for NIFTY50 Option Chain
 * Shows complete request/response details
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testNiftyOptionChain() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DHAN API CALL - NIFTY50 OPTION CHAIN');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // API Call Details
  const url = 'https://api.dhan.co/v2/optionchain';
  const headers = {
    'access-token': token,
    'client-id': clientId,
    'Content-Type': 'application/json',
  };
  const payload = {
    UnderlyingScrip: 13,        // NIFTY security ID
    UnderlyingSeg: 'IDX_I',     // Index segment
    Expiry: '2025-12-30'        // Today's expiry
  };

  console.log('📋 REQUEST DETAILS');
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log('URL:');
  console.log(`  ${url}\n`);
  
  console.log('METHOD:');
  console.log('  POST\n');
  
  console.log('HEADERS:');
  console.log('  {');
  console.log(`    "access-token": "${token.substring(0, 30)}...${token.substring(token.length - 10)}",`);
  console.log(`    "client-id": "${clientId}",`);
  console.log('    "Content-Type": "application/json"');
  console.log('  }\n');
  
  console.log('PAYLOAD:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SENDING REQUEST...');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    const startTime = Date.now();
    const response = await axios.post(url, payload, {
      headers: headers,
      timeout: 15000
    });
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    console.log('✅ RESPONSE RECEIVED\n');
    console.log('─────────────────────────────────────────────────────────────\n');
    console.log('STATUS CODE:');
    console.log(`  ${response.status} ${response.statusText}\n`);
    
    console.log('RESPONSE TIME:');
    console.log(`  ${responseTime}ms\n`);
    
    console.log('RESPONSE HEADERS:');
    console.log('  {');
    Object.keys(response.headers).slice(0, 5).forEach(key => {
      console.log(`    "${key}": "${response.headers[key]}"`);
    });
    console.log('  }\n');

    console.log('RESPONSE BODY:');
    console.log('─────────────────────────────────────────────────────────────');
    
    // Show response structure
    console.log('\nStatus:', response.data.status);
    
    if (response.data.data) {
      console.log('\nData structure:');
      console.log('  - last_price:', response.data.data.last_price);
      console.log('  - oc: (option chain object)');
      
      if (response.data.data.oc) {
        const strikes = Object.keys(response.data.data.oc);
        console.log(`  - Total strikes: ${strikes.length}`);
        
        if (strikes.length > 0) {
          // Show first strike details
          const firstStrike = strikes[0];
          console.log(`\n📊 Sample Strike Data (${firstStrike}):`);
          console.log('─────────────────────────────────────────────────────────────');
          console.log(JSON.stringify(response.data.data.oc[firstStrike], null, 2));
          
          // Check for actual data
          const strikeData = response.data.data.oc[firstStrike];
          const hasData = strikeData.ce?.oi > 0 || strikeData.ce?.volume > 0 || 
                         strikeData.pe?.oi > 0 || strikeData.pe?.volume > 0;
          
          console.log('\n─────────────────────────────────────────────────────────────');
          if (hasData) {
            console.log('✅ LIVE TRADING DATA FOUND');
            console.log('   Market is open and trading is active.');
          } else {
            console.log('⚠️  ALL VALUES ARE ZERO');
            console.log('   This indicates:');
            console.log('   • Market is closed');
            console.log('   • Today is a trading holiday');
            console.log('   • Or expiry has expired/not active yet');
          }
          
          // Show statistics
          console.log('\n📈 DATA STATISTICS:');
          console.log('─────────────────────────────────────────────────────────────');
          
          let totalOI = 0, totalVolume = 0;
          let nonZeroStrikes = 0;
          
          strikes.forEach(strike => {
            const data = response.data.data.oc[strike];
            const ce = data.ce || {};
            const pe = data.pe || {};
            
            totalOI += (ce.oi || 0) + (pe.oi || 0);
            totalVolume += (ce.volume || 0) + (pe.volume || 0);
            
            if (ce.oi > 0 || ce.volume > 0 || pe.oi > 0 || pe.volume > 0) {
              nonZeroStrikes++;
            }
          });
          
          console.log(`  Total Strikes: ${strikes.length}`);
          console.log(`  Strikes with data: ${nonZeroStrikes}`);
          console.log(`  Total OI: ${totalOI.toLocaleString()}`);
          console.log(`  Total Volume: ${totalVolume.toLocaleString()}`);
          
          // Show strike range
          const strikeValues = strikes.map(s => parseFloat(s));
          console.log(`  Strike Range: ${Math.min(...strikeValues)} - ${Math.max(...strikeValues)}`);
        }
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  COMPLETE RAW RESPONSE (First 3 strikes)');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Show first 3 strikes in full detail
    if (response.data.data?.oc) {
      const strikes = Object.keys(response.data.data.oc).slice(0, 3);
      const limitedOc = {};
      strikes.forEach(strike => {
        limitedOc[strike] = response.data.data.oc[strike];
      });
      
      console.log(JSON.stringify({
        status: response.data.status,
        data: {
          last_price: response.data.data.last_price,
          oc: limitedOc
        }
      }, null, 2));
    }
    
  } catch (error) {
    console.log('❌ REQUEST FAILED\n');
    console.log('─────────────────────────────────────────────────────────────\n');
    
    if (error.response) {
      console.log('STATUS CODE:');
      console.log(`  ${error.response.status} ${error.response.statusText}\n`);
      
      console.log('ERROR RESPONSE:');
      console.log(JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('ERROR: No response received');
      console.log('Details:', error.message);
    } else {
      console.log('ERROR:', error.message);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

testNiftyOptionChain();

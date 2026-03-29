/**
 * Test with next week's expiry
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testNextExpiry() {
  console.log('🧪 Testing option chain with next week expiry (2026-01-06):\n');

  try {
    const response = await axios.post(
      'https://api.dhan.co/v2/optionchain',
      {
        UnderlyingScrip: 13,
        UnderlyingSeg: 'IDX_I',
        Expiry: '2026-01-06'
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
    
    console.log('✅ Response received!');
    console.log('Full response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.data && response.data.data.oc) {
      const strikes = response.data.data.oc;
      console.log(`\n📊 Strikes count: ${strikes.length}`);
      
      if (strikes.length > 0) {
        console.log('\n🔍 Sample strike data:');
        console.log(JSON.stringify(strikes[0], null, 2));
      }
    } else {
      console.log('\n⚠️ No option chain data found in response');
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ FAILED:', error.response.status, error.response.data);
    } else {
      console.log('❌ ERROR:', error.message);
    }
  }
}

testNextExpiry();

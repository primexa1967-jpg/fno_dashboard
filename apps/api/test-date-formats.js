/**
 * Test different date formats for option chain API
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testDateFormats() {
  console.log('🧪 Testing option chain with different date formats:\n');

  const formats = [
    { format: 'YYYY-MM-DD', value: '2025-12-30' },
    { format: 'DD-MMM-YYYY', value: '30-DEC-2025' },
    { format: 'DD-MM-YYYY', value: '30-12-2025' },
  ];

  for (const test of formats) {
    try {
      console.log(`\n📊 Testing format: ${test.format} => "${test.value}"`);
      
      const response = await axios.post(
        'https://api.dhan.co/v2/optionchain',
        {
          UnderlyingScrip: 13,
          UnderlyingSeg: 'IDX_I',
          Expiry: test.value
        },
        {
          headers: {
            'access-token': token,
            'client-id': clientId,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );
      
      console.log(`✅ SUCCESS with ${test.format}!`);
      console.log('Response structure:', {
        status: response.data.status,
        hasData: !!response.data.data,
        dataType: Array.isArray(response.data.data) ? 'array' : typeof response.data.data,
        sampleKeys: response.data.data ? Object.keys(response.data.data).slice(0, 5) : []
      });
      
      if (response.data.data) {
        const strikes = Array.isArray(response.data.data) ? response.data.data : 
                       response.data.data.strikes || [];
        console.log(`   Strikes count: ${strikes.length}`);
        if (strikes.length > 0) {
          console.log('   Sample strike:', JSON.stringify(strikes[0], null, 2).substring(0, 200));
        }
      }
      
      break; // Stop after first success
    } catch (error) {
      if (error.response) {
        console.log(`❌ FAILED with ${test.format}:`, error.response.status, error.response.data);
      } else {
        console.log(`❌ ERROR with ${test.format}:`, error.message);
      }
    }
    
    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
}

testDateFormats();

/**
 * Test NIFTY expiries to see what's actually available
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testNiftyExpiries() {
  console.log('🧪 Fetching NIFTY expiries from Dhan API:\n');

  try {
    const response = await axios.post(
      'https://api.dhan.co/v2/optionchain/expirylist',
      {
        UnderlyingScrip: 13,
        UnderlyingSeg: 'IDX_I'
      },
      {
        headers: {
          'access-token': token,
          'client-id': clientId,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ Available expiries:', JSON.stringify(response.data, null, 2));
    
    // Try to fetch option chain for the first expiry
    if (response.data.data && response.data.data.length > 0) {
      const firstExpiry = response.data.data[0];
      console.log(`\n🔍 Testing option chain for expiry: ${firstExpiry}`);
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const ocResponse = await axios.post(
        'https://api.dhan.co/v2/optionchain',
        {
          UnderlyingScrip: 13,
          UnderlyingSeg: 'IDX_I',
          Expiry: firstExpiry
        },
        {
          headers: {
            'access-token': token,
            'client-id': clientId,
            'Content-Type': 'application/json',
          },
        }
      );
      
      console.log('\n📊 Option chain response structure:', {
        status: ocResponse.data.status,
        dataKeys: Object.keys(ocResponse.data.data || {}),
        sampleStrike: ocResponse.data.data?.CE?.[0] || ocResponse.data.data?.[0] || 'N/A'
      });
    }
  } catch (error) {
    if (error.response) {
      console.log('❌ FAILED:', error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('❌ ERROR:', error.message);
    }
  }
}

testNiftyExpiries();

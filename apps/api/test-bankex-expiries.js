/**
 * Test BANKEX expiry API with different exchange segments
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function testBankexExpiries() {
  console.log('🧪 Testing BANKEX expiry API with different segments:\n');

  const segments = [
    { seg: 'IDX_I', id: 69, desc: 'NSE Index segment with BSE BANKEX ID' },
    { seg: 'BSE_IDX', id: 69, desc: 'BSE Index segment' },
    { seg: 'BSE_FNO', id: 69, desc: 'BSE F&O segment' },
    { seg: 'IDX_B', id: 69, desc: 'BSE Index segment (alternate)' },
  ];

  for (const test of segments) {
    try {
      console.log(`\n📊 Testing: ${test.desc}`);
      console.log(`   UnderlyingScrip=${test.id}, UnderlyingSeg=${test.seg}`);
      
      const response = await axios.post(
        'https://api.dhan.co/v2/optionchain/expirylist',
        {
          UnderlyingScrip: test.id,
          UnderlyingSeg: test.seg
        },
        {
          headers: {
            'access-token': token,
            'client-id': clientId,
            'Content-Type': 'application/json',
          },
        }
      );
      
      console.log(`✅ SUCCESS! Response:`, JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        console.log(`❌ FAILED: Status ${error.response.status}`, error.response.data);
      } else {
        console.log(`❌ ERROR:`, error.message);
      }
    }
    
    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

testBankexExpiries();

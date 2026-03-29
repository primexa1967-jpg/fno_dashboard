/**
 * Test script to fetch Dhan instruments and find correct security IDs
 * Run: node test-dhan-instruments.js
 */
const axios = require('axios');
require('dotenv').config();

const token = process.env.DHAN_ACCESS_TOKEN;
const clientId = process.env.DHAN_CLIENT_ID;

async function fetchDhanInstruments() {
  console.log('🔍 Fetching Dhan instruments to find SENSEX and MIDCAPNIFTY security IDs...\n');

  // Try different instrument endpoints
  const endpoints = [
    'https://images.dhan.co/api-data/api-scrip-master.csv',  // CSV master file
    'https://api.dhan.co/v2/instruments/IDX_I',               // Index instruments
    'https://api.dhan.co/v2/instruments/BSE_IDX',              // BSE Index instruments
  ];

  for (const url of endpoints) {
    try {
      console.log(`\n📊 Trying: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'access-token': token,
          'client-id': clientId,
          'Accept': 'application/json, text/csv',
        },
        maxRedirects: 5,
      });

      if (typeof response.data === 'string') {
        // CSV data - search for SENSEX and MIDCAP
        const lines = response.data.split('\n');
        console.log(`✅ Got ${lines.length} lines of data`);
        
        console.log('\n🔍 Searching for SENSEX...');
        const sensexLines = lines.filter(line => 
          line.toUpperCase().includes('SENSEX') && !line.includes('BANKSENSEX')
        ).slice(0, 5);
        sensexLines.forEach(line => console.log(line));

        console.log('\n🔍 Searching for MIDCAP...');
        const midcapLines = lines.filter(line => 
          line.toUpperCase().includes('MIDCAP') || line.toUpperCase().includes('MIDCP')
        ).slice(0, 5);
        midcapLines.forEach(line => console.log(line));

      } else {
        console.log('✅ Response:', JSON.stringify(response.data, null, 2));
      }

    } catch (error) {
      console.error('❌ Failed:', error.response?.status, error.response?.statusText || error.message);
    }
  }

  // Test specific security IDs
  console.log('\n\n🧪 Testing specific security IDs for SENSEX...');
  const testIds = [1, 19, 51, 99];
  
  for (const id of testIds) {
    try {
      console.log(`\n Testing SENSEX with ID ${id} on IDX_I...`);
      const response = await axios.post(
        'https://api.dhan.co/v2/marketfeed/quote',
        { IDX_I: [id] },
        {
          headers: {
            'access-token': token,
            'client-id': clientId,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`✅ ID ${id} works! Response:`, JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error(`❌ ID ${id} failed:`, error.response?.status, error.response?.data?.error || error.message);
    }
  }
}

fetchDhanInstruments().catch(console.error);

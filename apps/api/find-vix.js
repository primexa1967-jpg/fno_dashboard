/**
 * Search for INDIA VIX in instruments CSV
 */
const axios = require('axios');

async function findIndiaVIX() {
  try {
    const response = await axios.get('https://images.dhan.co/api-data/api-scrip-master.csv');
    const lines = response.data.split('\n');
    
    console.log('🔍 Searching for INDIA VIX:\n');
    
    const vixLines = lines.filter(line => {
      const upper = line.toUpperCase();
      return upper.includes('VIX') && upper.includes('INDIA');
    });

    vixLines.forEach(line => console.log(line));
    
    console.log('\n🔍 Searching for just VIX:\n');
    
    const justVix = lines.filter(line => {
      const upper = line.toUpperCase();
      const parts = line.split(',');
      return upper.includes('VIX') && 
             parts[0] === 'NSE' &&
             parts[3] === 'INDEX';
    });

    justVix.forEach(line => console.log(line));

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findIndiaVIX();

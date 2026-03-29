/**
 * Search for BANKEX in Dhan instruments CSV
 */
const axios = require('axios');

async function findBANKEX() {
  try {
    const response = await axios.get('https://images.dhan.co/api-data/api-scrip-master.csv');
    const lines = response.data.split('\n');
    
    console.log('🔍 Searching for BANKEX in Dhan instruments:\n');
    
    const bankexLines = lines.filter(line => {
      const upper = line.toUpperCase();
      return upper.includes('BANKEX') || upper.includes('BANK NIFTY') || upper.includes('BSE BANK');
    });

    bankexLines.slice(0, 30).forEach(line => console.log(line));
    
    console.log('\n🔍 Searching for BSE BANK INDEX:\n');
    
    const bseBankIndex = lines.filter(line => {
      const parts = line.split(',');
      const upper = line.toUpperCase();
      return parts[0] === 'BSE' && 
             parts[3] === 'INDEX' && 
             (upper.includes('BANK') || upper.includes('BANKEX'));
    });

    bseBankIndex.forEach(line => {
      const parts = line.split(',');
      console.log(`Security ID: ${parts[2]?.padEnd(10)} | Symbol: ${parts[5]?.padEnd(20)} | Name: ${parts[7]}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findBANKEX();

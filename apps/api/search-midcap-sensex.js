/**
 * Search instruments CSV for MIDCAP NIFTY and SENSEX indices
 */
const axios = require('axios');
require('dotenv').config();

async function searchInstruments() {
  try {
    console.log('📥 Downloading Dhan instruments CSV...\n');
    
    const response = await axios.get('https://images.dhan.co/api-data/api-scrip-master.csv', {
      maxRedirects: 5,
    });

    const lines = response.data.split('\n');
    console.log(`✅ Downloaded ${lines.length.toLocaleString()} instrument records\n`);

    // Get header
    console.log('📋 CSV Header:');
    console.log(lines[0]);
    console.log('\n' + '='.repeat(100) + '\n');

    // Search for indices (not options, not equity)
    console.log('🔍 Searching for INDEX instruments containing NIFTY, MIDCAP, or SENSEX:\n');
    
    const indexLines = lines.filter(line => {
      const upper = line.toUpperCase();
      return (upper.includes('INDEX') || upper.includes('IDX')) && 
             !upper.includes('OPTIDX') &&
             !upper.includes('FUTIDX') &&
             (upper.includes('NIFTY') || upper.includes('MIDCAP') || upper.includes('SENSEX'));
    });

    indexLines.slice(0, 30).forEach(line => {
      console.log(line);
    });

    console.log('\n' + '='.repeat(100) + '\n');

    // Search specifically for MIDCAP patterns
    console.log('🔍 Searching for MIDCAP NIFTY / NIFTY MIDCAP patterns:\n');
    
    const midcapPatterns = lines.filter(line => {
      const upper = line.toUpperCase();
      return (upper.includes('MIDCAP') && upper.includes('NIFTY')) || 
             upper.includes('NIFTY MIDCAP') ||
             upper.includes('MIDCAP SELECT') ||
             upper.match(/MIDCP|MID CAP/);
    });

    midcapPatterns.slice(0, 20).forEach(line => {
      console.log(line);
    });

    console.log('\n' + '='.repeat(100) + '\n');

    // Search for SENSEX index (not options)
    console.log('🔍 Searching for BSE SENSEX INDEX:\n');
    
    const sensexIndex = lines.filter(line => {
      const upper = line.toUpperCase();
      return upper.includes('SENSEX') && 
             upper.includes('INDEX') && 
             !upper.includes('OPTIDX') &&
             !upper.includes('FUTIDX');
    });

    sensexIndex.forEach(line => {
      console.log(line);
    });

    console.log('\n' + '='.repeat(100) + '\n');

    // Parse and extract security IDs for key indices
    console.log('📊 Extracting Security IDs for NSE indices:\n');
    
    const nseIndices = lines.filter(line => {
      const parts = line.split(',');
      return parts[0] === 'NSE' && 
             parts[3] === 'INDEX' && 
             (parts[5]?.includes('NIFTY') || parts[5]?.includes('MIDCAP'));
    });

    nseIndices.forEach(line => {
      const parts = line.split(',');
      console.log(`Security ID: ${parts[2]?.padEnd(10)} | Symbol: ${parts[5]?.padEnd(20)} | Name: ${parts[7]}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

searchInstruments();

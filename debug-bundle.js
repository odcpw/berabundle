/**
 * Debug utility for bundle format issues
 */
const fs = require('fs').promises;
const path = require('path');

// Usage: node debug-bundle.js <bundle-file>
async function main() {
  const filepath = process.argv[2];
  if (!filepath) {
    console.error('Usage: node debug-bundle.js <bundle-file>');
    process.exit(1);
  }

  console.log(`Loading bundle from: ${filepath}`);
  const content = await fs.readFile(filepath, 'utf8');
  const bundle = JSON.parse(content);

  console.log('\n=== Bundle Structure ===');
  console.log('Keys at root level:', Object.keys(bundle).join(', '));
  
  if (bundle.transactions) {
    console.log('\n=== Transactions ===');
    console.log(`Format: ${bundle.format}`);
    console.log(`Count: ${bundle.transactions.length}`);
    
    if (bundle.transactions.length > 0) {
      const tx = bundle.transactions[0];
      console.log('\nFirst transaction:');
      console.log(`- to: ${tx.to}`);
      console.log(`- from: ${tx.from}`);
      console.log(`- value: ${tx.value}`);
      console.log(`- gasLimit: ${tx.gasLimit}`);
      console.log(`- type: ${tx.type}`);
    }
  }

  if (bundle.bundleData) {
    console.log('\n=== bundleData property ===');
    if (typeof bundle.bundleData === 'object') {
      console.log('Keys:', Object.keys(bundle.bundleData).join(', '));
      
      if (bundle.bundleData.transactions) {
        console.log(`Transaction count: ${bundle.bundleData.transactions.length}`);
      } else {
        console.log('No transactions array inside bundleData');
      }
    } else {
      console.log(`bundleData is not an object: ${typeof bundle.bundleData}`);
    }
  }

  if (bundle.summary) {
    console.log('\n=== Summary ===');
    console.log(bundle.summary);
  }

  // Create a fixed version of the bundle without bundleData
  const fixedBundle = { ...bundle };
  
  console.log('\n=== Creating Test Bundle ===');
  // Test: Make sure the transactions are at the top level
  if (bundle.transactions) {
    console.log('Bundle already has transactions at top level');
  } else if (bundle.bundleData && bundle.bundleData.transactions) {
    console.log('Moving transactions from bundleData to top level');
    fixedBundle.transactions = bundle.bundleData.transactions;
    // Remove bundleData since it causes issues
    delete fixedBundle.bundleData;
  }
  
  // Make sure format is set
  fixedBundle.format = bundle.format || 'eoa';
  
  // Write fixed bundle to a test file
  const outputPath = path.join(path.dirname(filepath), 'fixed_' + path.basename(filepath));
  await fs.writeFile(outputPath, JSON.stringify(fixedBundle, null, 2));
  console.log(`Fixed bundle saved to: ${outputPath}`);
  
  console.log('\nTry running with this fixed bundle file.');
}

main().catch(error => {
  console.error('Error:', error.message);
});
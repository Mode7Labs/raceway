#!/usr/bin/env node

console.log('🔍 Causeway - Live Race Condition Demo\n');

// Simple counter with a race condition
let counter = 0;
const delay = () => new Promise(r => setTimeout(r, 1));

async function increment(id) {
  // Read
  const value = counter;
  console.log(`[${id}] Read: ${value}`);

  // Small delay (simulates processing)
  await delay();

  // Write
  counter = value + 1;
  console.log(`[${id}] Wrote: ${value + 1}`);
}

async function main() {
  console.log('Initial counter:', counter);
  console.log('\nRunning 5 concurrent increments...\n');

  await Promise.all([
    increment('A'),
    increment('B'),
    increment('C'),
    increment('D'),
    increment('E'),
  ]);

  console.log('\n📊 Results:');
  console.log(`   Final counter: ${counter}`);
  console.log(`   Expected: 5`);
  console.log(`   Lost updates: ${5 - counter}\n`);

  if (counter !== 5) {
    console.log('❌ RACE CONDITION!');
    console.log('\n🔍 What Causeway Would Show:');
    console.log('   • All 5 operations read counter = 0');
    console.log('   • All 5 wrote counter = 1');
    console.log('   • Last write wins, losing 4 updates');
    console.log('   • Fix: Use atomic operations or locks');
  }
}

main();

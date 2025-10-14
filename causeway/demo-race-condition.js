#!/usr/bin/env node

/**
 * Live Demo: Race Condition in Action
 *
 * This demonstrates the exact bug that Causeway would detect.
 * Run this to see the race condition happen in real-time!
 */

console.log('🔍 Causeway Demo - Race Condition Detection\n');

// Simulated user database
let aliceBalance = 1000;
let bobBalance = 500;

// Simulate async database operations
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getBalance(user) {
  await sleep(Math.random() * 50); // Simulate DB read latency
  return user === 'alice' ? aliceBalance : bobBalance;
}

async function setBalance(user, newBalance) {
  await sleep(Math.random() * 30); // Simulate DB write latency
  if (user === 'alice') {
    aliceBalance = newBalance;
  } else {
    bobBalance = newBalance;
  }
}

// 🐛 BUG: This function has a race condition!
async function transferMoney(from, to, amount, id) {
  console.log(`[Transfer ${id}] Starting: ${from} → ${to}, $${amount}`);

  // Step 1: Read balances
  const fromBalance = await getBalance(from);
  console.log(`[Transfer ${id}] Read ${from} balance: $${fromBalance}`);

  const toBalance = await getBalance(to);

  // ⚠️ RACE WINDOW: Another transfer could happen here!

  // Step 2: Calculate new balances
  const newFromBalance = fromBalance - amount;
  const newToBalance = toBalance + amount;

  console.log(`[Transfer ${id}] Writing ${from}: $${fromBalance} → $${newFromBalance}`);

  // Step 3: Write new balances
  await setBalance(from, newFromBalance);
  await setBalance(to, newToBalance);

  console.log(`[Transfer ${id}] ✅ Complete\n`);
}

async function main() {
  console.log('📊 Initial State:');
  console.log(`   Alice: $${aliceBalance}`);
  console.log(`   Bob: $${bobBalance}`);
  console.log(`   Total: $${aliceBalance + bobBalance}\n`);

  console.log('💸 Executing 3 concurrent transfers from Alice...\n');

  // 🔥 TRIGGER THE RACE CONDITION
  // All three transfers read Alice's balance at ~same time
  await Promise.all([
    transferMoney('alice', 'bob', 100, 'A'),
    transferMoney('alice', 'bob', 200, 'B'),
    transferMoney('alice', 'bob', 150, 'C'),
  ]);

  const total = aliceBalance + bobBalance;
  const expected = 1500;
  const lost = expected - total;

  console.log('📊 Final State:');
  console.log(`   Alice: $${aliceBalance}`);
  console.log(`   Bob: $${bobBalance}`);
  console.log(`   Total: $${total}`);
  console.log(`   Expected: $${expected}\n`);

  if (lost !== 0) {
    console.log(`❌ RACE CONDITION DETECTED!`);
    console.log(`   $${Math.abs(lost)} was ${lost > 0 ? 'lost' : 'created'} due to concurrent writes!\n`);

    console.log('🔍 What Causeway Would Show You:');
    console.log('   ┌─────────────────────────────────────────────────────────┐');
    console.log('   │ 🚨 RACE_CONDITION detected (confidence: 98%)            │');
    console.log('   │                                                         │');
    console.log('   │ Concurrent modifications to aliceBalance:               │');
    console.log('   │   • Transfer A: read $1000, wrote $900                  │');
    console.log('   │   • Transfer B: read $1000, wrote $800                  │');
    console.log('   │   • Transfer C: read $1000, wrote $850                  │');
    console.log('   │                                                         │');
    console.log('   │ Timeline:                                               │');
    console.log('   │   T+0ms:  All transfers start                           │');
    console.log('   │   T+25ms: All read balance = $1000                      │');
    console.log('   │   T+50ms: Transfer A writes $900                        │');
    console.log('   │   T+55ms: Transfer B writes $800 ❌ (lost update!)      │');
    console.log('   │   T+60ms: Transfer C writes $850 ❌ (lost update!)      │');
    console.log('   │                                                         │');
    console.log('   │ 💡 Recommendation:                                      │');
    console.log('   │   Use database transactions with proper locking:        │');
    console.log('   │   BEGIN TRANSACTION;                                    │');
    console.log('   │   SELECT balance FROM users WHERE id = ? FOR UPDATE;    │');
    console.log('   │   UPDATE users SET balance = ? WHERE id = ?;            │');
    console.log('   │   COMMIT;                                               │');
    console.log('   └─────────────────────────────────────────────────────────┘');
    console.log('');
    console.log('   Plus: Causeway generates a test case to reproduce this!');
  } else {
    console.log('✅ No race detected (this time - try running again!)');
  }
}

main().catch(console.error);

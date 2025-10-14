/**
 * Test script to trigger race conditions in the banking API
 *
 * This sends two concurrent transfer requests that will create a race condition
 * on Alice's balance, demonstrating Causeway's ability to detect the issue.
 */

const API_URL = 'http://localhost:3000';

async function resetAccounts() {
  console.log('🔄 Resetting accounts...');
  await fetch(`${API_URL}/reset`, { method: 'POST' });
}

async function getBalance(account) {
  const response = await fetch(`${API_URL}/balance/${account}`);
  const data = await response.json();
  return data.balance;
}

async function transfer(from, to, amount) {
  const response = await fetch(`${API_URL}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, amount }),
  });
  return response.json();
}

async function main() {
  console.log('\n🚨 Race Condition Test\n');
  console.log('This will trigger a race condition on Alice\'s account.\n');

  // Reset accounts
  await resetAccounts();

  // Get initial balance
  const initialBalance = await getBalance('alice');
  console.log(`💰 Alice's initial balance: $${initialBalance}\n`);

  // Send two concurrent transfers from Alice
  console.log('⚡ Sending two concurrent transfers from Alice:');
  console.log('   Transfer 1: Alice → Bob ($100)');
  console.log('   Transfer 2: Alice → Charlie ($200)');
  console.log('   Both happening at the same time!\n');

  const [result1, result2] = await Promise.all([
    transfer('alice', 'bob', 100),
    transfer('alice', 'charlie', 200),
  ]);

  console.log('✅ Transfer 1 result:', result1);
  console.log('✅ Transfer 2 result:', result2);

  // Get final balance
  await new Promise(resolve => setTimeout(resolve, 100)); // Wait a bit
  const finalBalance = await getBalance('alice');

  console.log(`\n💰 Alice's final balance: $${finalBalance}`);
  console.log(`💰 Expected balance: $${initialBalance - 100 - 200} (1000 - 100 - 200)`);
  console.log(`💰 Actual balance: $${finalBalance}`);

  if (finalBalance !== initialBalance - 300) {
    console.log('\n🚨 RACE CONDITION DETECTED!');
    console.log(`   Lost $${(initialBalance - 300) - finalBalance} due to concurrent writes!`);
    console.log('\n🔍 View the race condition in Causeway TUI:');
    console.log('   cargo run --release -- tui');
    console.log('\n   The TUI will show:');
    console.log('   - Both threads reading alice.balance = $1000');
    console.log('   - Thread 1 writing $900 (1000 - 100)');
    console.log('   - Thread 2 writing $800 (1000 - 200) ← OVERWRITES Thread 1!');
    console.log('   - Result: Lost $100!');
  } else {
    console.log('\n✅ No race condition detected (transfers were serialized)');
    console.log('   Try running the test again to trigger the race.');
  }

  console.log('\n');
}

main().catch(console.error);

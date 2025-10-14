/**
 * Example: Race Condition Demo
 *
 * This demonstrates how Causeway detects race conditions in concurrent operations.
 * Run this with Causeway instrumentation to see the race condition detected automatically.
 */

import '@causeway/instrumentation';

// Simulated user database
const users = new Map<string, { id: string; balance: number }>();

async function getUser(id: string) {
  // Simulate database read
  await sleep(Math.random() * 100);
  return users.get(id);
}

async function saveUser(user: { id: string; balance: number }) {
  // Simulate database write
  await sleep(Math.random() * 50);
  users.set(user.id, user);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 🐛 BUG: This has a race condition!
async function transferMoney(fromId: string, toId: string, amount: number) {
  console.log(`💸 Transferring $${amount} from ${fromId} to ${toId}`);

  // Read users
  const from = await getUser(fromId);
  const to = await getUser(toId);

  if (!from || !to) {
    throw new Error('User not found');
  }

  if (from.balance < amount) {
    throw new Error('Insufficient funds');
  }

  // ⚠️ RACE CONDITION: Multiple concurrent transfers can read the same balance
  from.balance -= amount;
  to.balance += amount;

  // Save both users
  await Promise.all([
    saveUser(from),
    saveUser(to)
  ]);

  console.log(`✅ Transfer complete. ${fromId}: $${from.balance}, ${toId}: $${to.balance}`);
}

async function main() {
  // Initialize users
  users.set('alice', { id: 'alice', balance: 1000 });
  users.set('bob', { id: 'bob', balance: 500 });
  users.set('charlie', { id: 'charlie', balance: 750 });

  console.log('🚀 Starting race condition demo...\n');
  console.log('Initial balances:');
  console.log('  Alice: $1000');
  console.log('  Bob: $500');
  console.log('  Charlie: $750\n');

  // 💥 Trigger the race condition by running concurrent transfers
  try {
    await Promise.all([
      transferMoney('alice', 'bob', 100),
      transferMoney('alice', 'charlie', 200),
      transferMoney('alice', 'bob', 150),
    ]);
  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('\n📊 Final balances:');
  console.log(`  Alice: $${users.get('alice')?.balance}`);
  console.log(`  Bob: $${users.get('bob')?.balance}`);
  console.log(`  Charlie: $${users.get('charlie')?.balance}`);

  const total = Array.from(users.values()).reduce((sum, u) => sum + u.balance, 0);
  console.log(`  Total: $${total} (should be $2250)`);

  if (total !== 2250) {
    console.log('\n⚠️  Money was created or destroyed due to race condition!');
    console.log('   Run with Causeway to see exactly what happened:');
    console.log('   $ causeway tui');
  }
}

main().catch(console.error);

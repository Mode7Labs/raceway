/**
 * Example: Complex Async Flow Debugging
 *
 * This demonstrates how Causeway helps debug complex async flows
 * where traditional debugging tools fall short.
 */

import '@causeway/instrumentation';

interface Order {
  id: string;
  items: string[];
  total: number;
  userId: string;
}

interface InventoryResult {
  available: boolean;
  reservationId?: string;
}

interface PaymentResult {
  success: boolean;
  transactionId: string;
}

interface ShippingResult {
  trackingNumber: string;
  estimatedDays: number;
}

// Simulated external services
async function fetchOrder(orderId: string): Promise<Order> {
  await sleep(100);
  return {
    id: orderId,
    items: ['laptop', 'mouse', 'keyboard'],
    total: 1299.99,
    userId: 'user123'
  };
}

async function checkInventory(items: string[]): Promise<InventoryResult> {
  await sleep(150);
  console.log('✓ Inventory checked');
  return {
    available: true,
    reservationId: 'res_' + Math.random().toString(36).substr(2, 9)
  };
}

async function processPayment(amount: number): Promise<PaymentResult> {
  await sleep(500); // Slower service

  // Simulate occasional failures
  if (Math.random() < 0.1) {
    throw new Error('Payment gateway timeout');
  }

  console.log('✓ Payment processed');
  return {
    success: true,
    transactionId: 'txn_' + Math.random().toString(36).substr(2, 9)
  };
}

async function scheduleShipping(address: string): Promise<ShippingResult> {
  await sleep(300);

  // Simulate timeout
  if (Math.random() < 0.2) {
    throw new Error('Shipping service timeout');
  }

  console.log('✓ Shipping scheduled');
  return {
    trackingNumber: 'TRK' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    estimatedDays: 3
  };
}

async function finalizeOrder(
  order: Order,
  inventory: InventoryResult,
  payment: PaymentResult,
  shipping: ShippingResult
): Promise<void> {
  await sleep(100);
  console.log('✅ Order finalized:', {
    orderId: order.id,
    reservationId: inventory.reservationId,
    transactionId: payment.transactionId,
    tracking: shipping.trackingNumber
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main order processing function
async function processOrder(orderId: string): Promise<void> {
  console.log(`\n📦 Processing order ${orderId}...`);

  try {
    // Fetch order details
    const order = await fetchOrder(orderId);
    console.log(`  Order fetched: ${order.items.length} items, $${order.total}`);

    // Process all operations in parallel
    const [inventory, payment, shipping] = await Promise.all([
      checkInventory(order.items),
      processPayment(order.total),
      scheduleShipping('123 Main St') // In real app, would use order.address
    ]);

    // Finalize order
    await finalizeOrder(order, inventory, payment, shipping);

    console.log(`✅ Order ${orderId} completed successfully!\n`);

  } catch (error) {
    console.error(`❌ Order ${orderId} failed:`, (error as Error).message);
    console.log('   🔍 Check Causeway to see the exact failure point:');
    console.log('      $ causeway analyze --trace-id <trace-id>\n');
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting async debugging demo...');
  console.log('   Processing multiple orders concurrently...\n');

  // Process multiple orders concurrently
  const orderIds = ['ord_001', 'ord_002', 'ord_003', 'ord_004', 'ord_005'];

  const results = await Promise.allSettled(
    orderIds.map(id => processOrder(id))
  );

  // Summary
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log('📊 Summary:');
  console.log(`   ✅ Successful: ${successful}`);
  console.log(`   ❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n🔍 To debug failures, run:');
    console.log('   $ causeway tui');
    console.log('\nYou\'ll see:');
    console.log('   • Exact timeline of all async operations');
    console.log('   • Which operation failed and why');
    console.log('   • How the failure affected dependent operations');
    console.log('   • Complete causal chain from order start to failure');
  }
}

main().catch(console.error);

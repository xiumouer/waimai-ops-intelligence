import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initDB, upsertOrders, upsertSettlements } from './db.mjs';

async function run() {
  await initDB();
  const ordersPath = join(process.cwd(), 'public', 'data', 'orders.json');
  const settlementsPath = join(process.cwd(), 'public', 'data', 'settlements.json');
  const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));
  const settlements = JSON.parse(await readFile(settlementsPath, 'utf-8'));
  await upsertOrders(orders);
  await upsertSettlements(settlements);
  console.log(`Ingested ${orders.length} orders and ${settlements.length} settlements to db.json`);
}

run().catch(err => { console.error(err); process.exit(1); });


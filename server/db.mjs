import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = join(process.cwd(), 'server', 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const adapter = new JSONFile(join(dataDir, 'db.json'));
export const db = new Low(adapter, { orders: [], settlements: [] });

export async function initDB() {
  await db.read();
  if (!db.data) db.data = { orders: [], settlements: [] };
  await db.write();
}

export async function upsertOrders(orders) {
  await db.read();
  const map = new Map(db.data.orders.map(o => [o.orderId, o]));
  for (const o of orders) map.set(o.orderId, o);
  db.data.orders = Array.from(map.values());
  await db.write();
}

export async function upsertSettlements(items) {
  await db.read();
  const map = new Map(db.data.settlements.map(s => [s.orderId + ':' + s.riderId, s]));
  for (const s of items) map.set(s.orderId + ':' + s.riderId, s);
  db.data.settlements = Array.from(map.values());
  await db.write();
}


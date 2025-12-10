import express from 'express';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db, initDB, upsertOrders, upsertSettlements } from './db.mjs';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// 根路径提示，避免 "Cannot GET /"
app.get('/', (req, res) => {
  res.json({
    message: 'API server is running',
    endpoints: {
      health: '/api/health',
      orders: '/api/orders',
      settlements: '/api/settlements',
      ingest: 'POST /api/ingest'
    }
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/orders', async (req, res) => {
  await db.read();
  const { site, limit } = req.query;
  let rows = db.data.orders || [];
  if (site && site !== '全部') rows = rows.filter(o => o.rider?.site === site);
  const n = Number(limit) || rows.length;
  res.json(rows.slice(0, n));
});

app.get('/api/settlements', async (req, res) => {
  await db.read();
  res.json(db.data.settlements || []);
});

// 触发导入：从 public/data 读取 JSON 写入数据库
app.post('/api/ingest', async (req, res) => {
  try {
    const ordersPath = join(process.cwd(), 'public', 'data', 'orders.json');
    const settlementsPath = join(process.cwd(), 'public', 'data', 'settlements.json');
    const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));
    const settlements = JSON.parse(await readFile(settlementsPath, 'utf-8'));
    await upsertOrders(orders);
    await upsertSettlements(settlements);
    res.json({ ok: true, counts: { orders: orders.length, settlements: settlements.length } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
await initDB();
app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});

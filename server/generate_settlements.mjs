import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function rand(min, max) { return +(min + Math.random() * (max - min)).toFixed(2); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function run() {
  const ordersPath = join(process.cwd(), 'public', 'data', 'orders.json');
  const settlementsPath = join(process.cwd(), 'public', 'data', 'settlements.json');
  const orders = JSON.parse(await readFile(ordersPath, 'utf-8'));

  const statuses = ['已结算', '待发放'];

  const settlements = orders.map(o => {
    const delivered = o.deliveredAt ? new Date(o.deliveredAt) : new Date(o.createdAt);
    const dateStr = `${delivered.getFullYear()}-${String(delivered.getMonth()+1).padStart(2,'0')}-${String(delivered.getDate()).padStart(2,'0')}`;

    // 依据订单状态与ETA粗略推导费用与罚款分布
    const isCancelled = o.status === '已取消';
    const baseFee = isCancelled ? 0 : rand(4.5, 6.5);
    const distanceSubsidy = isCancelled ? 0 : rand(1.0, 4.0);
    const weightSubsidy = isCancelled ? 0 : rand(0.0, 1.5);
    const periodSubsidy = isCancelled ? 0 : rand(0.0, 1.5);
    const platformReward = isCancelled ? 0 : rand(0.0, 2.0);
    const tip = isCancelled ? 0 : rand(0.0, 3.0);

    // 罚款：超时/投诉/取消
    let penalties = { timeout: 0, complaint: 0, cancel: 0 };
    if (!isCancelled && Math.random() < 0.15) penalties.timeout = rand(0.5, 2.0);
    if (!isCancelled && Math.random() < 0.05) penalties.complaint = rand(1.0, 3.0);
    if (isCancelled) penalties.cancel = rand(0.3, 1.0);

    const total = +(baseFee + distanceSubsidy + weightSubsidy + periodSubsidy + platformReward + tip - (penalties.timeout + penalties.complaint + penalties.cancel)).toFixed(2);

    return {
      orderId: o.orderId,
      riderId: o.rider.riderId,
      baseFee: +baseFee.toFixed(2),
      distanceSubsidy: +distanceSubsidy.toFixed(2),
      weightSubsidy: +weightSubsidy.toFixed(2),
      periodSubsidy: +periodSubsidy.toFixed(2),
      platformReward: +platformReward.toFixed(2),
      tip: +tip.toFixed(2),
      penalties,
      settlement: { date: dateStr, amount: total, status: pick(statuses) }
    };
  });

  await writeFile(settlementsPath, JSON.stringify(settlements, null, 2));
  console.log(`Generated ${settlements.length} settlements -> ${settlementsPath}`);
}

run().catch(err => { console.error(err); process.exit(1); });


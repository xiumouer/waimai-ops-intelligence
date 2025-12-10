import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const sites = ["静安区","黄浦区","浦东新区","徐汇区","虹口区","长宁区","杨浦区","闵行区"];
const familyNames = ["张","李","王","赵","钱","孙","周","吴","郑","冯","陈","褚","卫","蒋","沈","韩","杨","朱","秦","尤"];
const givenNames = ["一","二","三","四","五","六","七","八","九","十","安","博","晨","东","峰","光","海","杰","凯","林","明","宁","欧","鹏","清","然","思","涛","伟","晓","扬","泽"];

function makeRider(i) {
  const site = pick(sites);
  const riderId = `R-${String(i+1).padStart(3,'0')}`;
  const name = `${pick(familyNames)}${pick(givenNames)}`;
  return { riderId, name, site };
}

// 上海近似范围
const BOUNDS = { latMin: 31.19, latMax: 31.35, lngMin: 121.41, lngMax: 121.56 };
function randomPoint() {
  return { lat: +rand(BOUNDS.latMin, BOUNDS.latMax).toFixed(6), lng: +rand(BOUNDS.lngMin, BOUNDS.lngMax).toFixed(6) };
}

function addMinutes(ts, minutes) { return new Date(new Date(ts).getTime() + minutes*60*1000); }

function isoWithTZ(d) {
  // 输出 ISO，但保持简单：使用 toISOString（Z 时区）。前端 dayjs 能正确解析。
  return new Date(d).toISOString();
}

function makeOrder(idx, riders) {
  const baseDate = new Date();
  // 过去30天随机时刻
  const created = new Date(baseDate.getTime() - randInt(0, 30*24*60) * 60 * 1000);
  const rider = pick(riders);
  const merchant = randomPoint();
  const customer = randomPoint();

  const statusPool = ["已完成","配送中","已取消","已接单","已到店"];
  const status = pick(statusPool);
  const orderId = `O-${String(idx+1).padStart(6,'0')}`;

  const dispatchAt = addMinutes(created, randInt(1, 5));
  const acceptedAt = addMinutes(dispatchAt, randInt(1, 5));
  const arrivedStoreAt = addMinutes(acceptedAt, randInt(8, 20));
  const pickedAt = addMinutes(arrivedStoreAt, randInt(3, 6));
  const deliveredDelta = randInt(8, 20);
  const deliveredAt = addMinutes(pickedAt, deliveredDelta);
  const eta = addMinutes(created, randInt(35, 50));

  let cancelReason = null;
  let timeline = { 
    dispatchAt: isoWithTZ(dispatchAt), 
    acceptedAt: isoWithTZ(acceptedAt), 
    arrivedStoreAt: isoWithTZ(arrivedStoreAt), 
    pickedAt: isoWithTZ(pickedAt) 
  };
  let deliveredStr = isoWithTZ(deliveredAt);

  if (status === "已取消") {
    deliveredStr = null;
    // 随机在某阶段取消
    const phase = pick(["dispatch","accept","arrive","pick"]);
    cancelReason = pick(["用户取消","商家取消","超时取消"]);
    if (phase === "dispatch") timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: null, arrivedStoreAt: null, pickedAt: null };
    if (phase === "accept") timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: isoWithTZ(acceptedAt), arrivedStoreAt: null, pickedAt: null };
    if (phase === "arrive") timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: isoWithTZ(acceptedAt), arrivedStoreAt: isoWithTZ(arrivedStoreAt), pickedAt: null };
    if (phase === "pick") timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: isoWithTZ(acceptedAt), arrivedStoreAt: isoWithTZ(arrivedStoreAt), pickedAt: isoWithTZ(pickedAt) };
  }
  if (status === "配送中") {
    deliveredStr = null;
    // 已有 pickedAt，但未送达
    timeline = { 
      dispatchAt: isoWithTZ(dispatchAt), 
      acceptedAt: isoWithTZ(acceptedAt), 
      arrivedStoreAt: isoWithTZ(arrivedStoreAt), 
      pickedAt: isoWithTZ(pickedAt) 
    };
  }
  if (status === "已接单") {
    deliveredStr = null;
    timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: isoWithTZ(acceptedAt), arrivedStoreAt: null, pickedAt: null };
  }
  if (status === "已到店") {
    deliveredStr = null;
    timeline = { dispatchAt: isoWithTZ(dispatchAt), acceptedAt: isoWithTZ(acceptedAt), arrivedStoreAt: isoWithTZ(arrivedStoreAt), pickedAt: null };
  }

  return {
    orderId,
    createdAt: isoWithTZ(created),
    eta: isoWithTZ(eta),
    deliveredAt: deliveredStr,
    status,
    cancelReason,
    merchant,
    customer,
    timeline,
    rider
  };
}

async function main() {
  const N = 10000;
  const riders = Array.from({ length: 50 }, (_, i) => makeRider(i));
  const orders = Array.from({ length: N }, (_, i) => makeOrder(i, riders));
  const outPath = join(process.cwd(), 'public', 'data', 'orders.json');
  await writeFile(outPath, JSON.stringify(orders, null, 2), 'utf-8');
  console.log(`Generated ${N} orders to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });


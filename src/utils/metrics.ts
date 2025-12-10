import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import type { Order, SettlementItem } from "../types";
dayjs.extend(duration);

export function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = dayjs(b).diff(dayjs(a), "minute");
  return d >= 0 ? d : null;
}

export function deliveryDuration(order: Order): number | null {
  return minutesBetween(order.createdAt, order.deliveredAt);
}

export function stageDurations(order: Order) {
  return {
    dispatch: minutesBetween(order.createdAt, order.timeline.dispatchAt),
    accept: minutesBetween(order.timeline.dispatchAt, order.timeline.acceptedAt),
    arriveStore: minutesBetween(order.timeline.acceptedAt, order.timeline.arrivedStoreAt),
    pickup: minutesBetween(order.timeline.arrivedStoreAt, order.timeline.pickedAt),
    delivery: minutesBetween(order.timeline.pickedAt, order.deliveredAt)
  };
}

export function aggregateStageAverages(orders: Order[]) {
  const totals = { dispatch: 0, accept: 0, arriveStore: 0, pickup: 0, delivery: 0 };
  const counts = { dispatch: 0, accept: 0, arriveStore: 0, pickup: 0, delivery: 0 };
  orders.forEach(o => {
    const s = stageDurations(o);
    (Object.keys(s) as (keyof typeof s)[]).forEach(k => {
      const v = s[k];
      if (v != null) { totals[k] += v; counts[k] += 1; }
    });
  });
  return (Object.keys(totals) as (keyof typeof totals)[]).map(k => ({
    stage: k,
    minutes: counts[k] ? +(totals[k] / counts[k]).toFixed(1) : 0
  }));
}

export function kpi(orders: Order[]) {
  const completed = orders.filter(o => o.status === "已完成");
  const cancelled = orders.filter(o => o.status === "已取消");
  const onTime = completed.filter(o => {
    if (!o.deliveredAt) return false;
    return dayjs(o.deliveredAt).isBefore(dayjs(o.eta)) || dayjs(o.deliveredAt).isSame(dayjs(o.eta));
  });
  const avgDelivery = completed.length
    ? +(completed.map(deliveryDuration).filter((v): v is number => v != null)
        .reduce((a,b)=>a+b,0) / completed.length).toFixed(1)
    : 0;
  return {
    total: orders.length,
    completed: completed.length,
    cancelRate: orders.length ? +(cancelled.length / orders.length * 100).toFixed(1) : 0,
    onTimeRate: completed.length ? +(onTime.length / completed.length * 100).toFixed(1) : 0,
    avgDeliveryMinutes: avgDelivery
  };
}

export function incomeBreakdown(settlements: SettlementItem[]) {
  const sum = (arr: number[]) => arr.reduce((a,b)=>a+b,0);
  return {
    baseFee: sum(settlements.map(s=>s.baseFee)),
    distance: sum(settlements.map(s=>s.distanceSubsidy)),
    weight: sum(settlements.map(s=>s.weightSubsidy)),
    period: sum(settlements.map(s=>s.periodSubsidy)),
    reward: sum(settlements.map(s=>s.platformReward)),
    tip: sum(settlements.map(s=>s.tip)),
    penalties: sum(settlements.map(s=>s.penalties.timeout + s.penalties.complaint + s.penalties.cancel)),
    total: sum(settlements.map(s=> s.baseFee + s.distanceSubsidy + s.weightSubsidy + s.periodSubsidy + s.platformReward + s.tip - (s.penalties.timeout + s.penalties.complaint + s.penalties.cancel)))
  };
}

export function riderTotals(settlements: SettlementItem[]) {
  const map = new Map<string, number>();
  settlements.forEach(s => {
    const inc = s.baseFee + s.distanceSubsidy + s.weightSubsidy + s.periodSubsidy + s.platformReward + s.tip - (s.penalties.timeout + s.penalties.complaint + s.penalties.cancel);
    map.set(s.riderId, (map.get(s.riderId) || 0) + inc);
  });
  return Array.from(map.entries()).map(([riderId, amount]) => ({ riderId, amount: +amount.toFixed(2) }));
}

export function siteOrderCounts(orders: Order[]) {
  const map = new Map<string, number>();
  orders.forEach(o => map.set(o.rider.site, (map.get(o.rider.site) || 0) + 1));
  return Array.from(map.entries()).map(([site, count]) => ({ site, count }));
}

export function dailyIncome(settlements: SettlementItem[]) {
  const map = new Map<string, number>();
  settlements.forEach(s => {
    const d = s.settlement.date; // YYYY-MM-DD
    const inc = s.baseFee + s.distanceSubsidy + s.weightSubsidy + s.periodSubsidy + s.platformReward + s.tip - (s.penalties.timeout + s.penalties.complaint + s.penalties.cancel);
    map.set(d, +( (map.get(d) || 0) + inc ).toFixed(2));
  });
  return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date, amount]) => ({ date, amount }));
}

// 地区（网格）订单数量统计：按商家位置进行网格化统计
export function regionOrderCounts(orders: Order[], gridSize = 0.02) {
  // gridSize 大约是纬度/经度网格步长，0.02 ~ 2km 级
  const keyOf = (lat: number, lng: number) => {
    const glat = Math.floor(lat / gridSize) * gridSize;
    const glng = Math.floor(lng / gridSize) * gridSize;
    return `${glat.toFixed(2)},${glng.toFixed(2)}`; // 作为区域标签
  };
  const map = new Map<string, number>();
  orders.forEach(o => {
    const k = keyOf(o.merchant.lat, o.merchant.lng);
    map.set(k, (map.get(k) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a,b)=> b.count - a.count);
}

// 骑手效率排名：按完成单数、平均配送时长、准时率、取消率
export interface RiderEfficiencyRow {
  riderId: string;
  name: string;
  site: string;
  total: number;
  completed: number;
  avgDeliveryMinutes: number;
  onTimeRate: number; // 0~1
  cancelRate: number; // 0~1
}

export function riderEfficiencyRanking(orders: Order[]): RiderEfficiencyRow[] {
  const acc: Record<string, RiderEfficiencyRow & { _deliverySum: number; _onTime: number; _cancel: number }> = {};
  orders.forEach((o) => {
    const id = o.rider.riderId || "未知";
    const name = o.rider.name || id;
    const site = o.rider.site || "未知站点";
    if (!acc[id]) {
      acc[id] = {
        riderId: id,
        name,
        site,
        total: 0,
        completed: 0,
        avgDeliveryMinutes: 0,
        onTimeRate: 0,
        cancelRate: 0,
        _deliverySum: 0,
        _onTime: 0,
        _cancel: 0,
      };
    }
    const row = acc[id];
    row.total += 1;
    if (o.status === "已取消") {
      row._cancel += 1;
    }
    if (o.status === "已完成") {
      row.completed += 1;
      const minutes = deliveryDuration(o) ?? 0;
      row._deliverySum += minutes;
      const delivered = o.deliveredAt;
      const eta = o.eta;
      if (delivered) {
        // 准时判断：deliveredAt <= eta
        if (dayjs(delivered).isBefore(dayjs(eta)) || dayjs(delivered).isSame(dayjs(eta))) {
          row._onTime += 1;
        }
      }
    }
  });
  const rows = Object.values(acc).map((r) => {
    const avg = r.completed > 0 ? r._deliverySum / r.completed : 0;
    const onTimeRate = r.completed > 0 ? r._onTime / r.completed : 0;
    const cancelRate = r.total > 0 ? r._cancel / r.total : 0;
    return {
      riderId: r.riderId,
      name: r.name,
      site: r.site,
      total: r.total,
      completed: r.completed,
      avgDeliveryMinutes: Number(avg.toFixed(1)),
      onTimeRate: Number(onTimeRate.toFixed(4)),
      cancelRate: Number(cancelRate.toFixed(4)),
    } as RiderEfficiencyRow;
  });
  // 默认按完成单数降序，其次按准时率降序，最后按平均时长升序
  rows.sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    if (b.onTimeRate !== a.onTimeRate) return b.onTimeRate - a.onTimeRate;
    return a.avgDeliveryMinutes - b.avgDeliveryMinutes;
  });
  return rows;
}

// 骑手奖励计算（试行规则）
export interface RiderRewardRow {
  riderId: string;
  name: string;
  site: string;
  completed: number;
  onTimeRate: number; // 0~1
  avgDeliveryMinutes: number;
  cancelRate: number; // 0~1
  points: number; // 奖励积分
  reward: number; // 奖励金额（元）
}

const REWARD_RULES = {
  basePerOrder: 1,                 // 每完成一单基础积分
  onTimeThreshold: 0.85,           // 准时奖励阈值
  onTimeScalePerOrder: 0.5,        // 低于阈值不奖励，高于阈值按超出比例*每单系数奖励
  fastAvgBonus35: 5,               // 平均配送 <=35 分钟额外积分
  fastAvgBonus45: 3,               // 平均配送 <=45 分钟额外积分
  cancelPenaltyPerOrderRate: 1,    // 取消率 * 完成单数 的惩罚积分
  yuanPerPoint: 0.5,               // 每积分奖励金额（元）
};

export function riderRewards(orders: Order[]): RiderRewardRow[] {
  const eff = riderEfficiencyRanking(orders);
  const rows: RiderRewardRow[] = eff.map(r => {
    const base = r.completed * REWARD_RULES.basePerOrder;
    const onTimeBonus = r.onTimeRate > REWARD_RULES.onTimeThreshold
      ? (r.onTimeRate - REWARD_RULES.onTimeThreshold) * r.completed * REWARD_RULES.onTimeScalePerOrder
      : 0;
    const avgBonus = r.avgDeliveryMinutes <= 35
      ? REWARD_RULES.fastAvgBonus35
      : r.avgDeliveryMinutes <= 45
        ? REWARD_RULES.fastAvgBonus45
        : 0;
    const cancelPenalty = r.cancelRate * r.completed * REWARD_RULES.cancelPenaltyPerOrderRate;
    const points = Math.max(0, Number((base + onTimeBonus + avgBonus - cancelPenalty).toFixed(2)));
    const reward = Number((points * REWARD_RULES.yuanPerPoint).toFixed(2));
    return {
      riderId: r.riderId,
      name: r.name,
      site: r.site,
      completed: r.completed,
      onTimeRate: r.onTimeRate,
      avgDeliveryMinutes: r.avgDeliveryMinutes,
      cancelRate: r.cancelRate,
      points,
      reward,
    };
  });
  rows.sort((a,b)=> b.reward - a.reward);
  return rows;
}
import { describe, it, expect } from 'vitest';
import { minutesBetween, deliveryDuration, riderEfficiencyRanking, riderRewards } from '../utils/metrics';
import type { Order } from '../types';

const mkOrder = (partial: Partial<Order>): Order => ({
  orderId: partial.orderId || Math.random().toString(36).slice(2),
  createdAt: partial.createdAt || '2024-01-01T10:00:00Z',
  eta: partial.eta || '2024-01-01T10:30:00Z',
  deliveredAt: partial.deliveredAt ?? '2024-01-01T10:30:00Z',
  status: partial.status || '已完成',
  cancelReason: partial.cancelReason || null,
  merchant: partial.merchant || { lat: 31.23, lng: 121.47 },
  customer: partial.customer || { lat: 31.24, lng: 121.48 },
  timeline: partial.timeline || {
    dispatchAt: '2024-01-01T10:05:00Z',
    acceptedAt: '2024-01-01T10:07:00Z',
    arrivedStoreAt: '2024-01-01T10:15:00Z',
    pickedAt: '2024-01-01T10:18:00Z'
  },
  rider: partial.rider || { riderId: 'r1', name: 'Rider 1', site: 'A站' }
});

describe('metrics basic helpers', () => {
  it('minutesBetween returns null when either timestamp missing', () => {
    expect(minutesBetween(null, '2024-01-01T10:00:00Z')).toBeNull();
    expect(minutesBetween('2024-01-01T10:00:00Z', null)).toBeNull();
  });

  it('deliveryDuration computes minutes between createdAt and deliveredAt', () => {
    const o = mkOrder({ createdAt: '2024-01-01T10:00:00Z', deliveredAt: '2024-01-01T10:30:00Z' });
    expect(deliveryDuration(o)).toBe(30);
  });
});

describe('riderEfficiencyRanking', () => {
  it('aggregates and sorts riders by completed, onTimeRate, avgDelivery', () => {
    const r1a = mkOrder({
      rider: { riderId: 'r1', name: 'Alice', site: 'A站' },
      createdAt: '2024-01-01T10:00:00Z', deliveredAt: '2024-01-01T10:30:00Z',
      eta: '2024-01-01T10:35:00Z', status: '已完成'
    });
    const r1b = mkOrder({
      rider: { riderId: 'r1', name: 'Alice', site: 'A站' },
      createdAt: '2024-01-01T11:00:00Z', deliveredAt: '2024-01-01T11:50:00Z',
      eta: '2024-01-01T11:45:00Z', status: '已完成'
    });
    const r1c = mkOrder({
      rider: { riderId: 'r1', name: 'Alice', site: 'A站' },
      createdAt: '2024-01-01T12:00:00Z', deliveredAt: null,
      eta: '2024-01-01T12:40:00Z', status: '已取消'
    });

    const r2a = mkOrder({
      rider: { riderId: 'r2', name: 'Bob', site: 'B站' },
      createdAt: '2024-01-01T09:00:00Z', deliveredAt: '2024-01-01T09:40:00Z',
      eta: '2024-01-01T09:45:00Z', status: '已完成'
    });
    const r2b = mkOrder({
      rider: { riderId: 'r2', name: 'Bob', site: 'B站' },
      createdAt: '2024-01-01T10:00:00Z', deliveredAt: '2024-01-01T10:35:00Z',
      eta: '2024-01-01T10:35:00Z', status: '已完成'
    });

    const rows = riderEfficiencyRanking([r1a, r1b, r1c, r2a, r2b]);
    expect(rows.length).toBe(2);
    // r2 应该排名靠前（同样完成 2 单，但准时率更高）
    expect(rows[0].riderId).toBe('r2');
    expect(rows[0].completed).toBe(2);
    expect(rows[0].onTimeRate).toBeCloseTo(1, 4);
    expect(rows[0].avgDeliveryMinutes).toBeCloseTo(37.5, 1);

    expect(rows[1].riderId).toBe('r1');
    expect(rows[1].completed).toBe(2);
    expect(rows[1].onTimeRate).toBeCloseTo(0.5, 4);
    expect(rows[1].cancelRate).toBeCloseTo(1/3, 4);
    expect(rows[1].avgDeliveryMinutes).toBeCloseTo(40, 1);
  });
});

describe('riderRewards', () => {
  it('calculates points and monetary rewards with rounding', () => {
    const r1a = mkOrder({ rider: { riderId: 'r1', name: 'Alice', site: 'A站' }, createdAt: '2024-01-01T10:00:00Z', deliveredAt: '2024-01-01T10:30:00Z', eta: '2024-01-01T10:35:00Z', status: '已完成' });
    const r1b = mkOrder({ rider: { riderId: 'r1', name: 'Alice', site: 'A站' }, createdAt: '2024-01-01T11:00:00Z', deliveredAt: '2024-01-01T11:50:00Z', eta: '2024-01-01T11:45:00Z', status: '已完成' });
    const r1c = mkOrder({ rider: { riderId: 'r1', name: 'Alice', site: 'A站' }, createdAt: '2024-01-01T12:00:00Z', deliveredAt: null, eta: '2024-01-01T12:40:00Z', status: '已取消' });

    const r2a = mkOrder({ rider: { riderId: 'r2', name: 'Bob', site: 'B站' }, createdAt: '2024-01-01T09:00:00Z', deliveredAt: '2024-01-01T09:40:00Z', eta: '2024-01-01T09:45:00Z', status: '已完成' });
    const r2b = mkOrder({ rider: { riderId: 'r2', name: 'Bob', site: 'B站' }, createdAt: '2024-01-01T10:00:00Z', deliveredAt: '2024-01-01T10:35:00Z', eta: '2024-01-01T10:35:00Z', status: '已完成' });

    const rewards = riderRewards([r1a, r1b, r1c, r2a, r2b]);
    const r2 = rewards.find(r => r.riderId === 'r2')!;
    const r1 = rewards.find(r => r.riderId === 'r1')!;

    // r2: base=2, onTimeBonus=(1-0.85)*2*0.5=0.15, avgBonus=3, penalty=0 => points=5.15, reward=2.58
    expect(r2.points).toBeCloseTo(5.15, 2);
    expect(r2.reward).toBeCloseTo(2.58, 2);

    // r1: base=2, onTimeBonus=0, avgBonus=3, penalty=(1/3)*2=0.6667 => points≈4.33, reward≈2.17
    expect(r1.points).toBeCloseTo(4.33, 2);
    expect(r1.reward).toBeCloseTo(2.17, 2);

    // 排序按奖励金额降序
    expect(rewards[0].riderId).toBe('r2');
    expect(rewards[1].riderId).toBe('r1');
  });
});
import type { GeoPoint, Order } from '../types';

// 射线法判断点是否在多边形内（经纬度）
export function pointInPolygon(point: GeoPoint, polygon: [number, number][]): boolean {
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 任一点（商家或顾客）落在任一多边形即视为命中
export function orderInPolygons(order: Order, polygons: [number, number][][]): boolean {
  if (!polygons.length) return true; // 未选择区域时不过滤
  return polygons.some(poly => pointInPolygon(order.merchant, poly) || pointInPolygon(order.customer, poly));
}

export function countByArea(orders: Order[], areas: { name: string; polygons: [number, number][][] }[]) {
  const result: { area: string; count: number }[] = [];
  for (const area of areas) {
    const c = orders.filter(o => orderInPolygons(o, area.polygons)).length;
    result.push({ area: area.name, count: c });
  }
  return result.sort((a,b)=>b.count-a.count);
}

// Haversine 距离（米）
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (v: number) => v * Math.PI / 180;
  const R = 6371000; // 地球半径米
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export function estimateTravelMinutes(meters: number, speedKmh = 18): number {
  const km = meters / 1000;
  const hours = km / Math.max(1, speedKmh);
  return Math.round(hours * 60);
}

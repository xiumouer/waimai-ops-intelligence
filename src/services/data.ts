import type { Order, SettlementItem } from "../types";

async function tryFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadOrders(): Promise<Order[]> {
  // 优先从 API 获取，失败则回退到静态 JSON
  const api = await tryFetch<Order[]>("/api/orders");
  if (api) return api;
  const fallback = await tryFetch<Order[]>("/data/orders.json");
  return fallback || [];
}

export async function loadSettlements(): Promise<SettlementItem[]> {
  const api = await tryFetch<SettlementItem[]>("/api/settlements");
  if (api) return api;
  const fallback = await tryFetch<SettlementItem[]>("/data/settlements.json");
  return fallback || [];
}

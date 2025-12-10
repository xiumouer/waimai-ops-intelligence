export type OrderStatus = "待接单" | "已接单" | "已到店" | "配送中" | "已完成" | "已取消";

export interface GeoPoint { lat: number; lng: number }

export interface Rider { riderId: string; name: string; site: string }

export interface Timeline {
  dispatchAt: string | null;
  acceptedAt: string | null;
  arrivedStoreAt: string | null;
  pickedAt: string | null;
}

export interface Order {
  orderId: string;
  createdAt: string;
  eta: string; // 预计送达
  deliveredAt: string | null; // 实际送达
  status: OrderStatus;
  cancelReason: string | null;
  merchant: GeoPoint;
  customer: GeoPoint;
  timeline: Timeline;
  rider: Rider;
}

export interface Penalties { timeout: number; complaint: number; cancel: number }

export interface SettlementInfo { date: string; amount: number; status: string }

export interface SettlementItem {
  orderId: string;
  riderId: string;
  baseFee: number;
  distanceSubsidy: number;
  weightSubsidy: number;
  periodSubsidy: number; // 夜间/雨天等
  platformReward: number;
  tip: number; // 用户打赏
  penalties: Penalties;
  settlement: SettlementInfo;
}
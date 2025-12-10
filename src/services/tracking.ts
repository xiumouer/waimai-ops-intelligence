import type { GeoPoint } from '../types';

type TracePoint = GeoPoint & { ts: number };

type TraceStore = {
  current: Record<string, TracePoint | null>;
  traces: Record<string, TracePoint[]>;
};

const KEY = 'riderTraceStore';

function readStore(): TraceStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { current: {}, traces: {} };
    const parsed = JSON.parse(raw);
    return {
      current: parsed.current || {},
      traces: parsed.traces || {},
    };
  } catch {
    return { current: {}, traces: {} };
  }
}

function writeStore(s: TraceStore) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function setCurrent(riderId: string, point: GeoPoint) {
  const s = readStore();
  const tp: TracePoint = { ...point, ts: Date.now() };
  s.current[riderId] = tp;
  const arr = s.traces[riderId] || [];
  arr.push(tp);
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  s.traces[riderId] = arr;
  writeStore(s);
}

export function getCurrent(riderId: string): TracePoint | null {
  return readStore().current[riderId] || null;
}

export function getTrace(riderId: string): TracePoint[] {
  return readStore().traces[riderId] || [];
}

export function clearTrace(riderId: string) {
  const s = readStore();
  s.traces[riderId] = [];
  writeStore(s);
}


import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadOrders } from '../services/data';
import type { Order, GeoPoint } from '../types';
import { distanceMeters, estimateTravelMinutes } from '../utils/geo';
import { downloadCSV, toCSV } from '../utils/export';
import { loadAMap, getDrivingTimeMinutes, getPreciseLocation, reverseGeocodeRich } from '../utils/amap';
import { getCurrent, setCurrent, getTrace, clearTrace } from '../services/tracking';
import { getAssignments, saveAssignments, clearAssignments, getDateStr } from '../services/dispatch';

type PlanStep = { type: '商家' | '顾客'; orderId: string; pos: GeoPoint; distM: number; etaMin: number };

export default function Dispatch() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderId, setRiderId] = useState<string>('');
  const [capacity, setCapacity] = useState<number>(3);
  const [speedKmh, setSpeedKmh] = useState<number>(18);
  const [siteFilter, setSiteFilter] = useState<string>('全部');
  const [sortMode, setSortMode] = useState<'紧急优先' | '距离优先'>('紧急优先');
  const [maxDistanceM, setMaxDistanceM] = useState<number>(3000);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [useDrivingEta, setUseDrivingEta] = useState<boolean>(true);
  const [driveTimes, setDriveTimes] = useState<Record<string, number>>({});
  const [geoInfo, setGeoInfo] = useState<any | null>(null);
  const [geoInfoTarget, setGeoInfoTarget] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [clickResolve, setClickResolve] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const amapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await loadOrders();
        setOrders(data);
      } catch (e) {
        setError('订单数据加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const riders = useMemo(() => Array.from(new Set(orders.map(o => o.rider.riderId))), [orders]);
  const sites = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.site)))], [orders]);

  const candidates = useMemo(() => {
    // 可派单：剔除已完成/取消
    const pool = orders.filter(o => (siteFilter === '全部' || o.rider.site === siteFilter) && o.status !== '已完成' && o.status !== '已取消');
    // 暂取所有订单作为候选，真实系统应按区域/班组筛选
    return pool;
  }, [orders, siteFilter]);

  const currentPos = useMemo(() => {
    if (!riderId) return null;
    return getCurrent(riderId)?.ts ? getCurrent(riderId) : null;
  }, [riderId]);

  useEffect(() => {
    if (!riderId) {
      if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
      setWsConnected(false);
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.hostname}:8080/`;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsConnected(true);
        const msg = { type: 'subscribe', riderId };
        try { ws.send(JSON.stringify(msg)); } catch {}
      };
      ws.onmessage = (ev) => {
        let data: any;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (!data || !data.type) return;
        if (data.type === 'pos' && data.riderId === riderId && data.lng != null && data.lat != null) {
          setCurrent(riderId, { lat: Number(data.lat), lng: Number(data.lng) });
        }
      };
      ws.onclose = () => { setWsConnected(false); wsRef.current = null; };
      ws.onerror = () => { setWsConnected(false); };
    } catch {
      setWsConnected(false);
    }
    return () => {
      const ws = wsRef.current;
      if (ws) { try { ws.close(); } catch {} wsRef.current = null; }
      setWsConnected(false);
    };
  }, [riderId]);

  const nowMs = Date.now();
  const candidateScores = useMemo(() => {
    if (!currentPos) return [];
    const scored = candidates.map(o => {
      const next = o.timeline.pickedAt ? o.customer : o.merchant;
      const d = distanceMeters(currentPos, next);
      const travelMin = useDrivingEta && driveTimes[o.orderId] != null ? driveTimes[o.orderId] : estimateTravelMinutes(d, speedKmh);
      const etaMinLeft = Math.round((new Date(o.eta).getTime() - nowMs) / 60000);
      const urgency = etaMinLeft - travelMin;
      return { order: o, next, travelMin, etaMinLeft, urgency, distM: d };
    }).filter(s => s.distM <= maxDistanceM);
    return scored.sort((a,b)=> sortMode === '紧急优先' ? (a.urgency - b.urgency) : (a.distM - b.distM));
  }, [candidates, currentPos, speedKmh, nowMs, sortMode, maxDistanceM, useDrivingEta, driveTimes]);

  const plan: PlanStep[] = useMemo(() => {
    if (!currentPos) return [];
    const base = assignedIds.length
      ? candidateScores.filter(s => assignedIds.includes(s.order.orderId))
      : candidateScores.slice(0, Math.max(1, capacity));
    const selected = base;
    const steps: PlanStep[] = [];
    let cur = currentPos as GeoPoint;
    const remaining = new Set(selected.map(s => s.order.orderId));
    while (remaining.size) {
      // 找离当前最近的下一站
      let best: { s: typeof selected[number]; distM: number } | null = null;
      for (const s of selected) {
        if (!remaining.has(s.order.orderId)) continue;
        const nextPos = s.order.timeline.pickedAt ? s.order.customer : s.order.merchant;
        const dm = distanceMeters(cur, nextPos);
        if (!best || dm < best.distM) best = { s, distM: dm };
      }
      if (!best) break;
      const s = best.s;
      const nextPos = s.order.timeline.pickedAt ? s.order.customer : s.order.merchant;
      const dm = best.distM;
      const em = estimateTravelMinutes(dm, speedKmh);
      steps.push({ type: s.order.timeline.pickedAt ? '顾客' : '商家', orderId: s.order.orderId, pos: nextPos, distM: dm, etaMin: em });
      cur = nextPos;
      // 如果是未取餐，补充顾客一步
      if (!s.order.timeline.pickedAt) {
        const dm2 = distanceMeters(cur, s.order.customer);
        const em2 = estimateTravelMinutes(dm2, speedKmh);
        steps.push({ type: '顾客', orderId: s.order.orderId, pos: s.order.customer, distM: dm2, etaMin: em2 });
        cur = s.order.customer;
      }
      remaining.delete(s.order.orderId);
    }
    return steps;
  }, [candidateScores, capacity, currentPos, speedKmh, assignedIds]);

  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentPos) { setPlanSteps([]); return; }
      if (!useDrivingEta || plan.length === 0) { setPlanSteps(plan); return; }
      const enriched: PlanStep[] = [];
      let prev = currentPos as GeoPoint;
      for (const s of plan) {
        const min = await getDrivingTimeMinutes(prev, s.pos);
        const dm = s.distM || distanceMeters(prev, s.pos);
        enriched.push({ ...s, distM: dm, etaMin: min != null ? min : estimateTravelMinutes(dm, speedKmh) });
        if (cancelled) return;
        prev = s.pos;
      }
      if (!cancelled) setPlanSteps(enriched);
    })();
    return () => { cancelled = true; };
  }, [plan, currentPos, useDrivingEta, speedKmh]);

  // 加载已指派
  useEffect(() => {
    if (!riderId) { setAssignedIds([]); return; }
    const ids = getAssignments(riderId, getDateStr());
    setAssignedIds(ids);
  }, [riderId]);

  const handleAssignTopN = () => {
    if (!riderId || !currentPos) return;
    const top = candidateScores.slice(0, Math.max(1, capacity)).map(s => s.order.orderId);
    saveAssignments(riderId, getDateStr(), top);
    setAssignedIds(top);
  };

  const handleClearAssign = () => {
    if (!riderId) return;
    clearAssignments(riderId, getDateStr());
    setAssignedIds([]);
  };

  const handleResolveLocation = async (orderId: string, pos: GeoPoint) => {
    setGeoError(null);
    setGeoInfo(null);
    setGeoInfoTarget(orderId);
    setGeoLoading(true);
    const info = await reverseGeocodeRich(pos);
    if (!info) setGeoError('逆地理解析失败'); else setGeoInfo(info);
    setGeoLoading(false);
  };

  // 地图渲染（骑手位置、轨迹、建议路线）
  useEffect(() => {
    (async () => {
      if (!mapRef.current) return;
      const AMap = await loadAMap();
      if (!amapRef.current) {
        amapRef.current = new (AMap as any).Map(mapRef.current, {
          viewMode: '2D',
          zoom: 13,
          center: [121.4737, 31.2304],
          mapStyle: 'amap://styles/dark',
        });
        amapRef.current.addControl(new (AMap as any).ToolBar());
        amapRef.current.addControl(new (AMap as any).Scale());
      }
      // 清理旧覆盖物
      overlaysRef.current.forEach(o => o.setMap(null));
      overlaysRef.current = [];
      const map = amapRef.current;

      if (currentPos) {
        const curMarker = new (AMap as any).Circle({
          center: [currentPos.lng, currentPos.lat],
          radius: 60,
          strokeColor: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.25,
        });
        overlaysRef.current.push(curMarker);
      }

      // 轨迹
      if (riderId) {
        const trace = getTrace(riderId);
        if (trace.length > 1) {
          const path = trace.map(p => [p.lng, p.lat]);
          const poly = new (AMap as any).Polyline({ path, strokeColor: '#60a5fa', strokeOpacity: 0.9, strokeWeight: 3 });
          overlaysRef.current.push(poly);
          amapRef.current.setFitView([poly]);
        }
      }

      // 建议路线
      if (planSteps.length > 0) {
        const route = planSteps.map(s => [s.pos.lng, s.pos.lat]);
        const poly = new (AMap as any).Polyline({ path: route, strokeColor: '#22d3ee', strokeOpacity: 0.95, strokeWeight: 4 });
        overlaysRef.current.push(poly);
        // 标注每一步
        planSteps.forEach((s, idx) => {
          const m = new (AMap as any).Marker({ position: [s.pos.lng, s.pos.lat], label: { content: `#${idx+1} ${s.type}(${s.orderId})`, direction: 'top' } });
          overlaysRef.current.push(m);
        });
      }

      map.add(overlaysRef.current);
    })();
  }, [currentPos, planSteps, riderId]);

  useEffect(() => {
    let handler: any;
    (async () => {
      if (!clickResolve) return;
      const map = amapRef.current;
      if (!map) return;
      const AMap = await loadAMap();
      handler = (e: any) => {
        const lng = e.lnglat?.lng ?? (e.lnglat?.getLng ? e.lnglat.getLng() : undefined);
        const lat = e.lnglat?.lat ?? (e.lnglat?.getLat ? e.lnglat.getLat() : undefined);
        if (lng == null || lat == null) return;
        const pos = { lng, lat } as GeoPoint;
        const marker = new (AMap as any).Marker({ position: [pos.lng, pos.lat] });
        overlaysRef.current.push(marker);
        map.add(marker);
        setGeoError(null);
        setGeoInfo(null);
        setGeoInfoTarget('地图点选');
        setGeoLoading(true);
        reverseGeocodeRich(pos).then(info => {
          if (!info) setGeoError('逆地理解析失败'); else setGeoInfo(info);
          setGeoLoading(false);
        });
      };
      map.on('click', handler);
    })();
    return () => {
      const map = amapRef.current;
      if (map && handler) map.off('click', handler);
    };
  }, [clickResolve]);

  // 异步加载路网时长（前50条候选，减少调用量）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!useDrivingEta || !currentPos || candidates.length === 0) return;
      const top = candidates.slice(0, 50);
      const updates: Record<string, number> = {};
      for (const o of top) {
        const next = o.timeline.pickedAt ? o.customer : o.merchant;
        const min = await getDrivingTimeMinutes(currentPos, next);
        if (cancelled) return;
        if (min != null) updates[o.orderId] = min;
      }
      if (!cancelled && Object.keys(updates).length) {
        setDriveTimes(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [useDrivingEta, currentPos, candidates]);

  const handleLocate = async () => {
    if (!riderId) return;
    const p = await getPreciseLocation();
    if (p) {
      setCurrent(riderId, { lat: p.lat, lng: p.lng });
    } else {
      console.warn('定位失败');
    }
  };

  const simulateStep = () => {
    if (!riderId) return;
    const last = getCurrent(riderId);
    const base = last || { lat: 31.2304, lng: 121.4737 };
    const jitter = () => (Math.random() - 0.5) * 0.001; // ~100m
    setCurrent(riderId, { lat: base.lat + jitter(), lng: base.lng + jitter() });
  };

  return (
    <div className="grid">
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="controls">
          <div className="control">
            <label>骑手</label>
            <select className="select" value={riderId} onChange={e=>{ setRiderId(e.target.value); }}>
              <option value="">请选择骑手</option>
              {riders.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="control">
            <label>站点</label>
            <select className="select" value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="control">
            <label>承载上限</label>
            <input className="input" type="number" min={1} max={8} value={capacity} onChange={e=>setCapacity(Number(e.target.value)||3)} />
          </div>
          <div className="control">
            <label>预估速度(km/h)</label>
            <input className="input" type="number" min={8} max={30} value={speedKmh} onChange={e=>setSpeedKmh(Number(e.target.value)||18)} />
          </div>
          <button className="button" onClick={handleLocate} disabled={!riderId}>定位骑手</button>
          <button className="button" onClick={simulateStep} disabled={!riderId}>模拟移动</button>
          <button className="button ghost" onClick={()=>{ if (riderId) clearTrace(riderId); }}>清空轨迹</button>
          <span className="muted">移动端连接：{wsConnected ? '已连接' : '未连接'}</span>
          <div className="control">
            <label>使用路网时长</label>
            <input type="checkbox" checked={useDrivingEta} onChange={e=>setUseDrivingEta(e.target.checked)} />
          </div>
          <div className="control">
            <label>地图点选解析</label>
            <input type="checkbox" checked={clickResolve} onChange={e=>setClickResolve(e.target.checked)} />
          </div>
          <div className="control">
            <label>排序</label>
            <select className="select" value={sortMode} onChange={e=>setSortMode(e.target.value as any)}>
              <option>紧急优先</option>
              <option>距离优先</option>
            </select>
          </div>
          <div className="control">
            <label>最大距离(m)</label>
            <input className="input" type="number" min={500} max={10000} step={100} value={maxDistanceM} onChange={e=>setMaxDistanceM(Number(e.target.value)||3000)} />
          </div>
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header" style={{justifyContent:'space-between'}}>
          <h3 className="card-title">骑手实时路径与路线建议</h3>
          {(() => { const total = planSteps.reduce((acc, s) => acc + s.etaMin, 0); return <span className="muted">总行程约 {total} 分钟</span>; })()}
        </div>
        <div style={{height:420}} ref={mapRef} />
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3 className="card-title">建议接单与顺序</h3>
        {(!riderId || !currentPos) ? (
          <div className="muted">请选择骑手并定位或模拟位置，然后生成建议</div>
        ) : (
          <div style={{maxHeight:260, overflow:'auto'}}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th>订单</th><th>下一站</th><th className="num">距当前(m)</th><th className="num">预计行程(分钟)</th><th className="num">距ETA(分钟)</th><th>紧急度</th><th>导航</th><th>位置详情</th>
                </tr>
              </thead>
              <tbody>
                {candidateScores.slice(0, Math.max(1, capacity)).map((s, idx) => (
                  <tr key={s.order.orderId}>
                    <td>{idx+1}</td>
                    <td>{s.order.orderId}</td>
                    <td>{s.order.timeline.pickedAt ? '顾客' : '商家'}</td>
                    <td className="num">{Math.round(distanceMeters(currentPos, s.next))}</td>
                    <td className="num">{s.travelMin}</td>
                    <td className="num">{s.etaMinLeft}</td>
                    <td style={{color: s.urgency < 0 ? 'var(--danger)' : s.urgency <= 5 ? 'var(--warning)' : 'var(--muted)'}}>
                      {s.urgency < 0 ? '紧急' : s.urgency <= 5 ? '较紧' : '宽松'}
                    </td>
                    <td>
                      <a className="button" href={`https://uri.amap.com/navigation?to=${s.next.lng},${s.next.lat}&callnative=1`} target="_blank" rel="noreferrer">前往</a>
                    </td>
                    <td>
                      <button className="button ghost" onClick={()=>handleResolveLocation(s.order.orderId, s.next)}>解析</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="muted" style={{marginTop:8}}>说明：紧急度=距ETA-预计行程；负值越大越紧急。实际派单需结合后台路况与承载约束。</div>
        {(geoLoading || geoError || geoInfo) && (
          <div className="card" style={{marginTop:8}}>
            <h4>位置详情{geoInfoTarget ? `（订单 ${geoInfoTarget}）` : ''}</h4>
            {geoLoading && <span className="muted">解析中...</span>}
            {geoError && <span style={{color:'var(--danger)'}}>{geoError}</span>}
            {geoInfo && (
              <div>
                <div className="muted">{geoInfo.formattedAddress || '-'}</div>
                <div style={{display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:12, marginTop:8}}>
                  <div className="card" style={{gridColumn:'span 4'}}>
                    <h5>道路</h5>
                    <ul style={{margin:0, paddingLeft:18}}>
                      {(geoInfo.roads||[]).slice(0,5).map((r:any,idx:number)=>(<li key={idx}>{r.name} {r.distance?`·${r.distance}m`:''} {r.direction||''}</li>))}
                    </ul>
                  </div>
                  <div className="card" style={{gridColumn:'span 4'}}>
                    <h5>兴趣点</h5>
                    <ul style={{margin:0, paddingLeft:18}}>
                      {(geoInfo.pois||[]).slice(0,8).map((p:any,idx:number)=>(<li key={idx}>{p.name} {p.type?`·${p.type}`:''}</li>))}
                    </ul>
                  </div>
                  <div className="card" style={{gridColumn:'span 4'}}>
                    <h5>商圈</h5>
                    <ul style={{margin:0, paddingLeft:18}}>
                      {(geoInfo.businessAreas||[]).slice(0,6).map((b:any,idx:number)=>(<li key={idx}>{b.name}</li>))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8}}>
          <button className="button" disabled={!riderId || !currentPos} onClick={handleAssignTopN}>指派前{Math.max(1, capacity)}单</button>
          <button className="button ghost" disabled={!riderId || assignedIds.length===0} onClick={handleClearAssign}>清空指派</button>
          <span className="muted">已指派：{assignedIds.length} 单（{getDateStr()}）</span>
          <button className="button ghost" disabled={!riderId || !currentPos} onClick={() => {
            const rows = candidateScores.slice(0, Math.max(1, capacity)).map(s => ({
              rank: candidateScores.indexOf(s) + 1,
              orderId: s.order.orderId,
              nextType: s.order.timeline.pickedAt ? '顾客' : '商家',
              distanceM: Math.round(distanceMeters(currentPos, s.next)),
              travelMin: s.travelMin,
              etaMinLeft: s.etaMinLeft,
              urgency: s.urgency,
            }));
            const csv = toCSV(rows, ['rank','orderId','nextType','distanceM','travelMin','etaMinLeft','urgency']);
            downloadCSV(`dispatch_${riderId}_${getDateStr()}.csv`, csv);
          }}>导出建议CSV</button>
        </div>
      </div>

      {/* 实验：全站点骑手的自动分配 */}
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header" style={{justifyContent:'space-between'}}>
          <h3 className="card-title">全站点自动分配（实验）</h3>
          <span className="muted">按路网时长/距离的全局贪心分配，每骑手承载上限</span>
        </div>
        <GlobalAssign
          orders={orders}
          siteFilter={siteFilter}
          useDrivingEta={useDrivingEta}
          speedKmh={speedKmh}
          onPreviewRider={(rid)=>setRiderId(rid)}
        />
      </div>
    </div>
  );
}

type Pair = { riderId: string; orderId: string; costMin: number; next: GeoPoint };

function GlobalAssign({ orders, siteFilter, useDrivingEta, speedKmh, onPreviewRider }: { orders: Order[]; siteFilter: string; useDrivingEta: boolean; speedKmh: number; onPreviewRider: (riderId: string) => void }) {
  const riders = useMemo(() => Array.from(new Set(orders.map(o => o.rider.riderId))), [orders]);
  const [capPerRider, setCapPerRider] = useState<number>(3);
  const [result, setResult] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState<Record<string, PlanStep[]>>({});
  const [previewRid, setPreviewRid] = useState<string>('');

  const candidates = useMemo(() => orders.filter(o => (siteFilter === '全部' || o.rider.site === siteFilter) && o.status !== '已完成' && o.status !== '已取消'), [orders, siteFilter]);

  const compute = async () => {
    setLoading(true);
    try {
      const pairs: Pair[] = [];
      for (const r of riders) {
        const cur = getCurrent(r);
        if (!cur?.ts) continue; // 仅参与有位置的骑手
        for (const o of candidates) {
          const next = o.timeline.pickedAt ? o.customer : o.merchant;
          let min: number | null = null;
          if (useDrivingEta) {
            min = await getDrivingTimeMinutes(cur, next);
          }
          if (min == null) {
            const d = distanceMeters(cur, next);
            min = estimateTravelMinutes(d, speedKmh);
          }
          pairs.push({ riderId: r, orderId: o.orderId, costMin: min!, next });
        }
      }
      pairs.sort((a,b)=> a.costMin - b.costMin);
      const assignedOrders = new Set<string>();
      const cap: Record<string, number> = Object.fromEntries(riders.map(r => [r, 0]));
      const res: Record<string, string[]> = Object.fromEntries(riders.map(r => [r, []]));
      for (const p of pairs) {
        if (assignedOrders.has(p.orderId)) continue;
        if (cap[p.riderId] >= capPerRider) continue;
        res[p.riderId].push(p.orderId);
        cap[p.riderId]++;
        assignedOrders.add(p.orderId);
      }
      setResult(res);
      const orderMap = new Map(orders.map(o => [o.orderId, o]));
      const newRoutes: Record<string, PlanStep[]> = {};
      for (const r of riders) {
        const list = res[r] || [];
        const curPos = getCurrent(r);
        if (!curPos?.ts || list.length === 0) { newRoutes[r] = []; continue; }
        const selected = list.map(id => orderMap.get(id)).filter(Boolean) as Order[];
        const remaining = new Set(selected.map(o => o.orderId));
        let cur = curPos as GeoPoint;
        const steps: PlanStep[] = [];
        while (remaining.size) {
          let pick: Order | null = null;
          let bestDist = Infinity;
          for (const o of selected) {
            if (!remaining.has(o.orderId)) continue;
            const nextPos = o.timeline.pickedAt ? o.customer : o.merchant;
            const dm = distanceMeters(cur, nextPos);
            if (dm < bestDist) { bestDist = dm; pick = o; }
          }
          if (!pick) break;
          const nextPos = pick.timeline.pickedAt ? pick.customer : pick.merchant;
          const dm = distanceMeters(cur, nextPos);
          const em = estimateTravelMinutes(dm, speedKmh);
          steps.push({ type: pick.timeline.pickedAt ? '顾客' : '商家', orderId: pick.orderId, pos: nextPos, distM: dm, etaMin: em });
          cur = nextPos;
          if (!pick.timeline.pickedAt) {
            const dm2 = distanceMeters(cur, pick.customer);
            const em2 = estimateTravelMinutes(dm2, speedKmh);
            steps.push({ type: '顾客', orderId: pick.orderId, pos: pick.customer, distM: dm2, etaMin: em2 });
            cur = pick.customer;
          }
          remaining.delete(pick.orderId);
        }
        newRoutes[r] = steps;
      }
      setRoutes(newRoutes);
    } finally {
      setLoading(false);
    }
  };

  const persist = () => {
    const date = getDateStr();
    Object.entries(result).forEach(([rid, list]) => {
      if (list.length) saveAssignments(rid, date, list);
    });
  };

  const totalAssigned = Object.values(result).reduce((acc, arr) => acc + arr.length, 0);
  const totalMinutes = previewRid && routes[previewRid] ? routes[previewRid].reduce((acc, s) => acc + s.etaMin, 0) : 0;

  return (
    <div>
      <div className="controls">
        <div className="control">
          <label>每骑手承载上限</label>
          <input className="input" type="number" min={1} max={8} value={capPerRider} onChange={e=>setCapPerRider(Number(e.target.value)||3)} />
        </div>
        <button className="button" onClick={compute} disabled={loading}>生成建议</button>
        <button className="button ghost" onClick={persist} disabled={totalAssigned===0}>保存建议指派</button>
        {loading && <span className="muted">计算中...</span>}
        <span className="muted">合计建议：{totalAssigned} 单</span>
        <div className="control">
          <label>预览骑手</label>
          <select className="select" value={previewRid} onChange={e=>{ const v = e.target.value; setPreviewRid(v); if (v) onPreviewRider(v); }}>
            <option value="">选择预览</option>
            {riders.filter(r => (result[r]||[]).length>0).map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {previewRid && <span className="muted">总行程约 {totalMinutes} 分钟</span>}
      </div>
      <div style={{maxHeight:220, overflow:'auto', marginTop:8}}>
        <table className="table">
          <thead>
            <tr>
              <th>骑手</th><th>建议订单列表</th>
            </tr>
          </thead>
          <tbody>
            {riders.map(r => (
              <tr key={r}>
                <td>{r}</td>
                <td>{(result[r]||[]).join(', ') || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previewRid && (routes[previewRid]||[]).length>0 && (
        <div style={{maxHeight:220, overflow:'auto', marginTop:8}}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>类型</th><th>订单</th><th className="num">距离(m)</th><th className="num">行程(分钟)</th>
              </tr>
            </thead>
            <tbody>
              {routes[previewRid].map((s, idx) => (
                <tr key={`${s.orderId}-${idx}`}>
                  <td>{idx+1}</td>
                  <td>{s.type}</td>
                  <td>{s.orderId}</td>
                  <td className="num">{Math.round(s.distM)}</td>
                  <td className="num">{s.etaMin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

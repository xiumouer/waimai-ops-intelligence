import React, { useEffect, useMemo, useState } from 'react';
import { loadOrders, loadSettlements } from '../services/data';
import type { Order, SettlementItem } from '../types';
import { incomeBreakdown, riderTotals } from '../utils/metrics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import AMapView from '../shared/components/AMapView';
import { getPreciseLocation } from '../utils/amap';
import { orderInPolygons } from '../utils/geo';

// 使用高德地图替换 Leaflet

export default function Geography() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState<string>('全部');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [topRegions] = useState<number>(10);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(12);
  const [drawCommand, setDrawCommand] = useState<'start' | 'finish' | 'clear' | undefined>(undefined);
  const [drawing, setDrawing] = useState<boolean>(false);
  const [customAreas, setCustomAreas] = useState<{ name: string; polygons: [number, number][][] }[]>([]);
  const [settlements, setSettlements] = useState<SettlementItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await loadOrders();
        setOrders(data);
        const pays = await loadSettlements();
        setSettlements(pays);
      } catch (e) {
        setError('订单数据加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sites = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.site)))], [orders]);
  const filtered = useMemo(() => orders.filter(o => {
    const okSite = (siteFilter === '全部' || o.rider.site === siteFilter);
    const created = new Date(o.createdAt).getTime();
    const okStart = startDate ? created >= new Date(startDate).getTime() : true;
    const okEnd = endDate ? created <= new Date(endDate).getTime() + 24*60*60*1000 - 1 : true;
    return okSite && okStart && okEnd;
  }), [orders, siteFilter, startDate, endDate]);

  // 中心与缩放交给 AMapView 处理

  const handleLocate = async () => {
    setGeoError(null);
    setLocating(true);
    const p = await getPreciseLocation();
    if (!p) {
      setGeoError('定位失败：请检查浏览器位置权限或域名白名单');
      setLocating(false);
      return;
    }
    setUserLocation({ lat: p.lat, lng: p.lng });
    const acc = p.accuracy || 0;
    if (acc && acc < 80) setMapZoom(16);
    else if (acc && acc < 200) setMapZoom(15);
    else setMapZoom(14);
    setLocating(false);
  };

  return (
    <div className="grid">
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="controls">
          <div className="control">
            <label>站点</label>
            <select className="select" value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="control">
            <label>开始日期</label>
            <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div className="control">
            <label>结束日期</label>
            <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          <div className="control" style={{marginLeft:8}}>
            <label>自定义画区</label>
            <div className="stack">
              <button className="button" onClick={()=>{ setDrawCommand('start'); setDrawing(true); }}>开始</button>
              <button className="button" onClick={()=>{ setDrawCommand('finish'); setDrawing(false); }} disabled={!drawing}>完成</button>
              <button className="button ghost" onClick={()=>{ setDrawCommand('clear'); setDrawing(false); }} disabled={false}>清空</button>
            </div>
          </div>
          {drawing && <span style={{color:'var(--danger)'}}>绘制中：在地图上单击添加顶点，双击结束。</span>}
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3>地图：商家-顾客路径 + 自定义画区</h3>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <button className="button" onClick={handleLocate} disabled={locating}>
              {locating ? '定位中...' : '定位到我的位置'}
            </button>
            {geoError && <span style={{color:'var(--danger)'}}>{geoError}</span>}
          </div>
        </div>
        <div style={{height:400}}>
          <AMapView
            orders={filtered}
            userLocation={userLocation}
            zoom={mapZoom}
            drawCommand={drawCommand}
            onCustomAreasChange={(areas)=>{ setCustomAreas(areas); }}
          />
        </div>
      </div>

      {/* 自定义范围分析 */}
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header">
          <h3 className="card-title">自定义范围分析</h3>
          <span className="muted">当前自定义区域数量：{customAreas.length}</span>
        </div>
        {customAreas.length === 0 ? (
          <div className="muted">提示：点击“开始”，在地图上画多边形；完成后点击“完成”。可画多个区域，点击“清空”移除。</div>
        ) : (
          <div className="grid" style={{gridTemplateColumns:'repeat(12, 1fr)', gap:16}}>
            {(() => {
              const mergedPolys = customAreas.flatMap(a => a.polygons);
              const ordersInRange = filtered.filter(o => orderInPolygons(o, mergedPolys));
              const orderIds = new Set(ordersInRange.map(o => o.orderId));
              const settleInRange = settlements.filter(s => orderIds.has(s.orderId));
              const income = incomeBreakdown(settleInRange);
              const riderInc = riderTotals(settleInRange).slice(0, topRegions);
              return (
                <>
                  <div className="card" style={{gridColumn:'span 6'}}>
                    <h3 className="card-title">该范围订单总数</h3>
                    <div className="kpi">
                      <div>
                        <div className="big">{ordersInRange.length}</div>
                        <div className="muted">订单数</div>
                      </div>
                    </div>
                  </div>
                  <div className="card" style={{gridColumn:'span 6'}}>
                    <h3 className="card-title">该范围收入总额（元）</h3>
                    <div className="kpi">
                      <div>
                        <div className="big">{income.total.toFixed(2)}</div>
                        <div className="muted">合计（含补贴/奖励/小费-罚金）</div>
                      </div>
                    </div>
                  </div>
                  <div className="card" style={{gridColumn:'span 12'}}>
                    <h3 className="card-title">骑手收入 Top {topRegions}</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={riderInc.map(r=>({ riderId: r.riderId, amount: r.amount }))} margin={{ top: 16, right: 16, left: 16, bottom: 32 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                        <XAxis dataKey="riderId" tick={{ fill:'#e5e7eb' }} interval={0} angle={-20} height={60} />
                        <YAxis tick={{ fill:'#e5e7eb' }} />
                        <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                        <Bar dataKey="amount" fill="#f59e0b" radius={[6,6,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

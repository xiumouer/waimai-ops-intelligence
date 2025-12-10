import React, { useEffect, useMemo, useState } from 'react';
import { loadOrders } from '../services/data';
import type { Order } from '../types';
import { kpi, aggregateStageAverages, deliveryDuration, siteOrderCounts, riderEfficiencyRanking, regionOrderCounts } from '../utils/metrics';
import { toCSV, downloadCSV } from '../utils/export';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import AMapView from '../shared/components/AMapView';
import { getPreciseLocation } from '../utils/amap';

// 使用高德地图替换 Leaflet

export default function Efficiency() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderFilter, setRiderFilter] = useState<string>('全部');
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [siteFilter, setSiteFilter] = useState<string>('全部');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [topRegions] = useState<number>(10);
  const [showMore, setShowMore] = useState<boolean>(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(12);

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

  const riders = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.riderId)))], [orders]);
  const statuses = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.status)))], [orders]);
  const sites = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.site)))], [orders]);
  const filtered = useMemo(() => orders.filter(o => {
    const okRider = (riderFilter === '全部' || o.rider.riderId === riderFilter);
    const okStatus = (statusFilter === '全部' || o.status === statusFilter);
    const okSite = (siteFilter === '全部' || o.rider.site === siteFilter);
    const created = new Date(o.createdAt).getTime();
    const okStart = startDate ? created >= new Date(startDate).getTime() : true;
    const okEnd = endDate ? created <= new Date(endDate).getTime() + 24*60*60*1000 - 1 : true;
    return okRider && okStatus && okSite && okStart && okEnd;
  }), [orders, riderFilter, statusFilter, siteFilter, startDate, endDate]);

  const metrics = useMemo(() => kpi(filtered), [filtered]);
  const stageAvg = useMemo(() => aggregateStageAverages(filtered), [filtered]);
  const timeDist = useMemo(() => {
    const durations = filtered.map(deliveryDuration).filter((v): v is number => v != null);
    const buckets: Record<string, number> = {};
    durations.forEach(m => {
      const key = `${Math.floor(m/5)*5}-${Math.floor(m/5)*5+4}`;
      buckets[key] = (buckets[key]||0)+1;
    });
    return Object.entries(buckets).map(([range, count])=>({ range, count }));
  }, [filtered]);

  const statusDist = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(o => map.set(o.status, (map.get(o.status) || 0) + 1));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const riderRank = useMemo(() => riderEfficiencyRanking(filtered), [filtered]);
  const regionCounts = useMemo(() => regionOrderCounts(filtered), [filtered]);

  const riskTable = useMemo(() => {
    const now = Date.now();
    return filtered.filter(o => o.status !== '已完成' && o.status !== '已取消').map(o => {
      const picked = o.timeline.pickedAt ? new Date(o.timeline.pickedAt).getTime() : new Date(o.timeline.acceptedAt || o.timeline.dispatchAt || o.createdAt).getTime();
      const eta = new Date(o.eta).getTime();
      const elapsed = Math.max(0, Math.round((now - picked) / 60000));
      const window = Math.max(1, Math.round((eta - picked) / 60000));
      const ratio = elapsed / window;
      let level: '低' | '中' | '高' = '低';
      if (Date.now() > eta) level = '高';
      else if (ratio > 0.8) level = '中';
      return { orderId: o.orderId, riderId: o.rider.riderId, site: o.rider.site, level, progress: Math.min(100, Math.round(ratio * 100)) };
    }).sort((a,b) => (a.level === '高' ? -1 : a.level === '中' && b.level === '低' ? -1 : 1));
  }, [filtered]);

  // 中心与缩放交由 AMapView 处理

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
            <label>骑手</label>
            <select className="select" value={riderFilter} onChange={e=>setRiderFilter(e.target.value)}>
              {riders.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="control">
            <label>状态</label>
            <select className="select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
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
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="kpi">
          <div className="item"><div>订单总数</div><div className="value">{metrics.total}</div></div>
          <div className="item"><div>完成订单</div><div className="value">{metrics.completed}</div></div>
          <div className="item"><div>取消率</div><div className="value">{metrics.cancelRate}%</div></div>
          <div className="item"><div>准时率</div><div className="value">{metrics.onTimeRate}%</div></div>
        </div>
      </div>


      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>环节平均耗时（分钟）</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={stageAvg}>
            <defs>
              <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={1}/>
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.85}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="stage" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="minutes" fill="url(#gradBlue)" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>配送时长分布（5分钟桶）</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={timeDist}>
            <defs>
              <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.9}/>
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.2}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="range" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Area type="monotone" dataKey="count" fill="url(#gradGreen)" stroke="#34d399" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3>更多图表</h3>
          <button className="button" onClick={()=>setShowMore(v=>!v)}>{showMore ? '隐藏' : '显示'}</button>
        </div>
        {showMore && (
          <div className="grid" style={{gridTemplateColumns:'repeat(12, 1fr)', gap:16}}>
            <div className="card" style={{gridColumn:'span 6'}}>
              <h3>订单状态分布</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {statusDist.map((entry, index) => (
                      <Cell key={`c-${index}`} fill={["#22d3ee","#34d399","#60a5fa","#f59e0b","#ef4444","#a78bfa"][index % 6]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{gridColumn:'span 6'}}>
              <h3>站点订单数量</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={siteOrderCounts(filtered)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="site" tick={{ fill:'#e5e7eb' }} />
                  <YAxis tick={{ fill:'#e5e7eb' }} />
                  <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                  <Bar dataKey="count" fill="#a78bfa" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{gridColumn:'span 12'}}>
              <h3>地区单量统计（Top 10）</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={regionCounts.slice(0, topRegions)}>
                  <defs>
                    <linearGradient id="gradRegion" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" stopOpacity={1}/>
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.85}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="region" tick={{ fill:'#e5e7eb' }} interval={0} angle={-20} height={60} />
                  <YAxis tick={{ fill:'#e5e7eb' }} />
                  <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                  <Bar dataKey="count" fill="url(#gradRegion)" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3>骑手完成订单排名</h3>
          <button onClick={()=>{
            const rows = riderRank.map(r=>({
              riderId: r.riderId,
              name: r.name,
              site: r.site,
              total: r.total,
              completed: r.completed,
              avgDeliveryMinutes: r.avgDeliveryMinutes,
              onTimeRate: +(r.onTimeRate*100).toFixed(2),
              cancelRate: +(r.cancelRate*100).toFixed(2),
            }));
            const csv = toCSV(rows);
            downloadCSV(csv, 'rider_efficiency_ranking.csv');
          }}>导出CSV</button>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={riderRank.map(r=>({ name: r.name || r.riderId, completed: r.completed }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" interval={0} angle={-15} height={60} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="completed" fill="#60a5fa" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>骑手效率排名（表格）</h3>
        <div style={{maxHeight:280, overflow:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr>
                <th>骑手</th><th>站点</th><th>完成单数</th><th>平均配送时长</th><th>准时率</th><th>取消率</th>
              </tr>
            </thead>
            <tbody>
              {riderRank.map(r => (
                <tr key={r.riderId}>
                  <td>{r.name || r.riderId}</td>
                  <td>{r.site}</td>
                  <td>{r.completed}</td>
                  <td>{r.avgDeliveryMinutes} 分钟</td>
                  <td>{(r.onTimeRate*100).toFixed(1)}%</td>
                  <td>{(r.cancelRate*100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3>地图：商家-顾客路径</h3>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <button onClick={handleLocate} disabled={locating}>
              {locating ? '定位中...' : '定位到我的位置'}
            </button>
            {geoError && <span style={{color:'#ef4444'}}>{geoError}</span>}
          </div>
        </div>
        <div style={{height:400}}>
          <AMapView orders={filtered} userLocation={userLocation} zoom={mapZoom} />
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3>风险订单（基于 ETA 窗口）</h3>
        <table style={{width:'100%', borderCollapse:'collapse'}}>
          <thead>
            <tr>
              <th>订单ID</th><th>骑手ID</th><th>站点</th><th>风险等级</th><th>进度%</th>
            </tr>
          </thead>
          <tbody>
            {riskTable.map(r => (
              <tr key={r.orderId}>
                <td>{r.orderId}</td>
                <td>{r.riderId}</td>
                <td>{r.site}</td>
                <td style={{color: r.level==='高'?'#ef4444': r.level==='中'? '#f59e0b':'#34d399'}}>{r.level}</td>
                <td>{r.progress}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

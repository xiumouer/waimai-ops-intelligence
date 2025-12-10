import React, { useEffect, useMemo, useState } from 'react';
import { loadOrders } from '../services/data';
import type { Order } from '../types';
import { aggregateStageAverages, deliveryDuration } from '../utils/metrics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';

export default function OrdersAnalysis() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderFilter, setRiderFilter] = useState<string>('全部');
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [showMore, setShowMore] = useState<boolean>(false);

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

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const data = await loadOrders();
      setOrders(data);
    } catch (e) {
      setError('订单数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  const riders = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.riderId)))], [orders]);
  const statuses = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.status)))], [orders]);

  const filtered = useMemo(() => orders.filter(o => {
    const okRider = (riderFilter === '全部' || o.rider.riderId === riderFilter);
    const okStatus = (statusFilter === '全部' || o.status === statusFilter);
    const created = new Date(o.createdAt).getTime();
    const okStart = startDate ? created >= new Date(startDate).getTime() : true;
    const okEnd = endDate ? created <= new Date(endDate).getTime() + 24*60*60*1000 - 1 : true;
    return okRider && okStatus && okStart && okEnd;
  }), [orders, riderFilter, statusFilter, startDate, endDate]);

  const stageAvg = useMemo(() => aggregateStageAverages(filtered), [filtered]);
  const stageAvgCn = useMemo(() => {
    const cn: Record<string, string> = {
      dispatch: '下单→派单',
      accept: '派单→接单',
      arriveStore: '接单→到店',
      pickup: '到店→取餐',
      delivery: '取餐→送达',
    };
    return stageAvg.map(s => ({ ...s, stage: cn[s.stage] || s.stage }));
  }, [stageAvg]);
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
            <label>开始日期</label>
            <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div className="control">
            <label>结束日期</label>
            <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
          <button className="button" onClick={handleRefresh} disabled={loading}>刷新数据</button>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>环节平均耗时（分钟）</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={stageAvgCn}>
            <defs>
              <linearGradient id="gradBlueOA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={1}/>
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.85}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="stage" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="minutes" fill="url(#gradBlueOA)" radius={[6,6,0,0]} isAnimationActive animationDuration={700} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>配送时长分布（5分钟桶）</h3>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={timeDist}>
            <defs>
              <linearGradient id="gradGreenOA" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.9}/>
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.2}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="range" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Area type="monotone" dataKey="count" fill="url(#gradGreenOA)" stroke="#34d399" isAnimationActive animationDuration={800} animationEasing="ease-out" />
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
            <div className="card" style={{gridColumn:'span 12'}}>
              <h3>订单状态分布</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label isAnimationActive animationDuration={700} animationEasing="ease-out">
                    {statusDist.map((entry, index) => (
                      <Cell key={`c-${index}`} fill={["#22d3ee","#34d399","#60a5fa","#f59e0b","#ef4444","#a78bfa"][index % 6]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { loadOrders } from '../services/data';
import type { Order } from '../types';

type RiskItem = { id: string; rider: string; site: string; status: string; delay: number };

// 根据 ETA 与实际送达/当前时间计算超时分钟数（未超时返回 0）
function computeDelayMinutes(o: Order): number {
  const etaMs = o.eta ? new Date(o.eta).getTime() : null;
  if (!etaMs) return 0;
  const baseMs = o.deliveredAt ? new Date(o.deliveredAt).getTime() : Date.now();
  const diff = Math.round((baseMs - etaMs) / 60000);
  return diff > 0 ? diff : 0;
}

// 风险判定：已取消 或 超时>15 分钟 或 未完成且已过 ETA
function isRisk(o: Order): boolean {
  const delay = computeDelayMinutes(o);
  const cancelled = o.status === '已取消' || o.status === 'CANCELLED';
  const notCompleted = o.status !== '已完成' && o.status !== 'COMPLETED';
  return cancelled || delay >= 10 || (notCompleted && !!o.eta && Date.now() > new Date(o.eta).getTime());
}

export default function Risk() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderFilter, setRiderFilter] = useState<string>('全部');
  const [limit, setLimit] = useState<number>(100);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await loadOrders();
        setOrders(data);
        if (data.length) {
          const toDay = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth()+1).padStart(2,'0');
            const day = String(d.getDate()).padStart(2,'0');
            return `${y}-${m}-${day}`;
          };
          const days = data.map(o => toDay(new Date(o.createdAt)));
          const min = days.reduce((a,b)=>a<b?a:b);
          const max = days.reduce((a,b)=>a>b?a:b);
          setStartDate(min);
          setEndDate(max);
        }
      } catch (e) {
        setError('数据加载失败');
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
      setError('数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  const riders = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.riderId)))], [orders]);

  const risks: RiskItem[] = useMemo(() => {
    const filteredByRider = orders.filter(o => riderFilter === '全部' ? true : o.rider.riderId === riderFilter);
    const toDay = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    };
    const filteredByDate = filteredByRider.filter(o => {
      const day = toDay(new Date(o.createdAt));
      return (startDate ? day >= startDate : true) && (endDate ? day <= endDate : true);
    });
    const rows = filteredByDate
      .filter(isRisk)
      .map(o => ({
        id: o.orderId,
        rider: o.rider.name || o.rider.riderId,
        site: o.rider.site,
        status: o.status,
        delay: computeDelayMinutes(o)
      }))
      .sort((a,b) => b.delay - a.delay);
    return rows.slice(0, Math.max(1, limit));
  }, [orders, riderFilter, startDate, endDate, limit]);

  return (
    <div className="grid">
      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'flex', gap:12, alignItems:'center'}}>
          <div>
            <label>骑手ID：</label>
            <select value={riderFilter} onChange={e=>setRiderFilter(e.target.value)}>
              {riders.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label>显示条数：</label>
            <input type="number" min={10} max={500} value={limit} onChange={e=>setLimit(Number(e.target.value)||100)} style={{width:100}} />
          </div>
          <div>
            <label>开始日期：</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div>
            <label>结束日期：</label>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          {loading && <span style={{color:'#9ca3af'}}>加载中...</span>}
          {error && <span style={{color:'#ef4444'}}>{error}</span>}
          <button className="button" onClick={handleRefresh} disabled={loading}>刷新数据</button>
          <button className="button ghost" onClick={() => {
            if (!orders.length) return;
            const toDay = (d: Date) => {
              const y = d.getFullYear();
              const m = String(d.getMonth()+1).padStart(2,'0');
              const day = String(d.getDate()).padStart(2,'0');
              return `${y}-${m}-${day}`;
            };
            const days = orders.map(o => toDay(new Date(o.createdAt)));
            setStartDate(days.reduce((a,b)=>a<b?a:b));
            setEndDate(days.reduce((a,b)=>a>b?a:b));
          }}>重置日期为数据范围</button>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3>风险订单列表</h3>
        <div style={{overflowX:'auto'}}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #1f2937' }}>订单ID</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #1f2937' }}>骑手</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #1f2937' }}>站点</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #1f2937' }}>状态</th>
                <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #1f2937' }}>超时(分钟)</th>
              </tr>
            </thead>
            <tbody>
              {risks.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: '12px', color: '#9ca3af' }}>暂无风险订单</td>
                </tr>
              )}
              {risks.map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #111827' }}>{r.id}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #111827' }}>{r.rider}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #111827' }}>{r.site}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #111827', color: (r.status === '已取消' || r.status === 'CANCELLED') ? '#ef4444' : (r.delay > 0 ? '#f59e0b' : '#e5e7eb') }}>{r.status}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #111827', textAlign: 'right', color: r.delay > 30 ? '#ef4444' : r.delay > 15 ? '#f59e0b' : '#e5e7eb' }}>{Math.min(r.delay, 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

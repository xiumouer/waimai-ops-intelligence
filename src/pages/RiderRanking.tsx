import React, { useEffect, useMemo, useState } from 'react';
import { loadOrders } from '../services/data';
import type { Order } from '../types';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { riderRewards, deliveryDuration } from '../utils/metrics';
import { toCSV, downloadCSV } from '../utils/export';
import { loadContacts, saveContact, loadAttendance, saveAttendance, attendanceSummary, today } from '../services/riders';

type RiderStat = { rider: string; site: string; orders: number; avgTime: number };

export default function RiderRanking() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siteFilter, setSiteFilter] = useState<string>('全部');
  const [limit, setLimit] = useState<number>(10);
  const [showRewards, setShowRewards] = useState<boolean>(false);
  const [attendanceDate, setAttendanceDate] = useState<string>(today());
  const [contacts, setContacts] = useState<Record<string, { phone?: string; address?: string; emergency?: string }>>(() => loadContacts());
  const [attendance, setAttendance] = useState<Record<string, { status: '出勤'|'请假'; note?: string }>>(() => loadAttendance(today()));

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await loadOrders();
        setOrders(data);
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

  const sites = useMemo(() => ['全部', ...Array.from(new Set(orders.map(o => o.rider.site)))], [orders]);

  const stats: RiderStat[] = useMemo(() => {
    const filtered = orders.filter(o => siteFilter === '全部' ? true : o.rider.site === siteFilter);
    const grouped: Record<string, RiderStat & { _sum: number; _n: number }> = {};
    for (const o of filtered) {
      const key = o.rider.riderId;
      if (!grouped[key]) grouped[key] = { rider: o.rider.name || key, site: o.rider.site, orders: 0, avgTime: 0, _sum: 0, _n: 0 };
      grouped[key].orders += 1;
      const minutes = deliveryDuration(o);
      if (minutes != null) { grouped[key]._sum += minutes; grouped[key]._n += 1; }
    }
    Object.keys(grouped).forEach(k => {
      const g = grouped[k];
      g.avgTime = g._n ? +(g._sum / g._n).toFixed(1) : 0;
    });
    return Object.values(grouped)
      .sort((a,b) => b.orders - a.orders)
      .slice(0, limit);
  }, [orders, siteFilter, limit]);

  const rewards = useMemo(() => {
    const filtered = orders.filter(o => siteFilter === '全部' ? true : o.rider.site === siteFilter);
    return riderRewards(filtered).slice(0, limit);
  }, [orders, siteFilter, limit]);

  const riderList = useMemo(() => {
    const filtered = orders.filter(o => siteFilter === '全部' ? true : o.rider.site === siteFilter);
    const map = new Map<string, { riderId: string; name: string; site: string }>();
    filtered.forEach(o => {
      map.set(o.rider.riderId, { riderId: o.rider.riderId, name: o.rider.name, site: o.rider.site });
    });
    return Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name));
  }, [orders, siteFilter]);

  useEffect(() => {
    setContacts(loadContacts());
  }, []);

  useEffect(() => {
    setAttendance(loadAttendance(attendanceDate));
  }, [attendanceDate]);

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
            <label>Top N</label>
            <input className="input" type="number" min={5} max={20} value={limit} onChange={e=>setLimit(Number(e.target.value)||10)} />
          </div>
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
          <button className="button" onClick={handleRefresh} disabled={loading}>刷新数据</button>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header">
          <h3 className="card-title">骑手订单量排行</h3>
          <button className="button primary" onClick={()=>{
            const csv = toCSV(stats.map(s=>({ rider: s.rider, site: s.site, orders: s.orders, avgTime: s.avgTime })));
            downloadCSV(csv, 'rider_ranking.csv');
          }}>导出CSV</button>
        </div>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={stats} margin={{ top: 16, right: 16, left: 16, bottom: 32 }}>
            <defs>
              <linearGradient id="gradRROrders" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="rider" tick={{ fill:'#e5e7eb' }} interval={0} angle={-20} height={60} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="orders" fill="url(#gradRROrders)" radius={[6,6,0,0]} isAnimationActive animationDuration={700} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3 className="card-title">骑手平均配送时长（分钟）</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={stats} margin={{ top: 16, right: 16, left: 16, bottom: 32 }}>
            <defs>
              <linearGradient id="gradRRAvg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="rider" tick={{ fill:'#e5e7eb' }} interval={0} angle={-20} height={60} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="avgTime" fill="url(#gradRRAvg)" radius={[6,6,0,0]} isAnimationActive animationDuration={700} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3 className="card-title">骑手效率排行（表格）</h3>
        <div style={{maxHeight:280, overflow:'auto'}}>
          <table className="table">
            <colgroup>
              <col style={{width:'40%'}} />
              <col style={{width:'30%'}} />
              <col style={{width:'30%'}} />
            </colgroup>
            <thead>
              <tr>
                <th>骑手</th><th className="num">订单数</th><th className="num">平均配送时长</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.rider}>
                  <td>{s.rider}</td>
                  <td className="num">{s.orders}</td>
                  <td className="num">{s.avgTime} 分钟</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header" style={{justifyContent:'space-between'}}>
          <h3 className="card-title">骑手奖励机制（试行）</h3>
          <div className="stack" style={{display:'flex', gap:8}}>
            <button className="button" onClick={()=>setShowRewards(v=>!v)}>{showRewards ? '隐藏' : '显示'}</button>
            <button className="button warn" onClick={()=>{
              const rows = rewards.map(r=>({
                riderId: r.riderId,
                name: r.name,
                site: r.site,
                completed: r.completed,
                onTimeRate: +(r.onTimeRate*100).toFixed(2),
                avgDeliveryMinutes: r.avgDeliveryMinutes,
                cancelRate: +(r.cancelRate*100).toFixed(2),
                points: r.points,
                reward: r.reward,
              }));
              const csv = toCSV(rows);
              downloadCSV(csv, 'rider_rewards.csv');
            }}>导出奖励CSV</button>
          </div>
        </div>
        {showRewards && (
          <div className="grid" style={{gridTemplateColumns:'repeat(12, 1fr)', gap:16}}>
            <div style={{gridColumn:'span 6'}}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={rewards.map(r=>({ name: r.name || r.riderId, reward: r.reward }))} margin={{ top: 16, right: 16, left: 16, bottom: 32 }}>
                  <defs>
                    <linearGradient id="gradRRRewards" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="name" tick={{ fill:'#e5e7eb' }} interval={0} angle={-20} height={60} />
                  <YAxis tick={{ fill:'#e5e7eb' }} />
                  <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
                  <Bar dataKey="reward" fill="url(#gradRRRewards)" radius={[6,6,0,0]} isAnimationActive animationDuration={700} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{gridColumn:'span 6'}}>
              <div style={{maxHeight:320, overflow:'auto'}}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>骑手</th><th>站点</th><th>完成单数</th><th>准时率</th><th>平均时长</th><th>取消率</th><th>积分</th><th>奖励(¥)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rewards.map(r => (
                      <tr key={r.riderId}>
                        <td>{r.name || r.riderId}</td>
                        <td>{r.site}</td>
                        <td className="num">{r.completed}</td>
                        <td className="num">{(r.onTimeRate*100).toFixed(1)}%</td>
                        <td className="num">{r.avgDeliveryMinutes} 分钟</td>
                        <td className="num">{(r.cancelRate*100).toFixed(1)}%</td>
                        <td className="num">{r.points}</td>
                        <td className="num">¥{r.reward.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header" style={{justifyContent:'space-between'}}>
          <h3 className="card-title">骑手联系与出勤管理</h3>
          <div style={{display:'flex', gap:12, alignItems:'center'}}>
            <div className="control">
              <label>出勤日期</label>
              <input className="input" type="date" value={attendanceDate} onChange={e=>setAttendanceDate(e.target.value)} />
            </div>
            <div className="muted">
              今日摘要：
              {(() => {
                const ids = riderList.map(r=>r.riderId);
                const sum = attendanceSummary(attendanceDate, ids);
                return <span>出勤 {sum.present} 人， 请假 {sum.leave} 人</span>;
              })()}
            </div>
          </div>
        </div>
        <div style={{maxHeight:360, overflow:'auto'}}>
          <table className="table">
            <thead>
              <tr>
                <th>骑手</th>
                <th>站点</th>
                <th>电话</th>
                <th>家庭住址</th>
                <th>紧急联系人</th>
                <th>今日出勤</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {riderList.map(r => {
                const c = contacts[r.riderId] || {};
                const a = attendance[r.riderId];
                const status = a?.status || '出勤';
                const note = a?.note || '';
                return (
                  <tr key={r.riderId}>
                    <td>{r.name || r.riderId}</td>
                    <td>{r.site}</td>
                    <td>
                      <input className="input" placeholder="手机号" value={c.phone || ''} onChange={e=>{
                        const v = e.target.value;
                        setContacts(prev => ({ ...prev, [r.riderId]: { ...prev[r.riderId], phone: v } }));
                        saveContact(r.riderId, { phone: v });
                      }} />
                    </td>
                    <td>
                      <input className="input" placeholder="家庭住址" value={c.address || ''} onChange={e=>{
                        const v = e.target.value;
                        setContacts(prev => ({ ...prev, [r.riderId]: { ...prev[r.riderId], address: v } }));
                        saveContact(r.riderId, { address: v });
                      }} />
                    </td>
                    <td>
                      <input className="input" placeholder="紧急联系人" value={c.emergency || ''} onChange={e=>{
                        const v = e.target.value;
                        setContacts(prev => ({ ...prev, [r.riderId]: { ...prev[r.riderId], emergency: v } }));
                        saveContact(r.riderId, { emergency: v });
                      }} />
                    </td>
                    <td>
                      <select className="select" value={status} onChange={e=>{
                        const v = e.target.value as '出勤'|'请假';
                        const rec = { status: v, note };
                        setAttendance(prev => ({ ...prev, [r.riderId]: rec }));
                        saveAttendance(attendanceDate, r.riderId, rec);
                      }}>
                        <option value="出勤">出勤</option>
                        <option value="请假">请假</option>
                      </select>
                    </td>
                    <td>
                      <input className="input" placeholder="备注（如请假原因）" value={note} onChange={e=>{
                        const v = e.target.value;
                        const rec = { status, note: v };
                        setAttendance(prev => ({ ...prev, [r.riderId]: rec }));
                        saveAttendance(attendanceDate, r.riderId, rec);
                      }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

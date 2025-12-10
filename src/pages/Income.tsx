import React, { useEffect, useMemo, useState } from 'react';
import { loadSettlements } from '../services/data';
import type { SettlementItem } from '../types';
import { incomeBreakdown, riderTotals, dailyIncome } from '../utils/metrics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LineChart, Line } from 'recharts';
import { toCSV, downloadCSV } from '../utils/export';

export default function Income() {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [riderFilter, setRiderFilter] = useState<string>('全部');
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [showDetails, setShowDetails] = useState<boolean>(false);
  useEffect(() => { (async()=>{
    try { setLoading(true); const data = await loadSettlements(); setItems(data); }
    catch(e){ setError('结算数据加载失败'); }
    finally { setLoading(false); }
  })(); }, []);

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const data = await loadSettlements();
      setItems(data);
    } catch (e) {
      setError('结算数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  const riders = useMemo(() => ['全部', ...Array.from(new Set(items.map(i=>i.riderId)))], [items]);
  const statuses = useMemo(() => ['全部', ...Array.from(new Set(items.map(i=>i.settlement.status)))], [items]);
  const filtered = useMemo(() => items.filter(i => {
    const okRider = (riderFilter === '全部' || i.riderId === riderFilter);
    const okStatus = (statusFilter === '全部' || i.settlement.status === statusFilter);
    const d = new Date(i.settlement.date).getTime();
    const okStart = startDate ? d >= new Date(startDate).getTime() : true;
    const okEnd = endDate ? d <= new Date(endDate).getTime() + 24*60*60*1000 - 1 : true;
    return okRider && okStatus && okStart && okEnd;
  }), [items, riderFilter, statusFilter, startDate, endDate]);
  const breakdown = useMemo(() => incomeBreakdown(filtered), [filtered]);
  const riderTotal = useMemo(() => riderTotals(filtered), [filtered]);
  const breakdownData = useMemo(() => [
    { name: '基础费', value: breakdown.baseFee },
    { name: '距离补贴', value: breakdown.distance },
    { name: '重量补贴', value: breakdown.weight },
    { name: '时段补贴', value: breakdown.period },
    { name: '平台奖励', value: breakdown.reward },
    { name: '打赏', value: breakdown.tip },
    { name: '罚款合计', value: breakdown.penalties }
  ], [breakdown]);

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
            <label>开始</label>
            <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div className="control">
            <label>结束</label>
            <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          <button className="button primary" onClick={() => {
            const rows = filtered.map(s => {
              const penalty = s.penalties.timeout + s.penalties.complaint + s.penalties.cancel;
              const total = s.baseFee + s.distanceSubsidy + s.weightSubsidy + s.periodSubsidy + s.platformReward + s.tip - penalty;
              return {
                orderId: s.orderId,
                riderId: s.riderId,
                baseFee: s.baseFee,
                distanceSubsidy: s.distanceSubsidy,
                weightSubsidy: s.weightSubsidy,
                periodSubsidy: s.periodSubsidy,
                platformReward: s.platformReward,
                tip: s.tip,
                penalty,
                total: total.toFixed(2),
                settlementDate: s.settlement.date,
                settlementStatus: s.settlement.status
              };
            });
            const csv = toCSV(rows);
            downloadCSV('settlements.csv', csv);
          }}>导出明细</button>
          <button className="button" onClick={handleRefresh} disabled={loading}>刷新数据</button>
          <button className="button" onClick={()=>setShowDetails(v=>!v)}>{showDetails ? '隐藏明细' : '显示明细'}</button>
          {loading && <span className="muted">加载中...</span>}
          {error && <span style={{color:'var(--danger)'}}>{error}</span>}
        </div>
      </div>
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="kpi">
          <div className="item"><div>总收入（净额）</div><div className="value">¥{breakdown.total.toFixed(2)}</div></div>
          <div className="item"><div>订单数</div><div className="value">{items.length}</div></div>
          <div className="item"><div>罚款合计</div><div className="value">¥{breakdown.penalties.toFixed(2)}</div></div>
          <div className="item"><div>打赏合计</div><div className="value">¥{breakdown.tip.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>收入构成</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={breakdownData}>
            <defs>
              <linearGradient id="gradIncomeBreakdown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="name" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="value" fill="url(#gradIncomeBreakdown)" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 6'}}>
        <h3>骑手净收入排行</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={riderTotal}>
            <defs>
              <linearGradient id="gradIncomeRider" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="riderId" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Bar dataKey="amount" fill="url(#gradIncomeRider)" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <h3>每日收入趋势</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={dailyIncome(filtered)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fill:'#e5e7eb' }} />
            <YAxis tick={{ fill:'#e5e7eb' }} />
            <Tooltip contentStyle={{ background:'#0b1220', border:'1px solid #1f2937', color:'#e5e7eb' }} />
            <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {showDetails && (
        <div className="card" style={{gridColumn:'span 12'}}>
          <div className="card-header">
            <h3>明细表</h3>
          </div>
          <div style={{maxHeight:360, overflow:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th>订单ID</th><th>骑手ID</th><th>基础费</th><th>距离</th><th>重量</th><th>时段</th><th>奖励</th><th>打赏</th><th>罚款</th><th>结算金额</th><th>发放状态</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const penalty = s.penalties.timeout + s.penalties.complaint + s.penalties.cancel;
                  const total = s.baseFee + s.distanceSubsidy + s.weightSubsidy + s.periodSubsidy + s.platformReward + s.tip - penalty;
                  return (
                    <tr key={s.orderId}>
                      <td>{s.orderId}</td>
                      <td>{s.riderId}</td>
                      <td>{s.baseFee}</td>
                      <td>{s.distanceSubsidy}</td>
                      <td>{s.weightSubsidy}</td>
                      <td>{s.periodSubsidy}</td>
                      <td>{s.platformReward}</td>
                      <td>{s.tip}</td>
                      <td>{penalty}</td>
                      <td>{total.toFixed(2)}</td>
                      <td>{s.settlement.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

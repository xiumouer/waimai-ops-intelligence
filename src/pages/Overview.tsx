import React, { useEffect, useMemo, useState, useRef } from 'react';
import { loadOrders } from '../services/data';
import type { Order } from '../types';
import { kpi } from '../utils/metrics';
import { attendanceSummary, today } from '../services/riders';
import { fetchAMapWeatherByPoint } from '../utils/amap';
import type { AMapWeather } from '../utils/amap';

export default function Overview() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [weather, setWeather] = useState<AMapWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

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

  const filtered = useMemo(() => orders.filter(o => {
    const created = new Date(o.createdAt).getTime();
    const okStart = startDate ? created >= new Date(startDate).getTime() : true;
    const okEnd = endDate ? created <= new Date(endDate).getTime() + 24*60*60*1000 - 1 : true;
    return okStart && okEnd;
  }), [orders, startDate, endDate]);

  const metrics = useMemo(() => kpi(filtered), [filtered]);

  const getAreaCenter = () => {
    if (filtered.length) {
      let sumLat = 0, sumLng = 0, n = 0;
      for (const o of filtered) {
        const midLat = (o.merchant.lat + o.customer.lat) / 2;
        const midLng = (o.merchant.lng + o.customer.lng) / 2;
        sumLat += midLat; sumLng += midLng; n += 1;
      }
      return { lat: sumLat / n, lng: sumLng / n };
    }
    return { lat: 31.2304, lng: 121.4737 };
  };

  const fetchWeather = async () => {
    const loc = getAreaCenter();
    setWeatherError(null);
    try {
      setWeatherLoading(true);
      const w = await fetchAMapWeatherByPoint(loc);
      if (!w) throw new Error('AMapError');
      setWeather(w);
    } catch (e: any) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('天气服务不可用');
        const data = await res.json();
        const cur = data?.current || null;
        if (!cur) throw new Error('天气获取失败');
        const wind = Number(cur?.wind_speed_10m ?? 0);
        const toLevel = (v: number) => v >= 10.8 ? 6 : v >= 8 ? 5 : v >= 5.5 ? 4 : v >= 3.4 ? 3 : v >= 1.6 ? 2 : v >= 0.3 ? 1 : 0;
        setWeather({
          temperature: cur?.temperature_2m ?? null,
          humidity: cur?.relative_humidity_2m ?? null,
          weather: (cur?.precipitation ?? 0) > 0 ? '降水' : null,
          windLevel: toLevel(wind),
          city: null
        });
        setWeatherError('高德天气不可用，已使用备用源');
      } catch (err2: any) {
        setWeatherError(e?.message || err2?.message || '天气获取失败');
      }
    } finally {
      setWeatherLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, orders]);

  const careTips = useMemo(() => {
    const tips: string[] = [];
    const t = weather?.temperature ?? undefined;
    const wl = weather?.windLevel ?? undefined;
    const desc = weather?.weather ?? undefined;
    if (t !== undefined) {
      if (t <= 10) tips.push('气温较低：请穿保暖外套与防风手套');
      else if (t <= 20) tips.push('气温偏凉：建议长袖外套，注意保暖');
      else if (t >= 30) tips.push('气温较高：加强补水，适当降速与避晒');
    }
    if (desc && /雨|雪/.test(desc)) tips.push('有降水：佩戴雨具、防水外套，减速防滑');
    if (wl !== undefined) {
      if (wl >= 6) tips.push('风力较大：过桥口减速，注意横风影响');
      else if (wl >= 4) tips.push('有风：适当降速，转弯提前减速');
    }
    if (tips.length === 0) tips.push('天气良好：保持注意力与安全间距，文明行车');
    return tips;
  }, [weather]);

  // 数值渐变动画（ease-out）
  function useCountUp(target: number, decimals = 0, duration = 800) {
    const [val, setVal] = useState(0);
    const fromRef = useRef(0);
    useEffect(() => {
      const from = fromRef.current;
      let raf = 0;
      const start = performance.now();
      const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = easeOutCubic(p);
        const v = from + (target - from) * eased;
        setVal(Number(v.toFixed(decimals)));
        if (p < 1) { raf = requestAnimationFrame(tick); } else { fromRef.current = target; }
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [target, decimals, duration]);
    return val;
  }

  const totalUp = useCountUp(metrics.total, 0);
  const completedUp = useCountUp(metrics.completed, 0);
  const cancelRateUp = useCountUp(metrics.cancelRate, 1);
  const onTimeRateUp = useCountUp(metrics.onTimeRate, 1);
  const avgTimeUp = useCountUp(metrics.avgDeliveryMinutes, 1);

  // 当前时间显示
  const [now, setNow] = useState<string>(() => new Date().toLocaleString('zh-CN', { hour12: false }));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleString('zh-CN', { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  // 主题与轨迹节奏
  const [theme, setTheme] = useState<'purpleGold'|'blueGreen'>('blueGreen');
  const [rhythm, setRhythm] = useState<'calm'|'balanced'|'dynamic'>('balanced');

  const ringConfig = useMemo(() => {
    if (rhythm === 'calm') return [
      { size: 180, duration: 18, reverse: false, dotSize: 9 },
      { size: 120, duration: 28, reverse: true, dotSize: 7 },
    ];
    if (rhythm === 'dynamic') return [
      { size: 220, duration: 8, reverse: false, dotSize: 10 },
      { size: 170, duration: 14, reverse: true, dotSize: 9 },
      { size: 120, duration: 26, reverse: false, dotSize: 7 },
    ];
    return [
      { size: 200, duration: 12, reverse: false, dotSize: 10 },
      { size: 140, duration: 20, reverse: true, dotSize: 8 },
    ];
  }, [rhythm]);

  return (
    <div className="grid">
      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="controls">
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
          <div className="item"><div>订单总数</div><div className="value">{totalUp}</div></div>
          <div className="item"><div>完成订单</div><div className="value">{completedUp}</div></div>
          <div className="item"><div>取消率</div><div className="value">{cancelRateUp}%</div></div>
          <div className="item"><div>准时率</div><div className="value">{onTimeRateUp}%</div></div>
          <div className="item"><div>平均配送时长</div><div className="value">{avgTimeUp} 分钟</div></div>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <h3>骑手人文关怀与天气提醒</h3>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            {weatherLoading && <span className="muted">天气加载中...</span>}
            {weatherError && <span style={{color:'var(--danger)'}}>{weatherError}</span>}
            <button className="button" onClick={fetchWeather} disabled={weatherLoading}>更新天气</button>
          </div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:12}}>
          <div className="card" style={{gridColumn:'span 4'}}>
            <div className="kpi">
              <div className="item"><div>温度</div><div className="value">{weather?.temperature != null ? `${weather.temperature}°C` : '-'}</div></div>
              <div className="item"><div>湿度</div><div className="value">{weather?.humidity != null ? `${weather.humidity}%` : '-'}</div></div>
              <div className="item"><div>天气</div><div className="value">{weather?.weather ?? '-'}</div></div>
              <div className="item"><div>风力</div><div className="value">{weather?.windLevel != null ? `${weather.windLevel}级` : '-'}</div></div>
            </div>
            <div className="muted" style={{marginTop:6}}>位置来源：{filtered.length ? '订单区域中心' : '上海市中心'}{weather?.city ? ` · ${weather.city}` : ''}</div>
          </div>
          <div className="card" style={{gridColumn:'span 8'}}>
            <h4>今日出行建议</h4>
            <ul style={{margin:0, paddingLeft:18}}>
              {careTips.map((t, idx) => (<li key={idx}>{t}</li>))}
            </ul>
          </div>
        </div>
      </div>

      {/* 文字艺术与时间 & 星球轨迹 */}
      <div className="card" style={{gridColumn:'span 12'}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:16}}>
          <div style={{gridColumn:'span 7'}}>
            <h1 className={`text-art ${theme}`} style={{margin:'8px 0'}}>数据星球</h1>
            <div className="muted">让数据与美感并行，洞见每一次配送的节奏。</div>
            <div style={{marginTop:10}}>
              <span style={{color:'var(--accent-2)'}}>当前时间：</span>
              <span>{now}</span>
            </div>
            <div className="controls" style={{marginTop:12}}>
              <div className="control">
                <span className="muted">主题：</span>
                <button className="button" onClick={()=>setTheme('purpleGold')}>紫金</button>
                <button className="button" onClick={()=>setTheme('blueGreen')}>蓝绿</button>
              </div>
              <div className="control">
                <span className="muted">节奏：</span>
                <button className="button" onClick={()=>setRhythm('calm')}>慢</button>
                <button className="button" onClick={()=>setRhythm('balanced')}>中</button>
                <button className="button" onClick={()=>setRhythm('dynamic')}>快</button>
              </div>
            </div>
          </div>
          <div style={{gridColumn:'span 5'}}>
            <div className="orbit" data-theme={theme}>
              <div className="planet" />
              {ringConfig.map((r, idx) => (
                <div
                  className="ring"
                  key={idx}
                  style={{
                    width: r.size,
                    height: r.size,
                    animation: `spin ${r.duration}s linear infinite ${r.reverse ? 'reverse' : 'normal'}`,
                  }}
                >
                  <div
                    className="dot"
                    style={{ width: r.dotSize, height: r.dotSize, top: -(r.dotSize/2) }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{gridColumn:'span 12'}}>
        <div className="card-header" style={{justifyContent:'space-between'}}>
          <h3 className="card-title">今日骑手出勤摘要</h3>
          <div className="muted">基于当前筛选范围的订单骑手</div>
        </div>
        <div className="kpi">
          {(() => {
            const ids = Array.from(new Set(filtered.map(o=>o.rider.riderId)));
            const sum = attendanceSummary(today(), ids);
            return (
              <>
                <div className="item"><div>计划出勤</div><div className="value">{ids.length}</div></div>
                <div className="item"><div>实际出勤</div><div className="value">{sum.present}</div></div>
                <div className="item"><div>请假</div><div className="value" style={{color:'var(--warning)'}}>{sum.leave}</div></div>
              </>
            );
          })()}
        </div>
        <div className="muted" style={{marginTop:8}}>可前往“骑手排行”页维护骑手联系与出勤信息</div>
      </div>
    </div>
  );
}

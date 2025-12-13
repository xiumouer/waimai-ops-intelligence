<template>
  <div class="card head full">
    <h3>骑手端
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <select v-model="selected" @change="bindRider" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
          <option value="">选择已登记骑手</option>
          <option v-for="r in riders" :key="r.name" :value="r.name">{{r.name}}</option>
        </select>
        <input v-model="name" placeholder="姓名" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="phone" placeholder="手机号" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-sm" @click="register">登记</button>
        <button class="btn btn-sm" @click="login">登录</button>
      </span>
    </h3>
    <div class="metrics">
      <div class="metric-box"><div class="metric-title">会话状态</div><div class="kpi" :class="{ 'kpi-success': running }">{{ running? '运行中':'已停止' }}</div></div>
      <div class="metric-box"><div class="metric-title">里程(km)</div><div class="kpi kpi-primary">{{ fmt(distanceKm) }}</div></div>
      <div class="metric-box"><div class="metric-title">轨迹点</div><div class="kpi">{{ points.length }}</div></div>
      <div class="metric-box"><div class="metric-title">时长(min)</div><div class="kpi">{{ durationMin }}</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h3>实时定位</h3>
        <div class="subtext">定位模式：{{modeDesc}}（定位不可用时自动模拟）</div>
        <div style="display:inline-flex;gap:8px;margin:6px 0">
          <button class="btn btn-sm" :class="{pulse:onMode('real')}" @click="mode='real'" :style="onMode('real')? 'background:#1A5FFF;color:#fff;border-color:#1A5FFF':''">实际定位</button>
          <button class="btn btn-sm" :class="{pulse:onMode('sim')}" @click="mode='sim'" :style="onMode('sim')? 'background:#1A5FFF;color:#fff;border-color:#1A5FFF':''">模拟行走</button>
        </div>
        <div class="chart" ref="mapBox" style="height:360px;overflow:hidden"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-sm" @click="start">开始</button>
          <button class="btn btn-sm" @click="stop">停止</button>
          <button class="btn btn-sm" @click="submitTrack" :disabled="points.length<2">提交里程</button>
        </div>
      </div>
      <div class="card">
        <h3>控制台</h3>
        <div class="list scroll-y">
          <div class="list-item" v-for="(log,i) in logs" :key="i">
            <span class="subtext">{{log}}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import * as echarts from 'echarts';
import 'echarts-extension-amap';
import AMapLoader from '@amap/amap-jsapi-loader';
import { fetchJSON, postJSON } from '../services/api';
type LngLat = [number, number];
const name = ref('');
const phone = ref('');
const running = ref(false);
const zoom = ref(14);
const riders = ref<{name:string;phone:string}[]>([]);
const selected = ref('');
const startTs = ref<number>(0);
const endTs = ref<number>(0);
const points = ref<LngLat[]>([]);
const distance = ref(0);
const mapBox = ref<HTMLDivElement|null>(null);
let chart: echarts.ECharts | null = null;
let amapOnce: Promise<any> | null = null;
let amapMode = false;
let timer: any = null;
const logs = ref<string[]>([]);
const mode = ref<'real'|'sim'>('real');
const modeDesc = computed(()=> mode.value==='real'? '实际定位':'模拟行走');
function onMode(m:'real'|'sim'){ return mode.value===m; }

function fmt(n:number){ return Number(n||0).toFixed(2); }
const distanceKm = computed(()=> Number((distance.value/1000).toFixed(2)) );
const durationMin = computed(()=> startTs.value? Math.floor(((endTs.value||Date.now())-startTs.value)/60000) : 0 );

function log(s: string){ logs.value.unshift(new Date().toLocaleTimeString()+' · '+s); if(logs.value.length>200) logs.value.length=200; }
function loadRiders(){
  fetchJSON<any>('riders.json').then(list=>{
    try {
      const items = (list||[]).map((x:any)=>({name:String(x.name||''), phone:String(x.phone||'')}));
      riders.value = items.filter((x: {name:string; phone:string})=> !!x.name);
    } catch(e){}
  }).catch(()=>{});
}
function bindRider(){ const r = riders.value.find(x=>x.name===selected.value); if(r){ name.value=r.name; phone.value=r.phone||''; } }

function register(){
  name.value = String(name.value||'').trim();
  phone.value = String(phone.value||'').trim();
  if(!name.value||!phone.value){ log('登记失败：缺少姓名或手机号'); return; }
  postJSON('rider-register',{name:name.value,phone:phone.value}).then(()=>log('登记成功')).catch(()=>{
    fetchJSON(`rider-register?name=${encodeURIComponent(name.value)}&phone=${encodeURIComponent(phone.value)}`).then(()=>log('登记成功')).catch(()=>log('登记失败'));
  });
}
function login(){
  name.value = String(name.value||'').trim();
  phone.value = String(phone.value||'').trim();
  if(!name.value||!phone.value){ log('登录失败：缺少姓名或手机号'); return; }
  postJSON('rider-login',{name:name.value,phone:phone.value}).then(r=>{ log(r?.ok? '登录成功':'登录失败'); }).catch(()=>{
    fetchJSON(`rider-login?name=${encodeURIComponent(name.value)}&phone=${encodeURIComponent(phone.value)}`).then(r=>{ log((r as any)?.ok? '登录成功':'登录失败'); }).catch(()=>log('登录失败'));
  });
}

function haversine(a:LngLat,b:LngLat){ const R=6371000; const toRad=(d:number)=>d*Math.PI/180; const dlat=toRad(b[1]-a[1]); const dlon=toRad(b[0]-a[0]); const lat1=toRad(a[1]); const lat2=toRad(b[1]); const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }

function pushPoint(p:LngLat){ const ts=Date.now(); points.value.push(p); endTs.value=ts; if(points.value.length>1){ distance.value += haversine(points.value[points.value.length-2], p); } postJSON('track-point',{name:name.value,phone:phone.value,lng:p[0],lat:p[1],ts:ts}).then(()=>{}).catch(()=>{}); renderPath(); }

function getKey(){
  const cfg: any = (window as any).APP_CONFIG || {};
  if (cfg.AMAP_SECURITY_JS) {
    (window as any)._AMapSecurityConfig = { securityJsCode: cfg.AMAP_SECURITY_JS };
  }
  return cfg.AMAP_KEY || '';
}

async function renderPath(){
  try{
    if(!mapBox.value) return;
    if(!chart){ chart = echarts.init(mapBox.value); }
    // Try AMap mode when online
    if(navigator.onLine){
      try{
        if(!amapOnce){ amapOnce = AMapLoader.load({ key: getKey(), version: '2.0', plugins: ['AMap.Scale'] }); }
        await amapOnce;
        amapMode = true;
      }catch(e){ amapMode = false; }
    } else { amapMode = false; }

    if(amapMode){
      const center = points.value[points.value.length-1] || [116.397428,39.90923];
      const path = points.value.map(p=>p as any);
      const series:any[] = [];
      if(path.length >= 2){
        series.push({ id:'track', type:'lines', coordinateSystem:'amap', polyline:true, data:[{ coords: path }], lineStyle:{ color:'#1A5FFF', width:3 } });
      }
      series.push({ id:'pos', type:'effectScatter', coordinateSystem:'amap', data: path.length? [path[path.length-1]]:[], rippleEffect:{ scale:3 }, symbolSize:10, itemStyle:{ color:'#FF6B6B' } });
      chart.setOption({ amap:{ center, zoom: zoom.value, resizeEnable:true, renderOnMoving:true }, series });
    } else {
      const path = points.value.slice();
      const last = path[path.length-1] || [116.397428,39.90923];
      const lngs = path.map(p=>p[0]);
      const lats = path.map(p=>p[1]);
      const pad = running.value? 0.002 : 0.01;
      const minLng = Math.min(...lngs, last[0]-pad);
      const maxLng = Math.max(...lngs, last[0]+pad);
      const minLat = Math.min(...lats, last[1]-pad);
      const maxLat = Math.max(...lats, last[1]+pad);
      const series:any[] = [];
      series.push({ id:'track-line', type:'line', data: (path.length>=2)? path:[], encode:{x:0,y:1}, lineStyle:{ width:3, color:'#1A5FFF' }, showSymbol:false });
      series.push({ id:'pos-point', type:'scatter', data: path.length? [last]:[], encode:{x:0,y:1}, symbolSize:12, itemStyle:{ color:'#FF6B6B' } });
      chart.setOption({ grid:{left:40,right:20,top:20,bottom:30,containLabel:true}, xAxis:{type:'value', min:minLng, max:maxLng, axisLabel:{formatter:(v:any)=>v.toFixed(3)}}, yAxis:{type:'value', min:minLat, max:maxLat, axisLabel:{formatter:(v:any)=>v.toFixed(3)}}, series });
    }
  }catch(e){}
}

async function locateOnce(): Promise<LngLat>{ if(mode.value==='sim'){ return Promise.resolve(simulateNext()); } return new Promise((resolve)=>{ try{ if(navigator.geolocation){ navigator.geolocation.getCurrentPosition((pos)=>{ const c = pos.coords; resolve([c.longitude, c.latitude]); }, ()=>{ resolve(simulateNext()); }, {enableHighAccuracy:true,timeout:3000}); } else { resolve(simulateNext()); } }catch(e){ resolve(simulateNext()); } }); }

function simulateNext(): LngLat{ const last = points.value[points.value.length-1] || [116.397428,39.90923]; const dLng=(Math.random()-0.5)*0.002; const dLat=(Math.random()-0.5)*0.002; return [Number((last[0]+dLng).toFixed(6)), Number((last[1]+dLat).toFixed(6))]; }

function start(){ if(running.value) return; if(!name.value){ alert('请输入姓名'); return; } startTs.value = Date.now(); endTs.value = startTs.value; points.value = []; distance.value = 0; running.value = true; zoom.value = 16; log('开始定位与上报 · '+modeDesc.value); timer = setInterval(async()=>{ const p = await locateOnce(); pushPoint(p); }, 5000); }
function stop(){ if(!running.value) return; running.value=false; if(timer){ clearInterval(timer); timer=null; } log('停止'); }

function submitTrack(){
  if(!points.value.length){ alert('无轨迹数据'); return; }
  if(!name.value || !phone.value){ alert('请填写姓名与手机号并先登记'); return; }
  const payload={ name:name.value, phone:phone.value, start_ts:startTs.value, end_ts:endTs.value, distance:distance.value, points:points.value };
  postJSON('rider-register',{name:name.value, phone:phone.value}).catch(()=>{}).finally(()=>{
    postJSON('tracks/submit', payload).then(()=>{ log('提交成功 · '+fmt(distanceKm.value)+' km'); }).catch(()=>{ log('提交失败'); });
  });
}

onMounted(()=>{ renderPath(); loadRiders(); });
onBeforeUnmount(()=>{ try{ if(timer){ clearInterval(timer); timer=null; } chart?.dispose(); chart=null; } catch(e){} });
</script>

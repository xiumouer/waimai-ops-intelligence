<template>
  <header class="app-header"><div class="brand">外卖数智平台</div><div style="margin-left:auto;display:flex;gap:12px;align-items:center;font-size:12px">
    <span :class="{'tag':true, 'tag-success': health?.ok, 'tag-danger': !health?.ok}">{{health?.ok? 'API 正常':'API 异常'}}</span>
    <span class="subtext">订单 {{health?.orders||0}}</span>
    <span class="subtext">在线骑手 {{health?.onlineRiders||0}}</span>
    <span class="subtext">告警 {{health?.alerts||0}}</span>
  </div></header>
  <div class="app-shell">
    <aside class="app-sidebar">
      <nav>
        <button class="nav-item" :class="{active: page==='overview'}" @click="page='overview'">概览</button>
        <button class="nav-item" :class="{active: page==='orders'}" @click="page='orders'">订单监控</button>
        <button class="nav-item" :class="{active: page==='riders'}" @click="page='riders'">骑手管理</button>
        <button class="nav-item" :class="{active: page==='mileage'}" @click="page='mileage'">里程管理</button>
        <button class="nav-item" :class="{active: page==='analytics'}" @click="page='analytics'">订单分析</button>
        <button class="nav-item" :class="{active: page==='settlement'}" @click="page='settlement'">收入结算</button>
        <button class="nav-item" :class="{active: page==='ranking'}" @click="page='ranking'">绩效排行</button>
      </nav>
    </aside>
    <main class="app-main">
      <section v-show="page==='overview'" class="page visible">
        <OverviewPage :center="center" :riders="riders" :alerts="alerts" :overview="overview" @center-changed="onCenterChanged" />
      </section>
      <section v-show="page==='orders'" class="page visible"><OrdersPage :riders="riders" :alerts="alerts" :orders="orders" @focus="focusTo" /></section>
      <section v-show="page==='riders'" class="page visible"><RidersPage /></section>
      <section v-show="page==='mileage'" class="page visible"><MileagePage /></section>
      <section v-show="page==='analytics'" class="page visible"><AnalyticsPage /></section>
      <section v-show="page==='settlement'" class="page visible"><SettlementPage /></section>
      <section v-if="page==='ranking'" class="page visible"><RankingPage /></section>
    </main>
  </div>
  
</template>

<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue';
const OrdersPage = defineAsyncComponent(()=>import('./pages/OrdersPage.vue'));
const RidersPage = defineAsyncComponent(()=>import('./pages/RidersPage.vue'));
const MileagePage = defineAsyncComponent(()=>import('./pages/MileagePage.vue'));
const AnalyticsPage = defineAsyncComponent(()=>import('./pages/AnalyticsPage.vue'));
const SettlementPage = defineAsyncComponent(()=>import('./pages/SettlementPage.vue'));
const RankingPage = defineAsyncComponent(()=>import('./pages/RankingPage.vue'));
const OverviewPage = defineAsyncComponent(()=>import('./pages/OverviewPage.vue'));
import { fetchJSON, fetchJSONRetry } from './services/api';

type LngLat = [number, number];
type RiderPoint = { name: string; pos: LngLat };
type AlertPoint = { key: string; pos: LngLat };

const page = ref<'overview'|'orders'|'riders'|'mileage'|'analytics'|'settlement'|'ranking'>('overview');
const center = ref<LngLat>([116.397428, 39.90923]);
const riders = ref<RiderPoint[]>([]);
const alerts = ref<AlertPoint[]>([]);
const overview = ref<any>(null);
const orders = ref<any[]>([]);
const health = ref<any>(null);

 

function refreshFast(){
  if(navigator.onLine===false) return;
  const needAlerts = (page.value==='overview' || page.value==='orders');
  Promise.all([
    fetchJSONRetry('riders.json',2,300).catch(()=>null),
    needAlerts ? fetchJSONRetry('alerts.json',2,300).catch(()=>null) : Promise.resolve(null)
  ]).then(([ridersData, alertsData])=>{
    if(Array.isArray(ridersData)){
      riders.value = ridersData.filter((r:any)=>r.lng!=null && r.lat!=null).map((r:any)=>({name:r.name,pos:[r.lng,r.lat]}));
    }
    if(Array.isArray(alertsData)){
      alerts.value = alertsData.filter((a:any)=>a.lng!=null && a.lat!=null).map((a:any)=>({key:a.orderId+'-'+a.rider,pos:[a.lng,a.lat]}));
    }
  });
}

function onCenterChanged(pos: LngLat){
  center.value = pos;
}
function focusTo(pos: LngLat){ center.value = pos; page.value = 'overview'; }

function refreshMedium(){
  if(navigator.onLine===false) return;
  Promise.all([
    fetchJSONRetry('overview.json',3,400).catch(()=>null),
    fetchJSONRetry('orders.json',3,400).catch(()=>null)
  ]).then(([ov, od])=>{
    if(ov) overview.value = ov;
    if(Array.isArray(od)) orders.value = od;
  });
}
function refreshHealth(){
  if(navigator.onLine===false) return;
  fetchJSONRetry('healthz',2,300).then(h=>{ health.value = h; }).catch(()=>{});
}
onMounted(()=>{
  refreshFast();
  const g:any = window as any;
  if (g.__APP_FAST_TIMER__) { clearInterval(g.__APP_FAST_TIMER__); }
  if (g.__APP_MED_TIMER__) { clearInterval(g.__APP_MED_TIMER__); }
  if (g.__APP_HEALTH_TIMER__) { clearInterval(g.__APP_HEALTH_TIMER__); }
  let fastInterval = 5000;
  let medInterval = 8000;
  g.__APP_FAST_TIMER__ = setInterval(refreshFast, fastInterval);
  refreshMedium();
  g.__APP_MED_TIMER__ = setInterval(refreshMedium, medInterval);
  refreshHealth();
  g.__APP_HEALTH_TIMER__ = setInterval(()=>{
    refreshHealth();
    try {
      if (health.value && health.value.ok===false) {
        if (g.__APP_MED_TIMER__) { clearInterval(g.__APP_MED_TIMER__); }
        medInterval = 15000;
        g.__APP_MED_TIMER__ = setInterval(refreshMedium, medInterval);
      } else {
        if (g.__APP_MED_TIMER__) { clearInterval(g.__APP_MED_TIMER__); }
        medInterval = 8000;
        g.__APP_MED_TIMER__ = setInterval(refreshMedium, medInterval);
      }
    } catch(e) {}
  }, 10000);
  if (import.meta.hot) {
    import.meta.hot.dispose(()=>{
      try {
        if (g.__APP_FAST_TIMER__) { clearInterval(g.__APP_FAST_TIMER__); g.__APP_FAST_TIMER__ = null; }
        if (g.__APP_MED_TIMER__) { clearInterval(g.__APP_MED_TIMER__); g.__APP_MED_TIMER__ = null; }
        if (g.__APP_HEALTH_TIMER__) { clearInterval(g.__APP_HEALTH_TIMER__); g.__APP_HEALTH_TIMER__ = null; }
      } catch(e) {}
    });
  }
});
</script>

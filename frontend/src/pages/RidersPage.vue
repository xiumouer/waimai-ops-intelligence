<template>
  <div class="card head full">
    <h3>骑手管理 <span class="subtext" style="font-size:12px;margin-left:8px">在线 {{online}} / 总计 {{total}} / 离线 {{offline}}</span>
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <input v-model="q" placeholder="搜索姓名/手机号" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="name" placeholder="姓名" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="phone" placeholder="手机号" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-sm" @click="register">登记</button>
        <button class="btn btn-sm" @click="load">刷新</button>
      </span>
    </h3>
  </div>
  <div class="grid grid-2">
    <div class="card"><h3>概况</h3>
      <div class="metrics">
        <div class="metric-box"><div class="metric-title">在线骑手</div><div class="kpi kpi-success">{{online}}</div></div>
        <div class="metric-box"><div class="metric-title">总骑手数</div><div class="kpi">{{total}}</div></div>
        <div class="metric-box"><div class="metric-title">离线骑手</div><div class="kpi kpi-danger">{{offline}}</div></div>
        <div class="metric-box"><div class="metric-title">近7天订单</div><div class="kpi kpi-primary">{{totalOrders}}</div></div>
      </div>
    </div>
    <div class="card"><h3>状态分布</h3><div ref="statusEl" class="chart"></div></div>
    <div class="card full"><h3>订单Top8</h3><div ref="rankingEl" class="chart"></div></div>
  </div>
  <div class="card full">
    <h3>列表</h3>
    <div class="list scroll-y">
      <div class="list-item" v-for="r in filtered" :key="r.name" @click="focusRider(r)">
        <div class="li-left"><div>{{r.name}}</div><div class="subtext">手机号 {{r.phone || '未登记'}}</div></div>
        <div class="li-right"><span class="tag" :class="r.status==='在线'?'tag-success':'tag-muted'">{{r.status}}</span>
          <button class="btn btn-sm" style="margin-left:8px" @click.stop="remove(r.name)">删除</button>
        </div>
      </div>
    </div>
  </div>
  </template>
<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue';
import * as echarts from 'echarts';
import { fetchJSON, postJSON } from '../services/api';
type LngLat = [number, number];
type Rider = { name:string; phone:string; status:string; lng?:number; lat?:number };
const emit = defineEmits<{ (e:'focus', center: LngLat): void }>();
const riders = ref<Rider[]>([]);
const name = ref('');
const phone = ref('');
const q = ref('');
const statusEl = ref<HTMLDivElement|null>(null);
const rankingEl = ref<HTMLDivElement|null>(null);
const perf = ref<{rider:string; orders:number}[]>([]);
function load(){ fetchJSON<Rider[]>('riders.json').then(r=>{ riders.value=r; renderCharts(); }).catch(()=>{}); fetchJSON<any>('performance.json').then(d=>{ perf.value = (d||[]).map((x:any)=>({rider:x.rider, orders:Number(x.orders||0)})); renderCharts(); }).catch(()=>{}); }
onMounted(()=>{ load(); });
const online = computed(()=> riders.value.filter(x=>x.status==='在线').length );
const total = computed(()=> riders.value.length );
const offline = computed(()=> Math.max(0, total.value-online.value) );
const filtered = computed(()=>{ const s = q.value.trim(); if(!s) return riders.value; const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); return riders.value.filter(r=> rx.test(r.name)||rx.test(String(r.phone||''))||rx.test(r.status)); });
const totalOrders = computed(()=> perf.value.reduce((a,b)=>a+(b.orders||0),0) );
function focusRider(r: Rider){ if(r.lng!=null && r.lat!=null){ emit('focus', [r.lng, r.lat]); } }
function register(){ if(!name.value || !phone.value) return; postJSON('rider-register', { name: name.value, phone: phone.value }).then(()=>{ name.value=''; phone.value=''; load(); }).catch(()=>{}); }
function remove(nm: string){ if(!nm) return; postJSON('rider-delete', { name: nm }).then(()=>{ load(); }).catch(()=>{}); }
function renderCharts(){
  try{
    nextTick(()=>{
      if(statusEl.value){
        const w=statusEl.value.clientWidth,h=statusEl.value.clientHeight; if(!w||!h){ setTimeout(renderCharts,120); return; }
        const chart = echarts.init(statusEl.value);
        const onlineCnt = online.value;
        const offlineCnt = offline.value;
        chart.setOption({ tooltip:{}, series:[{type:'pie', radius:['40%','70%'], label:{show:true,formatter:'{b}: {c}'}, data:[{name:'在线', value:onlineCnt},{name:'离线', value:offlineCnt}], itemStyle:{}}] });
      }
      if(rankingEl.value){
        const w=rankingEl.value.clientWidth,h=rankingEl.value.clientHeight; if(!w||!h){ setTimeout(renderCharts,120); return; }
        const chart = echarts.init(rankingEl.value);
        const top = [...perf.value].sort((a,b)=>b.orders-a.orders).slice(0,8);
        chart.setOption({ grid:{left:60,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'value'}, yAxis:{type:'category',data:top.map(x=>x.rider)}, series:[{type:'bar',data:top.map(x=>x.orders), itemStyle:{color:'#5B8CFF'}}] });
      }
    });
  }catch(e){}
}
</script>

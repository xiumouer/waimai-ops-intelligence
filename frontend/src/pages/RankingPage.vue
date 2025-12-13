<template>
  <div class="card head full">
    <h3>绩效排行
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <input v-model="start" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="end" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-sm" @click="load">查询</button>
      </span>
    </h3>
    <div v-if="ready" class="metrics" style="margin-bottom:12px">
      <div class="metric-box"><div class="metric-title">平均准时率</div><div class="kpi kpi-primary">{{pct(avgOnTime)}}</div></div>
      <div class="metric-box"><div class="metric-title">总订单</div><div class="kpi">{{totalOrders}}</div></div>
      <div class="metric-box"><div class="metric-title">骑手数</div><div class="kpi">{{list.length}}</div></div>
    </div>
    <div v-if="ready" class="grid grid-2">
      <div class="card"><h3>准时率Top10</h3><div ref="rateEl" class="chart" style="height:240px"></div></div>
      <div class="card"><h3>订单Top10</h3><div ref="ordersEl" class="chart" style="height:240px"></div></div>
      <div class="card full"><h3>明细</h3>
        <div class="scroll-y">
          <table class="table"><thead><tr><th>骑手</th><th>准时率</th><th>接单率</th><th>好评率</th><th>订单</th></tr></thead>
            <tbody>
              <tr v-for="r in list" :key="r.rider"><td>{{r.rider}}</td><td>{{pct(r.on_time_rate)}}</td><td>{{pct(r.accept_rate)}}</td><td>{{pct(r.positive_rate)}}</td><td>{{r.orders}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div v-else class="subtext" style="padding:12px">加载中…</div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed } from 'vue';
import * as echarts from 'echarts';
import { fetchJSONRetry } from '../services/api';
type Item = { rider:string; on_time_rate:number; accept_rate:number; positive_rate:number; orders:number };
const list = ref<Item[]>([]);
const ready = ref(false);
const start = ref('');
const end = ref('');
function pct(v:number){ return Math.round(v*1000)/10 + '%'; }
function ts(d: string): number { try { return Math.floor(new Date(d+'T00:00:00').getTime()/1000); } catch(e){ return 0; } }
function initRange(){ const now = new Date(); const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const startD = new Date(endD.getTime() - 7*86400000); start.value = startD.toISOString().slice(0,10); end.value = endD.toISOString().slice(0,10); }
const rateEl = ref<HTMLDivElement|null>(null);
const ordersEl = ref<HTMLDivElement|null>(null);
let rateChart: echarts.ECharts | null = null;
let ordersChart: echarts.ECharts | null = null;
let timer: any = null;
function load(){ const s = ts(start.value); const e = (ts(end.value)+86400-1) || Math.floor(Date.now()/1000); fetchJSONRetry<Item[]>(`performance.json?start=${s}&end=${e}`,3,400).then(r=>{ list.value=r; renderCharts(); }).catch(()=>{}).finally(()=>{ ready.value=true; }); }
function renderCharts(){ try { nextTick(()=>{
  if(rateEl.value){ const w=rateEl.value.clientWidth,h=rateEl.value.clientHeight; if(!w||!h){ setTimeout(renderCharts,120); return; } if(!rateChart){ rateChart = echarts.init(rateEl.value); }
    const topRate = [...list.value].sort((a,b)=> b.on_time_rate - a.on_time_rate).slice(0,10);
    rateChart.setOption({ grid:{left:60,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'value',axisLabel:{formatter:(v:any)=> Math.round(v*1000)/10 + '%'}}, yAxis:{type:'category',data:topRate.map(x=>x.rider)}, series:[{type:'bar',data:topRate.map(x=>x.on_time_rate), itemStyle:{color:'#1A5FFF'}}] });
  }
  if(ordersEl.value){ const w=ordersEl.value.clientWidth,h=ordersEl.value.clientHeight; if(!w||!h){ setTimeout(renderCharts,120); return; } if(!ordersChart){ ordersChart = echarts.init(ordersEl.value); }
    const topOrders = [...list.value].sort((a,b)=> b.orders - a.orders).slice(0,10);
    ordersChart.setOption({ grid:{left:60,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'value'}, yAxis:{type:'category',data:topOrders.map(x=>x.rider)}, series:[{type:'bar',data:topOrders.map(x=>x.orders), itemStyle:{color:'#00D4AA'}}] });
  }
}); } catch(e){} }
const avgOnTime = computed(()=>{ const n=list.value.length||1; return list.value.reduce((a,b)=>a+(b.on_time_rate||0),0)/n; });
const totalOrders = computed(()=> list.value.reduce((a,b)=>a+(b.orders||0),0) );
onMounted(()=>{ initRange(); load(); timer = setInterval(()=>load(), 4000); });
onBeforeUnmount(()=>{ if(timer){ try{ clearInterval(timer); }catch(e){} timer=null; } try{ rateChart?.dispose(); rateChart=null; ordersChart?.dispose(); ordersChart=null; }catch(e){} });
</script>

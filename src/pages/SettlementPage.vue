<template>
  <div class="card head full">
    <h3>收入结算
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <input v-model="start" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="end" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-sm" @click="load">查询</button>
      </span>
    </h3>
    <div class="metrics">
      <div class="metric-box"><div class="metric-title">总订单</div><div class="kpi">{{sumOrders}}</div></div>
      <div class="metric-box"><div class="metric-title">总收入</div><div class="kpi kpi-primary">{{fmt(sumIncome)}}</div></div>
      <div class="metric-box"><div class="metric-title">总补贴</div><div class="kpi">{{fmt(sumSubsidy)}}</div></div>
      <div class="metric-box"><div class="metric-title">总扣款</div><div class="kpi kpi-danger">{{fmt(sumPenalties)}}</div></div>
      <div class="metric-box"><div class="metric-title">净收入</div><div class="kpi kpi-success">{{fmt(sumNet)}}</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card"><h3>净收入排行Top10</h3><div ref="chartEl" class="chart"></div></div>
      <div class="card"><h3>明细</h3>
        <div class="scroll-y">
          <table class="table"><thead><tr><th>骑手</th><th>订单</th><th>收入</th><th>补贴</th><th>扣款</th><th>净收入</th></tr></thead>
            <tbody>
              <tr v-for="s in list" :key="s.rider"><td>{{s.rider}}</td><td>{{s.orders}}</td><td>{{fmt(s.income)}}</td><td>{{fmt(s.subsidy)}}</td><td>{{fmt(s.penalties)}}</td><td>{{fmt(s.net)}}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue';
import { fetchJSONRetry, fetchJSON } from '../services/api';
import * as echarts from 'echarts';
type Item = { rider:string; orders:number; income:number; subsidy:number; penalties:number; net:number };
const list = ref<Item[]>([]);
const chartEl = ref<HTMLDivElement|null>(null);
let chart: echarts.ECharts | null = null;
const start = ref('');
const end = ref('');
function ts(d: string): number { try { return Math.floor(new Date(d+'T00:00:00').getTime()/1000); } catch(e){ return 0; } }
function initRange(){ const now = new Date(); const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const startD = new Date(endD.getTime() - 7*86400000); start.value = startD.toISOString().slice(0,10); end.value = endD.toISOString().slice(0,10); }
function fmt(v: number){ return Number(v||0).toFixed(2); }
function load(){ const s = ts(start.value); const e = (ts(end.value)+86400-1) || Math.floor(Date.now()/1000); fetchJSONRetry<Item[]>(`settlements.json?start=${s}&end=${e}`).then(r=>{ list.value=r||[]; renderChart(); }).catch(()=>{}); }
onMounted(()=>{ initRange(); load(); });
const sumOrders = computed(()=> list.value.reduce((a,b)=>a+(b.orders||0),0));
const sumIncome = computed(()=> list.value.reduce((a,b)=>a+(b.income||0),0));
const sumSubsidy = computed(()=> list.value.reduce((a,b)=>a+(b.subsidy||0),0));
const sumPenalties = computed(()=> list.value.reduce((a,b)=>a+(b.penalties||0),0));
const sumNet = computed(()=> list.value.reduce((a,b)=>a+(b.net||0),0));
function renderChart(){ try { if(chartEl.value){ nextTick(()=>{ const w=chartEl.value!.clientWidth,h=chartEl.value!.clientHeight; if(!w||!h){ setTimeout(renderChart,120); return; } if(!chart){ chart = echarts.init(chartEl.value!); } const top = [...list.value].sort((a,b)=>b.net-a.net).slice(0,10); chart.setOption({ grid:{left:60,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'value'}, yAxis:{type:'category',data:top.map(x=>x.rider)}, series:[{type:'bar',data:top.map(x=>Number(fmt(x.net))), itemStyle:{color:'#00D4AA'}}] }); }); } } catch(e){} }
</script>

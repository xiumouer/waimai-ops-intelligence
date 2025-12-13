<template>
  <div class="grid grid-2">
    <div class="card"><h3>时段分布
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <input v-model="start" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <input v-model="end" type="date" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-sm" @click="load">查询</button>
      </span>
    </h3><div ref="timeEl" class="chart"></div></div>
    <div class="card"><h3>品类分析</h3><div ref="catEl" class="chart"></div></div>
    <div class="card full"><h3>转化漏斗</h3><div ref="funnelEl" class="chart"></div></div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import * as echarts from 'echarts';
import { fetchJSONRetry } from '../services/api';
const timeEl = ref<HTMLDivElement|null>(null);
const catEl = ref<HTMLDivElement|null>(null);
const funnelEl = ref<HTMLDivElement|null>(null);
const start = ref('');
const end = ref('');
let timeChart: echarts.ECharts | null = null;
let catChart: echarts.ECharts | null = null;
let funnelChart: echarts.ECharts | null = null;
let timer: any = null;
function ts(d: string): number { try { return Math.floor(new Date(d+'T00:00:00').getTime()/1000); } catch(e){ return 0; } }
function initRange(){ const now = new Date(); const endD = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const startD = new Date(endD.getTime() - 7*86400000); start.value = startD.toISOString().slice(0,10); end.value = endD.toISOString().slice(0,10); }
function load(){ const s = ts(start.value); const e = (ts(end.value)+86400-1) || Math.floor(Date.now()/1000); fetchJSONRetry<any>(`analytics.json?start=${s}&end=${e}`).then(d=>{
  if(!d) return;
  try{
    nextTick(()=>{
      if(timeEl.value){ const w=timeEl.value.clientWidth,h=timeEl.value.clientHeight; if(!w||!h){ setTimeout(()=>load(),120); return; } if(!timeChart){ timeChart = echarts.init(timeEl.value); } timeChart.setOption({ grid:{left:40,right:20,top:20,bottom:24,containLabel:true}, tooltip:{trigger:'axis'}, xAxis:{type:'category',data:d?.time?.labels||[]}, yAxis:{type:'value'}, series:[{name:'订单量',type:'line',smooth:true,data:d?.time?.orders||[], lineStyle:{width:3,color:'#1A5FFF'}, areaStyle:{color:'#1A5FFF'} }] }); }
      if(catEl.value){ const w=catEl.value.clientWidth,h=catEl.value.clientHeight; if(!w||!h){ setTimeout(()=>load(),120); return; } if(!catChart){ catChart = echarts.init(catEl.value); } catChart.setOption({ grid:{left:40,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'category',data:d?.category?.labels||[]}, yAxis:{type:'value'}, series:[{name:'订单数',type:'bar',data:d?.category?.counts||[], itemStyle:{color:'#5B8CFF'}}] }); }
      if(funnelEl.value){ const w=funnelEl.value.clientWidth,h=funnelEl.value.clientHeight; if(!w||!h){ setTimeout(()=>load(),120); return; } if(!funnelChart){ funnelChart = echarts.init(funnelEl.value); } funnelChart.setOption({ tooltip:{}, series:[{type:'funnel', left:'10%', width:'80%', top:10, bottom:10, label:{position:'inside'}, data:(d?.funnel||[]).map((x:any)=>({name:x.name, value:x.value})) }] }); }
    });
  }catch(e){}
}).catch(()=>{}); }
onMounted(()=>{ initRange(); load(); timer = setInterval(()=>load(), 8000); });
onBeforeUnmount(()=>{ if(timer){ try{ clearInterval(timer); }catch(e){} timer=null; } });
</script>

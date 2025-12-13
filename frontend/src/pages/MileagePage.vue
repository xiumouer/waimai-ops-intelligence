<template>
  <div class="grid grid-2">
    <div class="card"><h3>总里程</h3><div ref="chartEl" class="chart"></div></div>
    <div class="card"><h3>里程概况</h3>
      <div class="metrics">
        <div class="metric-box"><div class="metric-title">总里程(km)</div><div class="kpi kpi-primary">{{fmt(totalKm)}}</div></div>
        <div class="metric-box"><div class="metric-title">骑手数</div><div class="kpi">{{riders}}</div></div>
      </div>
    </div>
    <div class="card full">
      <h3>里程排行</h3>
      <div class="scroll-y">
        <table class="table"><thead><tr><th>骑手</th><th>里程(km)</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="r in ranking" :key="r.rider">
              <td>{{r.rider}}</td><td>{{fmt(r.km)}}</td>
              <td>
                <span class="action-edit" style="margin-left:8px;color:#1A5FFF;cursor:pointer" @click="editMileage(r.rider)">修改</span>
                <span class="action-del-mile" style="margin-left:12px;color:#FF6B6B;cursor:pointer" @click="deleteMileage(r.rider)">删除</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import * as echarts from 'echarts';
import { fetchJSONRetry, postJSON } from '../services/api';
const chartEl = ref<HTMLDivElement|null>(null);
const totalKm = ref(0); const riders = ref(0);
const ranking = ref<{rider:string; km:number}[]>([]);
let timer: any = null;
function fmt(v: number){ return Number(v||0).toFixed(2); }
let chart: echarts.ECharts | null = null;
function load(){ if(navigator.onLine===false) return; fetchJSONRetry<any[]>(`tracks.json?limit=200`, 3, 400).then(list=>{
  const rows = Array.isArray(list)? list: [];
  totalKm.value = rows.reduce((a,x)=> a + Number(x.distance_km||0), 0);
  const agg: Record<string, number> = {};
  rows.forEach(x=>{ const nm = String(x.name||''); if(!nm) return; agg[nm] = (agg[nm]||0) + Number(x.distance_km||0); });
  const rk = Object.entries(agg).map(([r,k])=>({rider:r, km:k})).sort((a,b)=> b.km - a.km);
  ranking.value = rk;
  riders.value = rk.length;
  if(chartEl.value){
    nextTick(()=>{
      const w=chartEl.value!.clientWidth,h=chartEl.value!.clientHeight; if(!w||!h){ setTimeout(load,120); return; }
      if(!chart){ chart = echarts.init(chartEl.value!); }
      const topAgg = [...ranking.value].sort((a,b)=>b.km-a.km).slice(0,10);
      chart.setOption({ grid:{left:60,right:20,top:20,bottom:24,containLabel:true}, xAxis:{type:'value'}, yAxis:{type:'category',data:topAgg.map(x=>x.rider)}, series:[{type:'bar',data:topAgg.map(x=>Number(fmt(x.km))), itemStyle:{color:'#5B8CFF'}}] });
    });
  }
}).catch(()=>{}); }
onMounted(()=>{ load(); timer = setInterval(()=>{ load(); }, 8000); });
onBeforeUnmount(()=>{ if(timer){ try{ clearInterval(timer); }catch(e){} timer=null; } });

function editMileage(name: string){
  const date = prompt('请输入日期(YYYY-MM-DD)','');
  if(!date) return;
  const v = prompt('请输入里程(公里)','');
  if(!v) return;
  const km = parseFloat(v)||0;
  postJSON('mileage/update', { rider:name, date, km }).then(()=>{ load(); }).catch(()=>{});
}
function deleteMileage(name: string){
  postJSON('mileage/delete-by-rider', { rider:name }).then(()=>{ load(); }).catch(()=>{});
}
</script>

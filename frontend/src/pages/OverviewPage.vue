<template>
  <section class="page visible">
    <div class="grid grid-3">
      <div class="card">
        <h3>今日订单</h3>
        <div class="kpi kpi-primary">{{kpi.orders}}</div>
        <div ref="chartEl" class="chart"></div>
      </div>
      <div class="card">
        <h3>在线骑手</h3>
        <div class="kpi kpi-success">{{kpi.onlineRiders}}</div>
        <div class="subtext">较昨日 {{onlineChange}}</div>
      </div>
      <div class="card">
        <h3>异常告警</h3>
        <div class="kpi kpi-danger">{{kpi.alerts}}</div>
        <div class="subtext">配送延迟、偏航</div>
      </div>
    </div>
    <WeatherBox :center="center" />
    <div class="card full">
      <h3>地图</h3>
      <div class="chart" style="height:360px">
        <MapView :center="center" :riders="riders" :alerts="alerts" @center-changed="$emit('center-changed', $event)" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import * as echarts from 'echarts';
import { fetchJSONRetry } from '../services/api';
import WeatherBox from '../components/WeatherBox.vue';
import MapView from '../components/MapView.vue';

type LngLat = [number, number];
const props = defineProps<{ center: LngLat; riders: {name:string;pos:LngLat}[]; alerts: {key:string;pos:LngLat}[]; overview?: any }>();
defineEmits<{(e:'center-changed', center: LngLat): void}>();

const chartEl = ref<HTMLDivElement|null>(null);
const kpi = ref({orders: 0, onlineRiders: 0, alerts: 0, onlineRidersChange: 0});
const onlineChange = computed(()=>{
  const v = Math.round((kpi.value.onlineRidersChange || 0)*1000)/10;
  const sign = v>0?'+':'';
  return sign + v + '%';
});

onMounted(()=>{
  const data = props.overview;
  const load = (data?: any)=>{
    try{
      if(data?.kpi){ kpi.value = data.kpi; }
      if(chartEl.value && data?.chart){
        const chart = echarts.init(chartEl.value);
        const color = {type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#1A5FFF'},{offset:1,color:'#7A5CFA'}]};
        chart.setOption({
          animationDuration:700,
          animationDurationUpdate:300,
          animationEasing:'cubicOut',
          grid:{left:40,right:24,top:20,bottom:24,containLabel:true},
          tooltip:{trigger:'axis'},
          xAxis:{type:'category',boundaryGap:false,data:data.chart.labels||[]},
          yAxis:{type:'value',axisLabel:{margin:8}},
          series:[{name:'订单量',type:'line',smooth:true,data:data.chart.orders||[],lineStyle:{width:3,color:color},areaStyle:{color:color}}]
        });
      }
    }catch(e){}
  };
  if(data){ load(data); } else { fetchJSONRetry<any>('overview.json').then(load).catch(()=>{}); }
});
</script>

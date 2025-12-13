<template>
  <div ref="mapEl" class="map"></div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, defineEmits, defineProps } from 'vue';
import AMapLoader from '@amap/amap-jsapi-loader';
import * as echarts from 'echarts';
import 'echarts-extension-amap';

type LngLat = [number, number];
type RiderPoint = { name: string; pos: LngLat };
type AlertPoint = { key: string; pos: LngLat };

const props = defineProps<{ center: LngLat; riders: RiderPoint[]; alerts: AlertPoint[] }>();
const emit = defineEmits<{ (e:'center-changed', center: LngLat): void }>();

const mapEl = ref<HTMLDivElement | null>(null);
let map: AMap.Map | null = null;
let chart: echarts.ECharts | null = null;
let riderMarkers: Record<string, AMap.Marker> = {};
let alertMarkers: Record<string, AMap.Marker> = {};
let ro: ResizeObserver | null = null;
let keepAlive: any = null;
let amapOnce: Promise<any> | null = null;

function getKey(){
  const cfg: any = (window as any).APP_CONFIG || {};
  if (cfg.AMAP_SECURITY_JS) {
    (window as any)._AMapSecurityConfig = { securityJsCode: cfg.AMAP_SECURITY_JS };
  }
  return cfg.AMAP_KEY || '';
}

async function initMap(){
  const key = getKey();
  if(!amapOnce){ amapOnce = AMapLoader.load({ key, version: '2.0', plugins: ['AMap.Scale','AMap.Geocoder','AMap.Weather','AMap.CitySearch'] }); }
  const AMap = await amapOnce;
  if(!mapEl.value) return;
  chart = echarts.init(mapEl.value);
  chart.setOption({
    amap: {
      center: props.center,
      zoom: 12,
      resizeEnable: true,
      renderOnMoving: true
    },
    tooltip: { trigger: 'item', formatter: function(p:any){ return '告警：'+(p.name||'未知'); } },
    series: [
      { id:'alerts', name:'异常告警', type:'effectScatter', coordinateSystem:'amap', rippleEffect:{scale:3}, symbolSize:10, itemStyle:{color:'#FF6B6B'}, data: [] }
    ]
  });
  const amapComp = (chart as any).getModel().getComponent('amap');
  const amapInst: AMap.Map = amapComp.getAMap();
  map = amapInst;
  map.on('moveend', ()=>{
    const c = map!.getCenter();
    emit('center-changed', [c.getLng(), c.getLat()]);
  });
  amapInst.addControl(new (window as any).AMap.Scale());
  try {
    ro = new ResizeObserver(()=>{ try { chart?.resize(); map?.resize(); } catch(e){} });
    if(mapEl.value) ro.observe(mapEl.value);
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible'){
        try { chart?.resize(); const c = map!.getCenter(); map!.setCenter(c); } catch(e){}
      }
    });
    keepAlive = setInterval(()=>{
      if(document.visibilityState==='visible'){
        try { const c = map!.getCenter(); map!.setCenter(c); } catch(e){}
      }
    }, 15000);
  } catch(e){}
}

function syncRiders(){
  if(!map) return;
  const nextKeys: Record<string, RiderPoint> = {};
  props.riders.forEach(r=>{ nextKeys[r.name] = r; });
  Object.keys(riderMarkers).forEach(name=>{
    if(!nextKeys[name]){ riderMarkers[name].setMap(null); delete riderMarkers[name]; }
  });
  props.riders.forEach(r=>{
    const pos = r.pos as any;
    if(riderMarkers[r.name]){ riderMarkers[r.name].setPosition(pos); }
    else { riderMarkers[r.name] = new (window as any).AMap.Marker({ map, position: pos }); }
  });
}

function syncAlerts(){
  if(chart){
    const data = props.alerts.map(a=>({ value:[a.pos[0], a.pos[1]], name:a.key }));
    chart.setOption({ series:[{ id:'alerts', data }] }, { notMerge:false });
  }
}

watch(()=>props.center, (c)=>{ if(map) map.setCenter(c as any); if(chart){ chart.setOption({ amap:{ center:c } }); } });
watch(()=>props.riders, ()=> syncRiders(), { deep: true });
watch(()=>props.alerts, ()=> syncAlerts(), { deep: true });

onMounted(()=>{ initMap().then(()=>{ syncRiders(); syncAlerts(); }); });
onBeforeUnmount(()=>{ chart?.dispose(); chart=null; map?.destroy(); map=null; try{ ro?.disconnect(); ro=null; }catch(e){}; if(keepAlive){ try{ clearInterval(keepAlive); }catch(e){} keepAlive=null; } });
</script>

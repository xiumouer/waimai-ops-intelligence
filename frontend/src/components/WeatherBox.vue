<template>
  <div class="card weather-card full">
    <div class="weather-header">
      <h3>天气提醒</h3>
      <div style="display:flex;gap:8px;align-items:center">
        <input ref="cityInput" type="text" placeholder="输入城市，如 北京" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
        <button class="btn btn-primary btn-sm" @click="applyCity">切换城市</button>
        <button class="btn btn-primary btn-sm" @click="refreshWeather">更新天气</button>
      </div>
    </div>
    <div class="weather-grid">
      <div class="weather-metrics">
        <div class="metric"><span class="label">温度</span><span>{{temp}}°C</span></div>
        <div class="metric"><span class="label">湿度</span><span>{{humidity}}%</span></div>
        <div class="metric"><span class="label">天气</span><span>{{text}}</span></div>
        <div class="metric"><span class="label">风力</span><span>{{windpower}}</span></div>
        <div class="subtext">位置来源：高德地图 · <span>{{city}}</span></div>
      </div>
      <div class="weather-tips">
        <h4>今日出行建议</h4>
        <div class="tip-box">{{tip}}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import AMapLoader from '@amap/amap-jsapi-loader';

type LngLat = [number, number];
const props = defineProps<{ center: LngLat }>();
const cityInput = ref<HTMLInputElement|null>(null);
const city = ref('');
const temp = ref('--');
const text = ref('--');
const humidity = ref('--');
const windpower = ref('--');
const tip = ref('');
let amapOnce: Promise<any> | null = null;
let lastRefresh = 0;

function riderTip(live: any){
  const t = parseFloat(live?.temperature||'0');
  const wp = parseFloat(String(live?.windpower||'0').replace('级',''))||0;
  const we = String(live?.weather||'');
  const h = parseFloat(live?.humidity||'0');
  if(/雨|雷/.test(we)) return '降雨注意穿戴雨具，减速慢行';
  if(/雪/.test(we)) return '路面湿滑，注意防滑与保暖';
  if(/雾|霾/.test(we)) return '能见度低，注意减速与灯光';
  if(t>=33) return '高温作业注意补水与轮休';
  if(t<=12) return '气温偏凉，建议长袖外套 注意保暖';
  if(wp>=6) return '风力较大，注意防风与避险';
  if(h<=30) return '空气干燥，适当补水';
  return '注意安全，合理安排休息与补水';
}

function getKey(){
  const cfg: any = (window as any).APP_CONFIG || {};
  if (cfg.AMAP_SECURITY_JS) {
    (window as any)._AMapSecurityConfig = { securityJsCode: cfg.AMAP_SECURITY_JS };
  }
  return cfg.AMAP_KEY || '';
}

async function refreshByCenter(AMap: any){
  const geocoder = new AMap.Geocoder();
  const weather = new AMap.Weather();
  const c = props.center;
  const ll = new AMap.LngLat(c[0], c[1]);
  geocoder.getAddress(ll, function(status: string, result: any){
    const comp = (status==='complete'&&result&&result.regeocode&&result.regeocode.addressComponent)||{};
    const adcode = comp.adcode || '110000';
    const cityName = comp.city || comp.province || '';
    city.value = String(cityName||'');
    weather.getLive(adcode, function(err: any, live: any){
      if(err){ tip.value = '天气服务暂时不可用'; return; }
      temp.value = String(live.temperature||'--');
      text.value = String(live.weather||'');
      humidity.value = String(live.humidity||'--');
      windpower.value = String(live.windpower||'--');
      tip.value = riderTip(live);
    });
  });
}

async function refreshWeather(){
  const now = Date.now();
  if(now - lastRefresh < 8000) return;
  lastRefresh = now;
  if(!amapOnce){ amapOnce = AMapLoader.load({ key: getKey(), version: '2.0', plugins: ['AMap.Geocoder','AMap.Weather','AMap.CitySearch'] }); }
  const AMap = await amapOnce;
  const name = cityInput.value?.value?.trim();
  if(name){
    const geocoder = new AMap.Geocoder();
    const weather = new AMap.Weather();
    geocoder.getLocation(name, function(status: string, res: any){
      if(status==='complete' && res && res.geocodes && res.geocodes[0]){
        const gc = res.geocodes[0];
        const adcode = gc.adcode || '110000';
        const cityName = gc.city || gc.formattedAddress || name;
        city.value = String(cityName||'');
        weather.getLive(adcode, function(err: any, live: any){
          if(err){ tip.value = '天气服务暂时不可用'; return; }
          temp.value = String(live.temperature||'--');
          text.value = String(live.weather||'');
          humidity.value = String(live.humidity||'--');
          windpower.value = String(live.windpower||'--');
          tip.value = riderTip(live);
        });
      }
    });
  } else {
    await refreshByCenter(await amapOnce);
  }
}

function applyCity(){ refreshWeather(); }

onMounted(()=>{ refreshWeather(); });
watch(()=>props.center, async ()=>{
  try {
    const AMap = await (amapOnce || (amapOnce = AMapLoader.load({ key: getKey(), version: '2.0', plugins: ['AMap.Geocoder','AMap.Weather'] })));
    await refreshByCenter(AMap);
  } catch(e){}
});
</script>

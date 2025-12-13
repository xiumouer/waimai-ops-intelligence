<template>
  <div class="card head full">
    <h3>订单监控
      <span style="margin-left:12px"><button class="btn btn-sm" @click="generateOrders" title="生成订单、轨迹、骑手、告警等全链路模拟数据">生成全链路模拟数据(100)</button></span>
      <span style="margin-left:auto;display:inline-flex;gap:8px;align-items:center">
        <input v-model="q" placeholder="搜索订单/骑手" style="height:28px;border-radius:4px;border:1px solid #E9ECEF;padding:0 8px;font-size:12px">
      </span>
  </h3>
    <div class="scroll-y">
      <table class="table"><thead><tr><th>订单号</th><th>骑手</th><th>状态</th><th>预计送达</th></tr></thead>
        <tbody>
          <tr v-for="o in filtered" :key="o.id" @click="focusOrder(o)" :class="{'row-warning': o.status==='延迟'}">
            <td>{{o.id}}</td>
            <td>{{o.rider}}</td>
            <td><span class="tag" :class="tagClass(o.status)">{{o.status}}</span></td>
            <td>{{o.eta}}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="card full">
    <h3>异常告警</h3>
    <div class="list scroll-y-sm">
      <div class="list-item" v-for="a in alerts" :key="a.key" @click="focusAlert(a)">
        <span>[{{a.type||'告警'}}] {{a.key}}</span>
        <span class="tag" :class="(a.type==='偏航')?'tag-danger':'tag-warning'">{{a.type||'告警'}}</span>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { fetchJSON, fetchJSONRetry } from '../services/api';
type LngLat = [number, number];
const props = defineProps<{ riders: {name:string;pos:LngLat}[]; alerts: {key:string;pos:LngLat;type?:string}[]; orders?: any[] }>();
const emit = defineEmits<{ (e:'focus', center: LngLat): void }>();
type Order = { id:string; rider:string; status:string; eta:string };
const orders = ref<Order[]>([]);
const q = ref('');
const filtered = computed(()=>{ const s = q.value.trim(); if(!s) return orders.value; const rx = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); return orders.value.filter(o=> rx.test(o.id)||rx.test(o.rider)||rx.test(o.status)); });
function load(){ fetchJSONRetry<Order[]>('orders.json',3,400).then(r=>orders.value=r).catch(()=>{}); }
onMounted(()=>{
  if(Array.isArray(props.orders) && props.orders.length){ orders.value = props.orders as any; }
  else { load(); }
});
function focusOrder(o: Order){
  const r = props.riders.find(x=>x.name===o.rider);
  if(r) emit('focus', r.pos);
}
function focusAlert(a: {key:string;pos:LngLat}){ emit('focus', a.pos); }
function tagClass(s: string){ if(s==='配送中') return 'tag-success'; if(s==='延迟') return 'tag-warning'; if(s==='待取餐') return 'tag-info'; return 'tag-muted'; }
function generateOrders(){ fetchJSON('generate-orders?count=100&hours=6').then(()=>{ load(); alert('模拟数据已生成，各页面数据将同步更新'); }).catch(()=>{}); }
</script>

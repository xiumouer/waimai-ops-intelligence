import { createApp } from 'vue';
import RiderClient from './pages/RiderClient.vue';
import './styles.css';

const app = createApp(RiderClient);
app.mount('#rider-app');


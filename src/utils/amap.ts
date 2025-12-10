// Simple AMap JS API loader over HTTPS
export async function loadAMap(): Promise<any> {
  const w = window as any;
  if (w.AMap) return w.AMap;
  const key = (import.meta as any).env?.VITE_AMAP_KEY || w.__AMAP_KEY__;
  const securityJs = (import.meta as any).env?.VITE_AMAP_SECURITY_JS || w.__AMAP_SECURITY_JS__;
  if (!key) {
    throw new Error('缺少高德地图 Key：请在 .env 中设置 VITE_AMAP_KEY 或在 window.__AMAP_KEY__ 中提供');
  }
  return new Promise((resolve, reject) => {
    if (securityJs) {
      w._AMapSecurityConfig = { securityJsCode: securityJs };
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.ToolBar,AMap.Scale,AMap.Geolocation,AMap.MouseTool,AMap.PolygonEditor,AMap.Driving,AMap.Geocoder,AMap.Weather`;
    script.async = true;
    script.onload = () => resolve(w.AMap);
    script.onerror = () => reject(new Error('高德地图脚本加载失败'));
    document.head.appendChild(script);
  });
}

// Driving ETA helper with simple in-memory cache
import type { GeoPoint } from '../types';
const _driveCache = new Map<string, number>(); // key: oLng,oLat->dLng,dLat ; value: minutes

function _key(o: GeoPoint, d: GeoPoint) {
  const fmt = (x: number) => x.toFixed(5); // reduce cache keys
  return `${fmt(o.lng)},${fmt(o.lat)}->${fmt(d.lng)},${fmt(d.lat)}`;
}

export async function getDrivingTimeMinutes(origin: GeoPoint, dest: GeoPoint): Promise<number | null> {
  const key = _key(origin, dest);
  if (_driveCache.has(key)) return _driveCache.get(key)!;
  try {
    const AMap = await loadAMap();
    return await new Promise<number | null>((resolve) => {
      const driving = new (AMap as any).Driving({ policy: (AMap as any).DrivingPolicy.LEAST_TIME });
      driving.search([origin.lng, origin.lat], [dest.lng, dest.lat], (status: string, result: any) => {
        if (status === 'complete' && result && result.routes && result.routes[0]) {
          const sec = result.routes[0].time; // seconds
          const min = Math.max(1, Math.round(sec / 60));
          _driveCache.set(key, min);
          resolve(min);
        } else {
          resolve(null);
        }
      });
    });
  } catch {
    return null;
  }
}

export type AMapWeather = {
  temperature: number | null;
  humidity: number | null;
  weather: string | null;
  windLevel: number | null;
  city: string | null;
};

export async function fetchAMapWeatherByPoint(point: GeoPoint): Promise<AMapWeather | null> {
  const w = window as any;
  const key = (import.meta as any).env?.VITE_AMAP_KEY || w.__AMAP_KEY__;
  if (!key) {
    throw new Error('缺少高德 Key：请在 .env/.env.local 设置 VITE_AMAP_KEY');
  }
  try {
    const AMap = await loadAMap();
    return await new Promise<AMapWeather | null>((resolve) => {
      (AMap as any).plugin(['AMap.Geocoder', 'AMap.Weather'], () => {
        const geocoder = new (AMap as any).Geocoder();
        geocoder.getAddress([point.lng, point.lat], (status: string, result: any) => {
          if (status !== 'complete' || !result?.regeocode?.addressComponent) {
            resolve(null);
            return;
          }
          const comp = result.regeocode.addressComponent;
          const adcode = comp.adcode as string | undefined;
          const cityName = comp.city || comp.province || null;
          const weather = new (AMap as any).Weather();
          weather.getLive(adcode || cityName, (err: any, data: any) => {
            if (err || !data) { resolve(null); return; }
            const temp = data.temperature != null ? Number(data.temperature) : null;
            const hum = data.humidity != null ? Number(data.humidity) : null;
            const desc = data.weather ?? null;
            let windLevel: number | null = null;
            const wp = data.windPower as string | undefined;
            if (wp) {
              const m = wp.match(/\d+/);
              windLevel = m ? Number(m[0]) : null;
            }
            resolve({ temperature: isNaN(temp as any) ? null : temp, humidity: isNaN(hum as any) ? null : hum, weather: desc, windLevel, city: cityName });
          });
        });
      });
    });
  } catch {
    return null;
  }
}

export type ReverseGeocodeInfo = {
  formattedAddress: string | null;
  addressComponent: {
    province?: string | null;
    city?: string | null;
    district?: string | null;
    township?: string | null;
    street?: string | null;
    number?: string | null;
    adcode?: string | null;
  };
  roads: Array<{ name: string; distance?: number; direction?: string }>;
  pois: Array<{ name: string; type?: string; distance?: number; location?: { lat: number; lng: number } }>;
  businessAreas: Array<{ name: string; location?: { lat: number; lng: number } }>;
};

export async function reverseGeocodeRich(point: GeoPoint): Promise<ReverseGeocodeInfo | null> {
  const w = window as any;
  const key = (import.meta as any).env?.VITE_AMAP_KEY || w.__AMAP_KEY__;
  if (!key) return null;
  try {
    const AMap = await loadAMap();
    return await new Promise<ReverseGeocodeInfo | null>((resolve) => {
      (AMap as any).plugin(['AMap.Geocoder'], () => {
        const geocoder = new (AMap as any).Geocoder({ extensions: 'all', radius: 60, batch: false });
        geocoder.getAddress([point.lng, point.lat], (status: string, result: any) => {
          if (status !== 'complete' || !result?.regeocode) { resolve(null); return; }
          const r = result.regeocode;
          const comp = r.addressComponent || {};
          const roads = Array.isArray(r.roads) ? r.roads.map((x: any) => ({ name: x.name, distance: x.distance, direction: x.direction })) : [];
          const pois = Array.isArray(r.pois) ? r.pois.map((p: any) => ({ name: p.name, type: p.type, distance: p.distance, location: p.location ? { lat: p.location.lat, lng: p.location.lng } : undefined })) : [];
          const bas = Array.isArray(comp.businessAreas) ? comp.businessAreas.map((b: any) => ({ name: b.name, location: b.location ? { lat: b.location.lat, lng: b.location.lng } : undefined })) : [];
          resolve({
            formattedAddress: r.formattedAddress || null,
            addressComponent: {
              province: comp.province || null,
              city: comp.city || null,
              district: comp.district || null,
              township: comp.township || null,
              street: comp.streetNumber?.street || null,
              number: comp.streetNumber?.number || null,
              adcode: comp.adcode || null,
            },
            roads,
            pois,
            businessAreas: bas,
          });
        });
      });
    });
  } catch {
    try {
      const loc = `${point.lng},${point.lat}`;
      const url = `https://restapi.amap.com/v3/geocode/regeo?location=${encodeURIComponent(loc)}&key=${encodeURIComponent(key)}&extensions=all&radius=150&batch=false`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const r = json?.regeocode;
      if (!r) return null;
      const comp = r.addressComponent || {};
      const roads = Array.isArray(r.roads) ? r.roads.map((x: any) => ({ name: x.name, distance: x.distance, direction: x.direction })) : [];
      const pois = Array.isArray(r.pois) ? r.pois.map((p: any) => ({ name: p.name, type: p.type, distance: p.distance, location: p.location ? { lat: Number(p.location.split(',')[1]), lng: Number(p.location.split(',')[0]) } : undefined })) : [];
      const bas = Array.isArray(comp.businessAreas) ? comp.businessAreas.map((b: any) => ({ name: b.name, location: b.location ? { lat: Number(b.location.split(',')[1]), lng: Number(b.location.split(',')[0]) } : undefined })) : [];
      return {
        formattedAddress: r.formattedAddress || null,
        addressComponent: {
          province: comp.province || null,
          city: comp.city || null,
          district: comp.district || null,
          township: comp.township || null,
          street: comp.streetNumber?.street || null,
          number: comp.streetNumber?.number || null,
          adcode: comp.adcode || null,
        },
        roads,
        pois,
        businessAreas: bas,
      };
    } catch {
      return null;
    }
  }
}

export async function getPreciseLocation(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  try {
    const AMap = await loadAMap();
    return await new Promise((resolve) => {
      (AMap as any).plugin(['AMap.Geolocation'], () => {
        const geo = new (AMap as any).Geolocation({
          enableHighAccuracy: true,
          timeout: 12000,
          convert: true,
        });
        geo.getCurrentPosition((status: string, result: any) => {
          if (status === 'complete' && result && result.position) {
            const p = result.position;
            const acc = result.accuracy as number | undefined;
            resolve({ lat: p.lat, lng: p.lng, accuracy: acc });
          } else {
            resolve(null);
          }
        });
      });
    });
  } catch {
    try {
      return await new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          resolve({ lat: latitude, lng: longitude, accuracy });
        }, () => resolve(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
      });
    } catch {
      return null;
    }
  }
}

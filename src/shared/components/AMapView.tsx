import React, { useEffect, useRef, useState } from 'react';
import { loadAMap } from '../../utils/amap';
import type { Order } from '../../types';

type AreaInfo = { name: string; polygons: [number, number][][] };

type Props = {
  orders: Order[];
  userLocation?: { lat: number; lng: number } | null;
  zoom?: number;
  style?: React.CSSProperties;
  // 自定义画区
  drawCommand?: 'start' | 'finish' | 'clear';
  onCustomAreasChange?: (areas: AreaInfo[]) => void;
};

export default function AMapView({ orders, userLocation, zoom = 12, style, drawCommand, onCustomAreasChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mouseToolRef = useRef<any>(null);
  const customOverlaysRef = useRef<any[]>([]);
  const customAreasRef = useRef<AreaInfo[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let map: any;
    let destroyed = false;
    (async () => {
      try {
        const AMap = await loadAMap();
        if (!ref.current) return;
        const center = userLocation
          ? [userLocation.lng, userLocation.lat]
          : orders.length
            ? [orders[0].merchant.lng, orders[0].merchant.lat]
            : [121.4737, 31.2304]; // 上海

        map = new AMap.Map(ref.current, {
          viewMode: '2D',
          zoom: zoom,
          center,
          mapStyle: 'amap://styles/dark',
        });
        mapRef.current = map;

        // 控件
        map.addControl(new AMap.ToolBar());
        map.addControl(new AMap.Scale());

        // 绘制订单样本（最多20条）
        const overlays: any[] = [];
        orders.slice(0, 20).forEach((o, idx) => {
          const mPos = [o.merchant.lng, o.merchant.lat];
          const cPos = [o.customer.lng, o.customer.lat];
          overlays.push(
            new AMap.Marker({ position: mPos }),
            new AMap.Marker({ position: cPos }),
            new AMap.Polyline({
              path: [mPos, cPos],
              strokeColor: idx % 2 ? '#22d3ee' : '#34d399',
              strokeOpacity: 0.9,
              strokeWeight: 3,
            })
          );
        });
        if (userLocation) {
          overlays.push(
            new AMap.Circle({
              center: [userLocation.lng, userLocation.lat],
              radius: 80,
              strokeColor: '#f59e0b',
              fillColor: '#f59e0b',
              fillOpacity: 0.25,
            })
          );
        }
        map.add(overlays);

        // 标记地图就绪，允许绘制命令生效
        setMapReady(true);
      } catch (e) {
        console.error('AMap 初始化失败', e);
      }
    })();
    return () => {
      destroyed = true;
      if (map) map.destroy();
      setMapReady(false);
    };
  }, [orders, userLocation, zoom]);

  // 自定义画区命令处理
  useEffect(() => {
    (async () => {
      if (!drawCommand) return;
      // 地图就绪后再处理命令，避免早点击导致失效
      if (!mapRef.current) return;
      const AMap = await loadAMap();
      // 获取或创建 MouseTool
      if (!mouseToolRef.current) {
        mouseToolRef.current = new (AMap as any).MouseTool(mapRef.current);
      }
      const mouseTool = mouseToolRef.current;
      if (drawCommand === 'start') {
        // 开始画多边形（红色半透明）并切换光标提示
        mapRef.current?.setDefaultCursor('crosshair');
        mouseTool.polygon({
          strokeColor: '#ef4444',
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: '#ef4444',
          fillOpacity: 0.25,
        });
        // 防重复绑定（如果支持 off）
        (mouseTool as any).off?.('draw');
        mouseTool.on('draw', (e: any) => {
          const overlay = e.obj; // AMap.Polygon
          customOverlaysRef.current.push(overlay);
          const path = overlay.getPath();
          const poly: [number, number][] = path.map((p: any) => [p.getLng(), p.getLat()]);
          const name = `自定义区域#${customAreasRef.current.length + 1}`;
          const area: AreaInfo = { name, polygons: [poly] };
          customAreasRef.current.push(area);
          if (onCustomAreasChange) onCustomAreasChange([...customAreasRef.current]);
        });
      } else if (drawCommand === 'finish') {
        // 结束当前绘制并恢复光标
        mouseTool.close(true);
        mapRef.current?.setDefaultCursor('default');
      } else if (drawCommand === 'clear') {
        // 清除所有自定义覆盖物并恢复光标
        customOverlaysRef.current.forEach(o => o.setMap(null));
        customOverlaysRef.current = [];
        customAreasRef.current = [];
        mapRef.current?.setDefaultCursor('default');
        if (onCustomAreasChange) onCustomAreasChange([]);
      }
    })();
  }, [drawCommand, mapReady]);

  return <div ref={ref} style={{ height: '100%', width: '100%', ...(style || {}) }} />;
}


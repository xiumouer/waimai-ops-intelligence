# 外卖运营数智平台

面向外卖配送业务的数智化可视化平台，聚合订单与资金数据，支持智能派单、骑手轨迹、风险监控、收入结算等核心场景，并集成高德地图的高精度定位与逆地理编码。

## 核心功能

- 概览：订单 KPI、天气提醒与骑手关怀
- 订单分析：环节耗时、配送时长分布、状态分布
- 地理分布：订单样本可视化、用户自定义区域绘制
- 骑手排名：效率排行、联系与出勤管理
- 风险监控：基于 ETA 的超时与进度风险
- 收入结算：骑手收入拆解与统计
- 智能派单：实时轨迹、路线建议、全局贪心分配（实验）
- 移动端联动：WebSocket 推送骑手定位，使网页端实时上屏

## 技术栈

- 前端：React 18、Vite 5、TypeScript、Recharts
- 地图：高德 JS API（Geolocation、Geocoder、Riding 等插件）
- 后端（可选）：Express + LowDB（`npm run server`）
- 移动端 Demo：Vite + 高德 JS + WebSocket（`map_test_Demo`）

## 快速开始

### 环境要求

- Node.js 18+
- 高德地图 Key（用于加载 JS API）

### 安装依赖

```bash
npm install
```

### 配置高德 Key

在项目根目录创建 `.env` 文件（或通过系统环境变量注入）：

```bash
VITE_AMAP_KEY=你的高德Key
VITE_AMAP_SECURITY_JS=你的安全校验码 # 可选
```

不建议将真实密钥提交到仓库。生产环境应通过安全配置注入。

### 启动前端

```bash
npm run dev
# 访问 http://localhost:5173/
```

前端在开发模式下会尝试请求 `/api/orders`；若未启动后端，将自动回退到 `public/data/orders.json` 与 `public/data/settlements.json`。

### 启动后端（可选）

```bash
npm run server
# API: http://localhost:3000/
```

初始化数据库数据（从 `public/data` 写入 DB）：

```bash
curl -X POST http://localhost:3000/api/ingest
```

### 启动移动端 WebSocket 服务（可选）

```bash
cd map_test_Demo
npm install
npm run ws        # 启动 ws://localhost:8080/
npm run dev       # 启动移动端 Demo 前端（默认 http://localhost:5173/）
```

在移动端 Demo 登录（使用手机号），并进行定位或地图点击，WS 服务会广播 `type='pos'` 的定位消息。网页端“智能派单”页选择同一骑手 ID（即手机号），即可实时接收位置、渲染轨迹与路线。

## 主要页面入口

- `src/main.tsx`：路由与页头品牌文案
- `src/pages/Overview.tsx`：概览与天气提醒
- `src/pages/OrdersAnalysis.tsx`：订单分析
- `src/pages/Geography.tsx`：地理分布与自定义区域
- `src/pages/RiderRanking.tsx`：骑手排名与出勤管理
- `src/pages/Risk.tsx`：风险监控
- `src/pages/Income.tsx`：收入结算
- `src/pages/Dispatch.tsx`：智能派单与实时轨迹
- `src/components/AMapView.tsx`：高德地图通用视图

## 地图与定位

- 高德 JS API 加载与使用：`src/utils/amap.ts`
- 高精度定位：优先使用 `AMap.Geolocation`，浏览器定位兜底
- 逆地理编码（丰富数据）：道路、兴趣点、商圈等（`reverseGeocodeRich`）
- 路网 ETA：按需调用路网行驶时间用于规划

## 数据加载策略

- 页面请求优先尝试 `/api/*`；若失败，自动回退到 `public/data/*` 的静态 JSON
- 后端提供筛选与数据写入，开发环境不强依赖后端即可查看效果

## 测试与构建

```bash
npm run test     # 运行单元测试（Vitest）
npm run build    # 生产构建
npm run preview  # 本地预览生产包
```

## 常见问题

- 天气服务不可用：前端内置备用源（Open-Meteo），会提示回退状态
- WebSocket 未连接：请确认 `map_test_Demo` 的 `npm run ws` 已运行，网页端派单页会显示连接状态
- 高德加载失败：检查 `.env` 中的 `VITE_AMAP_KEY` 是否正确，以及域名白名单是否包含当前访问域

## 版权与许可

本项目用于外卖配送运营场景的内部应用示例。涉及第三方服务（如高德地图）需遵循其使用条款与授权协议。


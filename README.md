# 外卖数智平台

一个开箱即用的外卖运营可视化平台，包含管理端、骑手端与本地 API。支持订单监控、概览指标、异常告警、里程与绩效分析等。

## 环境准备

- Python `3.10+`
- Node.js `18+`

## 快速开始

- 启动后端 API（默认端口 `8001`）：
  - `python server.py`
- 安装与启动前端（Vite，默认端口 `5173`）：
  - `cd frontend && npm install`
  - `npm run dev`
- 打开管理端页面：
  - `http://localhost:5173/`
- 打开骑手端页面：
  - `http://localhost:5173/rider.html`

## 配置说明

- 复制 `frontend/public/config.example.js` 为 `frontend/public/config.local.js`，并填写：
  - `AMAP_KEY` 与可选 `AMAP_SECURITY_JS`（高德 JS API 密钥）
  - `API_BASE` 指向后端，如 `http://localhost:8001/api`
- 开发模式下，前端已配置 Vite 代理（`/api` → `http://localhost:8001`），`API_BASE` 留空也可正常访问后端。

## 主要功能

- 概览：今日订单、在线骑手、异常告警，含最近 6 小时订单柱状图。
- 订单监控：列表联动地图定位，延迟订单弱高亮。
- 订单分析：时段分布、品类分析、转化漏斗。
- 里程管理与绩效排行：排行与里程统计。
- 骑手端：定位上报、模拟行走、轨迹提交。

## 数据生成与一致性

- 后端内置生成器，启动后按配置自动生成数据；新增骑手时自动回填初始数据。
- 统一的订单统计口径：各页面的“订单数”按订单创建时间（`created_ts`）统计；收入与准时率基于实际已送达订单计算。
- 常用接口：
  - `GET /api/generate-orders?count=500&hours=168` 生成近 7 天随机订单
  - `GET /api/sample/clear` 清空订单/结算/告警等数据表

## 后端 API（节选）

- 根路径：`http://localhost:8001/api`
- `GET /overview.json` 概览指标与图表
- `GET /orders.json` 订单列表（含 `eta`）
- `GET /riders.json` 骑手在线状态与位置
- `GET /alerts.json` 异常告警
- `GET /performance.json?start=...&end=...` 绩效数据
- `GET /mileage.json?start=...&end=...` 里程数据
- `POST /track-point`、`POST /tracks/submit` 轨迹上报
- `POST /rider-register`、`POST /rider-login` 骑手登记与登录

## 目录结构（简要）

- `server.py` 本地 API 服务（SQLite）
- `data.db` 本地数据库文件（自动创建，勿上传仓库）
- `backups/` 自动备份目录（勿上传仓库）
- `frontend/` 前端工程（Vite + Vue3）
  - `src/` 源码
  - `public/` 前端静态资源与配置（示例与本地配置）
  - `dist/` 构建产物（可忽略，CI/CD 或手动生成）

## 常见问题

- 页面无数据：确认 `server.py` 已启动；`frontend/public/config.local.js`的 `API_BASE` 或使用 Vite 代理。
- 地图不显示：确认 `AMAP_KEY` 有效；无 Key 时自动回退到二维坐标渲染。

## 发布到 GitHub 的文件建议

- 应上传：
  - 根目录：`server.py`、`README.md`、`config.example.js`、`init_config.py`、`inspect_db.py`、`scripts/`
  - 前端：`frontend/src/**`、`frontend/public/config.example.js`、`frontend/index.html`、`frontend/vite.config.ts`、`frontend/package.json`、`frontend/tsconfig.json`、`frontend/rider.html`
- 不应上传（已在 `.gitignore` 中忽略）：
  - `data.db`、`backups/`、`server.log`、`__pycache__/`、`*.pyc`
  - `frontend/node_modules/`、`frontend/dist/`
  - `frontend/public/config.local.js`（包含私钥/本地地址）

## 许可证

本项目示例用途，未附带许可证，按你的组织策略添加许可证文件。


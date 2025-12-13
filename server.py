"""外卖数智平台本地后端服务
提供管理端与骑手端需要的 REST API，使用 SQLite 持久化。
主要职责：
- 初始化并维护数据表
- 提供查询接口（概览、订单、骑手、告警、绩效、里程等）
- 接收骑手轨迹与事件上报
- 基础健康检查与启动备份、日志
"""
import json
import os
import sqlite3
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import logging
START_TS = int(time.time())
from urllib.parse import urlparse
from urllib.parse import parse_qs

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')

def init_db():
    """创建/迁移数据库结构并注入示例数据（首次空库）。"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS riders (name TEXT PRIMARY KEY, phone TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS live_points (name TEXT, lng REAL, lat REAL, ts INTEGER)')
    c.execute('CREATE TABLE IF NOT EXISTS tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, start_ts INTEGER, end_ts INTEGER, distance REAL, points TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, rider TEXT, status TEXT, created_ts INTEGER, pickup_ts INTEGER, delivered_ts INTEGER, eta_ts INTEGER, origin_lng REAL, origin_lat REAL, dest_lng REAL, dest_lat REAL, fee REAL, distance REAL)')
    c.execute('PRAGMA table_info(orders)')
    cols = [r[1] for r in c.fetchall()]
    if 'category' not in cols:
        try:
            c.execute('ALTER TABLE orders ADD COLUMN category TEXT')
        except Exception:
            pass
    c.execute('CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, ts INTEGER, type TEXT, meta TEXT)')
    c.execute('CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, rider TEXT, type TEXT, ts INTEGER, lng REAL, lat REAL, severity INTEGER)')
    c.execute('CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, rider TEXT, period_start_ts INTEGER, period_end_ts INTEGER, orders_count INTEGER, total_income REAL, subsidy REAL, penalties REAL, net_income REAL, generated_ts INTEGER)')
    c.execute('CREATE TABLE IF NOT EXISTS mileage_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, rider TEXT, date TEXT, distance REAL)')
    c.execute('CREATE TABLE IF NOT EXISTS performance_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, rider TEXT, date TEXT, on_time_rate REAL, accept_rate REAL, positive_rate REAL, orders_count INTEGER)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_live_points_name_ts ON live_points(name, ts)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_order_events_order_ts ON order_events(order_id, ts)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts)')
    c.execute('SELECT COUNT(*) FROM orders')
    if (c.fetchone()[0] or 0) == 0:
        from time import time
        now = int(time())
        sample = [
            ("OD20251210001","王明","配送中",now-3600,now-2400,None,now+1800,116.39,39.91,116.405,39.902,18.5,5.2,"快餐"),
            ("OD20251210002","李伟","延迟",now-5400,now-3000,None,now+2400,116.402,39.915,116.396,39.908,21.0,6.3,"奶茶"),
            ("OD20251210003","张强","待取餐",now-1800,None,None,now+1200,116.397,39.909,116.405,39.902,12.0,3.1,"咖啡")
        ]
        c.execute('PRAGMA table_info(orders)')
        cols = [r[1] for r in c.fetchall()]
        if 'category' in cols:
            c.executemany('INSERT INTO orders (id,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,origin_lng,origin_lat,dest_lng,dest_lat,fee,distance,category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', sample)
        else:
            c.executemany('INSERT INTO orders (id,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,origin_lng,origin_lat,dest_lng,dest_lat,fee,distance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [s[:-1] for s in sample])
    conn.commit()
    conn.close()
    
    # Ensure generator thread starts if enabled
    if generator_cfg.get('enabled'):
        global generator_thread
        if generator_thread is None or not generator_thread.is_alive():
            generator_thread = threading.Thread(target=_generator_loop, daemon=True)
            generator_thread.start()

def stable_phone(name: str) -> str:
    base = sum(ord(ch) for ch in (name or '')) % 100000000
    return '139' + f"{base:08d}"

def db():
    return sqlite3.connect(DB_PATH)

def cors_headers(handler):
    """为所有 API 响应设置基础 CORS 头。"""
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')

# --- generator config & helpers ---
generator_cfg = {'enabled': True, 'rate': 5, 'hours': 24, 'interval': 1, 'ai': True}
generator_thread = None

def insert_random_orders(count: int, hours: int, specific_riders=None):
    import random
    now = int(time.time())
    default_riders = ['王明','李伟','张强','赵敏','陈刚','刘洋']
    cats = ['快餐','奶茶','咖啡','轻食']
    statuses = ['待取餐','配送中','延迟','已送达']
    conn = db()
    c = conn.cursor()
    
    # 1. Ensure riders exist
    for r in default_riders:
        c.execute('INSERT OR IGNORE INTO riders (name, phone) VALUES (?, ?)', (r, stable_phone(r)))

    if specific_riders:
        riders = specific_riders
    else:
        # Fetch all riders
        try:
            c.execute('SELECT name FROM riders')
            all_riders = [r[0] for r in c.fetchall() if r[0]]
        except Exception:
            all_riders = []
        
        riders = all_riders if all_riders else default_riders

    try:
        c.execute('PRAGMA table_info(orders)')
        has_cat = any(r[1]=='category' for r in c.fetchall())
    except Exception:
        has_cat = False

    for i in range(max(0,int(count))):
        oid = 'OD'+str(now)+str(random.randint(0,9999)).zfill(4)
        rider = random.choice(riders)
        status = random.choice(statuses)
        created_ts = now - random.randint(0,max(1,int(hours))*3600)
        
        pickup_ts = None
        delivered_ts = None
        
        if status != '待取餐':
            pickup_ts = created_ts + random.randint(300,1800)
        
        if status == '已送达':
            delivered_ts = created_ts + random.randint(1800,7200)
            if pickup_ts and delivered_ts < pickup_ts:
                delivered_ts = pickup_ts + 300

        eta_ts = created_ts + random.randint(1800,7200)
        olng,olat = 116.39+random.random()*0.02,39.90+random.random()*0.02
        dlng,dlat = 116.40+random.random()*0.02,39.91+random.random()*0.02
        fee = round(10+random.random()*15,2)
        distance = round(2+random.random()*6,2)
        category = random.choice(cats)
        
        # Insert Order
        if has_cat:
            c.execute('INSERT OR REPLACE INTO orders (id,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,origin_lng,origin_lat,dest_lng,dest_lat,fee,distance,category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (oid,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,olng,olat,dlng,dlat,fee,distance,category))
        else:
            c.execute('INSERT OR REPLACE INTO orders (id,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,origin_lng,origin_lat,dest_lng,dest_lat,fee,distance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (oid,rider,status,created_ts,pickup_ts,delivered_ts,eta_ts,olng,olat,dlng,dlat,fee,distance))

        # 2. Generate Track if delivered
        if status == '已送达' and pickup_ts and delivered_ts:
            # Simulate a track
            track_dist = distance * (1.0 + random.random() * 0.3) * 1000 # meters
            c.execute('INSERT INTO tracks (name, phone, start_ts, end_ts, distance, points) VALUES (?, ?, ?, ?, ?, ?)',
                      (rider, stable_phone(rider), int(pickup_ts*1000), int(delivered_ts*1000), track_dist, json.dumps([])))

        # 3. Update Live Point (simulate current location)
        if status in ['配送中', '延迟', '待取餐']:
            # Random location around center
            clng = 116.40 + (random.random() - 0.5) * 0.05
            clat = 39.91 + (random.random() - 0.5) * 0.05
            c.execute('INSERT OR REPLACE INTO live_points (name, lng, lat, ts) VALUES (?, ?, ?, ?)',
                      (rider, clng, clat, int(now*1000)))

    conn.commit()
    conn.close()

def _generator_loop():
    while generator_cfg['enabled']:
        try:
            base = max(0, int(generator_cfg.get('rate', 0)))
            hours = max(1, int(generator_cfg.get('hours', 1)))
            use_ai = bool(generator_cfg.get('ai', True))
            now = time.localtime()
            mult = 1.0
            if use_ai:
                h = now.tm_hour
                m = now.tm_min
                import math
                mult = 0.6 + 0.4*math.sin((m/60.0)*2*math.pi)
                if 11 <= h <= 13:
                    mult *= 2.2
                elif 17 <= h <= 20:
                    mult *= 2.6
                elif 0 <= h <= 6:
                    mult *= 0.3
            count = int(round(base * mult))
            insert_random_orders(count, hours)
        except Exception:
            pass
        time.sleep(max(1, int(generator_cfg.get('interval', 5))) * 60)

class Handler(BaseHTTPRequestHandler):
    """HTTP 请求处理器：路由 GET/POST 到具体方法。"""
    def do_OPTIONS(self):
        self.send_response(204)
        cors_headers(self)
        self.end_headers()

    def do_GET(self):
        """GET 路由：只读接口与健康检查。"""
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)
            try:
                logging.info(f"GET {path}")
            except Exception:
                pass
            if path == '/api/riders.json':
                return self.get_riders()
            if path == '/api/overview.json':
                return self.get_overview()
            if path == '/api/orders.json':
                return self.get_orders()
            if path == '/api/analytics.json':
                return self.get_analytics()
            if path == '/api/generate-orders':
                return self.generate_orders(qs)
            if path == '/api/sample/generate':
                return self.sample_generate(qs)
            if path == '/api/sample/clear':
                return self.sample_clear()
            if path == '/api/sample/status':
                return self.sample_status()
            if path == '/api/alerts.json':
                return self.get_alerts()
            if path == '/api/settlements.json':
                return self.get_settlements(qs)
            if path == '/api/performance.json':
                return self.get_performance(qs)
            if path == '/api/mileage.json':
                return self.get_mileage(qs)
            if path == '/api/tracks.json':
                return self.get_tracks(qs)
            if path == '/api/rider-register':
                name = (qs.get('name',[""])[0] or '').strip()
                phone = (qs.get('phone',[""])[0] or '').strip()
                return self.post_rider_register({'name': name, 'phone': phone})
            if path == '/api/rider-login':
                name = (qs.get('name',[""])[0] or '').strip()
                phone = (qs.get('phone',[""])[0] or '').strip()
                return self.post_rider_login({'name': name, 'phone': phone})
            if path == '/api/healthz':
                return self.get_health()
            self.send_response(404)
            cors_headers(self)
            self.end_headers()
        except Exception as e:
            try:
                logging.exception(e)
            except Exception:
                pass
            return self.json_status(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        """POST 路由：数据写入与上报、生成器控制等。"""
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(length) if length > 0 else b''
            try:
                payload = json.loads(body.decode('utf-8')) if body else {}
            except Exception:
                payload = {}
            try:
                logging.info(f"POST {path} len={len(body)}")
            except Exception:
                pass
            if path == '/api/rider-register':
                return self.post_rider_register(payload)
            if path == '/api/rider-login':
                return self.post_rider_login(payload)
            if path == '/api/track-point':
                return self.post_track_point(payload)
            if path == '/api/tracks/submit':
                return self.post_track_submit(payload)
            if path == '/api/order-upsert':
                return self.post_order_upsert(payload)
            if path == '/api/order-event':
                return self.post_order_event(payload)
            if path == '/api/alert-report':
                return self.post_alert_report(payload)
            if path == '/api/rider-delete':
                return self.post_rider_delete(payload)
            if path == '/api/mileage/delete-by-rider':
                return self.post_mileage_delete_by_rider(payload)
            if path == '/api/mileage/update':
                return self.post_mileage_update(payload)
            if path == '/api/generator/start':
                return self.post_generator_start(payload)
            if path == '/api/generator/stop':
                return self.post_generator_stop(payload)
            if path == '/api/orders/import':
                return self.post_orders_import(payload)
            self.send_response(404)
            cors_headers(self)
            self.end_headers()
        except Exception as e:
            try:
                logging.exception(e)
            except Exception:
                pass
            return self.json_status(500, {"ok": False, "error": str(e)})

    def json(self, obj):
        """返回 200 JSON 响应。"""
        data = json.dumps(obj).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        cors_headers(self)
        self.end_headers()
        self.wfile.write(data)

    def json_status(self, code, obj):
        """返回带状态码的 JSON 响应。"""
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        cors_headers(self)
        self.end_headers()
        self.wfile.write(data)

    def get_health(self):
        """健康检查：统计核心表并返回运行时信息。"""
        try:
            conn = db()
            c = conn.cursor()
            c.execute('SELECT COUNT(*) FROM orders')
            orders = c.fetchone()[0] or 0
            c.execute('SELECT COUNT(DISTINCT name) FROM live_points WHERE ts > strftime("%s","now")*1000 - 5*60*1000')
            online = c.fetchone()[0] or 0
            try:
                c.execute("SELECT COUNT(*) FROM alerts WHERE ts > strftime('%s','now')*1000 - 24*60*60*1000")
                alerts = c.fetchone()[0] or 0
            except Exception:
                alerts = 0
            conn.close()
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})
        uptime = max(0, int(time.time()) - START_TS)
        status = {"ok": True, "uptime": uptime, "orders": orders, "onlineRiders": online, "alerts": alerts}
        return self.json(status)

    def get_riders(self):
        conn = db()
        c = conn.cursor()
        try:
            c.execute('SELECT DISTINCT rider FROM orders')
            order_riders = [r[0] for r in c.fetchall()]
            for nm in order_riders:
                if not nm:
                    continue
                c.execute('SELECT phone FROM riders WHERE name=?', (nm,))
                row = c.fetchone()
                if row is None:
                    c.execute('INSERT INTO riders (name, phone) VALUES (?, ?)', (nm, stable_phone(nm)))
                else:
                    ph = (row[0] or '').strip()
                    if ph == '':
                        c.execute('UPDATE riders SET phone=? WHERE name=?', (stable_phone(nm), nm))
            conn.commit()
        except Exception:
            pass
        c.execute('SELECT name, phone FROM riders')
        riders = c.fetchall()
        from time import time
        now = int(time()*1000)
        res = []
        for name, phone in riders:
            c.execute('SELECT lng, lat, ts FROM live_points WHERE name=? ORDER BY ts DESC LIMIT 1', (name,))
            rp = c.fetchone()
            if rp:
                lng, lat, ts = rp
                status = '在线' if (ts and now - int(ts) < 5*60*1000) else '离线'
                res.append({'name': name, 'phone': phone, 'status': status, 'lng': lng, 'lat': lat, 'last': int(ts or 0)})
            else:
                res.append({'name': name, 'phone': phone, 'status': '离线', 'lng': None, 'lat': None, 'last': 0})
        c.execute('SELECT DISTINCT name FROM live_points')
        extras = [r[0] for r in c.fetchall()]
        for name in extras:
            if any(x['name'] == name for x in res):
                continue
            c.execute('SELECT lng, lat, ts FROM live_points WHERE name=? ORDER BY ts DESC LIMIT 1', (name,))
            rp = c.fetchone()
            if rp:
                lng, lat, ts = rp
                status = '在线' if (ts and now - int(ts) < 5*60*1000) else '离线'
                res.append({'name': name, 'phone': '', 'status': status, 'lng': lng, 'lat': lat, 'last': int(ts or 0)})
        conn.close()
        return self.json(res)

    def get_overview(self):
        conn = db()
        c = conn.cursor()
        try:
            c.execute("SELECT COUNT(*) FROM orders WHERE date(created_ts, 'unixepoch', 'localtime') = date('now','localtime')")
            orders_total = c.fetchone()[0] or 0
        except Exception:
            c.execute('SELECT COUNT(*) FROM orders')
            orders_total = c.fetchone()[0] or 0
        c.execute('SELECT COUNT(DISTINCT name) FROM live_points WHERE ts > strftime("%s","now")*1000 - 5*60*1000')
        online = c.fetchone()[0] or 0
        try:
            c.execute("SELECT COUNT(*) FROM alerts WHERE ts > strftime('%s','now')*1000 - 24*60*60*1000")
            alerts_cnt = c.fetchone()[0] or 0
        except Exception:
            alerts_cnt = 0
        import time as _t
        now = int(_t.time())
        start = now - 5*3600
        try:
            c.execute("SELECT strftime('%H:00', created_ts, 'unixepoch', 'localtime') as h, COUNT(*) FROM orders WHERE created_ts BETWEEN ? AND ? GROUP BY h", (start, now))
            rows = c.fetchall()
        except Exception:
            rows = []
        conn.close()
        labels = []
        for i in range(5, -1, -1):
            t = _t.localtime(now - i*3600)
            labels.append(f"{t.tm_hour:02d}:00")
        counts_map = {r[0]: int(r[1] or 0) for r in rows}
        series = [counts_map.get(l, 0) for l in labels]
        resp = {
            'kpi': {
                'orders': orders_total,
                'onlineRiders': online,
                'alerts': alerts_cnt,
                'onlineRidersChange': 0
            },
            'chart': {
                'labels': labels,
                'orders': series
            }
        }
        return self.json(resp)

    def get_orders(self):
        conn = db()
        c = conn.cursor()
        try:
            c.execute('SELECT id, rider, status, eta_ts, category FROM orders ORDER BY created_ts DESC LIMIT 100')
            rows = c.fetchall()
        except Exception:
            c.execute('SELECT id, rider, status, eta_ts FROM orders ORDER BY created_ts DESC LIMIT 100')
            rows = [r + (None,) for r in c.fetchall()]
        conn.close()
        res = []
        for oid, rider, status, eta_ts, category in rows:
            if eta_ts:
                import time
                t = time.localtime(int(eta_ts))
                eta = f"{t.tm_hour:02d}:{t.tm_min:02d}"
            else:
                eta = ''
            item = {'id': oid, 'rider': rider, 'status': status, 'eta': eta}
            if category is not None:
                item['category'] = category
            res.append(item)
        return self.json(res)

    def get_analytics(self):
        from time import time as _time
        conn = db()
        c = conn.cursor()
        start = 0
        end = 0
        try:
            parsed = urlparse(getattr(self, 'path', '/api/analytics.json'))
            qs = parse_qs(parsed.query)
            start = int((qs.get('start',[0])[0])) if qs.get('start') else 0
            end = int((qs.get('end',[0])[0])) if qs.get('end') else 0
        except Exception:
            start = 0
            end = 0
        if not (start and end):
            end = int(_time())
            start = end - 7*24*3600
        try:
            c.execute('SELECT strftime("%H:00", created_ts, "unixepoch", "localtime") as h, COUNT(*) FROM orders WHERE created_ts BETWEEN ? AND ? GROUP BY h ORDER BY h', (start, end))
            time_rows = c.fetchall()
        except Exception:
            time_rows = []
        labels = [r[0] for r in time_rows]
        orders_cnt = [int(r[1] or 0) for r in time_rows]
        try:
            c.execute('SELECT COALESCE(category, "未分类") as cat, COUNT(*) FROM orders WHERE created_ts BETWEEN ? AND ? GROUP BY cat ORDER BY COUNT(*) DESC', (start, end))
            cat_rows = c.fetchall()
        except Exception:
            cat_rows = []
        cat_labels = [r[0] for r in cat_rows]
        cat_counts = [int(r[1] or 0) for r in cat_rows]
        try:
            c.execute('SELECT status, COUNT(*) FROM orders WHERE created_ts BETWEEN ? AND ? GROUP BY status', (start, end))
            status_rows = c.fetchall()
        except Exception:
            status_rows = []
        conn.close()
        status_map = {r[0]: int(r[1] or 0) for r in status_rows}
        steps = ['待取餐','配送中','延迟','已送达']
        funnel = [{'name': s, 'value': status_map.get(s, 0)} for s in steps]
        resp = {
            'time': {'labels': labels, 'orders': orders_cnt},
            'category': {'labels': cat_labels, 'counts': cat_counts},
            'funnel': funnel
        }
        return self.json(resp)

    def generate_orders(self, qs):
        count = int((qs.get('count',[0])[0]) or 0) or 100
        hours = int((qs.get('hours',[0])[0]) or 0) or 6
        insert_random_orders(count, hours)
        return self.json({'ok': True, 'inserted': count})

    def sample_generate(self, qs):
        count = int((qs.get('count',[0])[0]) or 0) or 100
        hours = int((qs.get('hours',[0])[0]) or 0) or 6
        insert_random_orders(count, hours)
        return self.json({'ok': True, 'inserted': count})

    def sample_clear(self):
        try:
            conn = db()
            c = conn.cursor()
            c.execute('DELETE FROM alerts')
            c.execute('DELETE FROM order_events')
            c.execute('DELETE FROM settlements')
            c.execute('DELETE FROM orders')
            conn.commit()
            conn.close()
            return self.json({'ok': True})
        except Exception as e:
            return self.json_status(500, {'ok': False, 'error': str(e)})

    def sample_status(self):
        try:
            conn = db()
            c = conn.cursor()
            c.execute('SELECT COUNT(*) FROM orders')
            orders = c.fetchone()[0] or 0
            c.execute('SELECT COUNT(DISTINCT rider) FROM orders')
            riders = c.fetchone()[0] or 0
            c.execute('SELECT COUNT(*) FROM alerts')
            alerts = c.fetchone()[0] or 0
            conn.close()
            return self.json({'ok': True, 'orders': orders, 'riders': riders, 'alerts': alerts})
        except Exception as e:
            return self.json_status(500, {'ok': False, 'error': str(e)})

    def get_alerts(self):
        self.generate_alerts()
        conn = db()
        c = conn.cursor()
        c.execute('SELECT order_id, rider, type, lng, lat FROM alerts ORDER BY ts DESC LIMIT 100')
        rows = c.fetchall()
        conn.close()
        return self.json([{'orderId': r[0], 'rider': r[1], 'type': r[2], 'lng': r[3], 'lat': r[4]} for r in rows])

    def haversine(self, a, b):
        from math import radians, sin, cos, asin, sqrt
        R = 6371000
        dlat = radians(b[1]-a[1])
        dlon = radians(b[0]-a[0])
        lat1 = radians(a[1])
        lat2 = radians(b[1])
        h = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
        return 2*R*asin(sqrt(h))

    def point_segment_distance(self, p, a, b):
        import math
        def to_xy(lng, lat):
            x = lng*math.pi/180*6378137
            y = math.log(math.tan((90+lat)*math.pi/360))*6378137
            return (x, y)
        px, py = to_xy(p[0], p[1])
        ax, ay = to_xy(a[0], a[1])
        bx, by = to_xy(b[0], b[1])
        vx, vy = bx-ax, by-ay
        wx, wy = px-ax, py-ay
        c1 = vx*wx + vy*wy
        if c1 <= 0: return math.hypot(px-ax, py-ay)
        c2 = vx*vx + vy*vy
        if c2 <= c1: return math.hypot(px-bx, py-by)
        t = c1/c2
        cx, cy = ax + t*vx, ay + t*vy
        return math.hypot(px-cx, py-cy)

    def generate_alerts(self):
        from time import time
        now = int(time())
        conn = db()
        c = conn.cursor()
        c.execute('SELECT id, rider, status, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat FROM orders')
        orders = c.fetchall()
        alerts = []
        for oid, rider, status, eta_ts, olng, olat, dlng, dlat in orders:
            c.execute('SELECT lng, lat, ts FROM live_points WHERE name=? ORDER BY ts DESC LIMIT 1', (rider,))
            rp = c.fetchone()
            if rp:
                rlng, rlat, rts = rp
                if eta_ts and now > int(eta_ts) and status != '已送达':
                    alerts.append((oid, rider, '延迟', now, rlng, rlat, 2))
                if olng is not None and dlng is not None:
                    d = self.point_segment_distance((rlng, rlat), (olng, olat), (dlng, dlat))
                    if d > 500:
                        alerts.append((oid, rider, '偏航', now, rlng, rlat, 3))
        for order_id, rider, type_, ts, lng, lat, sev in alerts:
            c.execute('DELETE FROM alerts WHERE order_id=? AND type=?', (order_id, type_))
            c.execute('INSERT INTO alerts (order_id, rider, type, ts, lng, lat, severity) VALUES (?,?,?,?,?,?,?)', (order_id, rider, type_, ts, lng, lat, sev))
        conn.commit()
        conn.close()

    def get_settlements(self, qs):
        start = int((qs.get('start',[0])[0])) if qs.get('start') else 0
        end = int((qs.get('end',[0])[0])) if qs.get('end') else 0
        if not (start and end):
            from time import time
            end = int(time())
            start = end - 7*24*3600
        conn = db()
        c = conn.cursor()
        c.execute('DELETE FROM settlements WHERE period_start_ts=? AND period_end_ts=?', (start, end))
        
        # 1. Fetch all orders CREATED in the period (Unified View)
        c.execute('SELECT id, rider, fee, delivered_ts, eta_ts, status FROM orders WHERE created_ts BETWEEN ? AND ?', (start, end))
        order_rows = c.fetchall()
        
        # 2. Fetch delays linked to these orders (Unified View)
        # Using a join to ensure we only count alerts for the relevant orders
        c.execute('''
            SELECT t1.rider, COUNT(t2.id) 
            FROM orders t1 
            JOIN alerts t2 ON t1.id = t2.order_id 
            WHERE t1.created_ts BETWEEN ? AND ? AND t2.type="延迟" 
            GROUP BY t1.rider
        ''', (start, end))
        delay_map = {r[0]: r[1] for r in c.fetchall()}
        
        from collections import defaultdict
        # {rider: {'count':0, 'income':0.0, 'on_time':0, 'delivered_count':0}}
        agg = defaultdict(lambda: {'count':0, 'income':0.0, 'on_time':0, 'delivered_count':0})
        
        for oid, rider, fee, delivered_ts, eta_ts, status in order_rows:
            if not rider: continue
            agg[rider]['count'] += 1 # Total Created
            
            # Only count income and on-time for delivered orders
            if status == '已送达' or delivered_ts:
                agg[rider]['income'] += float(fee or 0)
                agg[rider]['delivered_count'] += 1
                try:
                    if delivered_ts and eta_ts and int(delivered_ts) <= int(eta_ts):
                        agg[rider]['on_time'] += 1
                except Exception:
                    pass
        
        for rider, stats in agg.items():
            cnt = stats['count'] # Display Total Created Orders to match Monitoring
            delivered_cnt = stats['delivered_count']
            income = stats['income']
            on_time = stats['on_time']
            delays = delay_map.get(rider, 0)
            
            # Rates based on DELIVERED orders for fairness
            on_time_rate = (on_time/delivered_cnt) if delivered_cnt else 0.0
            
            base_bonus = float(on_time)*1.2
            tier_bonus = 0.0
            # Tier bonus criteria based on DELIVERED volume
            if delivered_cnt >= 100 and on_time_rate >= 0.95:
                tier_bonus = 80.0
            elif delivered_cnt >= 60 and on_time_rate >= 0.92:
                tier_bonus = 40.0
            
            zero_delay_bonus = 50.0 if (delays == 0 and delivered_cnt > 0) else 0.0
            subsidy = round(base_bonus + tier_bonus + zero_delay_bonus, 2)
            penalties = float(delays)*2.0
            net = float(income) + subsidy - penalties
            c.execute('INSERT INTO settlements (rider, period_start_ts, period_end_ts, orders_count, total_income, subsidy, penalties, net_income, generated_ts) VALUES (?,?,?,?,?,?,?,?,?)', (rider, start, end, cnt, income, subsidy, penalties, net, end))
        
        conn.commit()
        c.execute('SELECT rider, orders_count, total_income, subsidy, penalties, net_income FROM settlements WHERE period_start_ts=? AND period_end_ts=? ORDER BY net_income DESC', (start, end))
        res = [{'rider': r[0], 'orders': int(r[1] or 0), 'income': round(float(r[2] or 0),2), 'subsidy': round(float(r[3] or 0),2), 'penalties': round(float(r[4] or 0),2), 'net': round(float(r[5] or 0),2)} for r in c.fetchall()]
        conn.close()
        
        # Merge with all registered riders
        try:
            conn_r = db()
            c_r = conn_r.cursor()
            c_r.execute('SELECT name FROM riders')
            registered_riders = {r[0] for r in c_r.fetchall() if r[0]}
            conn_r.close()
        except Exception:
            registered_riders = set()

        # Build map from current results
        res_map = {r['rider']: r for r in res}
        
        # Add missing riders
        for rider in registered_riders:
            if rider not in res_map:
                res.append({
                    'rider': rider,
                    'orders': 0,
                    'income': 0.0,
                    'subsidy': 0.0,
                    'penalties': 0.0,
                    'net': 0.0
                })

        return self.json(res)

    def get_performance(self, qs):
        start = int((qs.get('start',[0])[0])) if qs.get('start') else 0
        end = int((qs.get('end',[0])[0])) if qs.get('end') else 0
        if not (start and end):
            from time import time
            end = int(time())
            start = end - 7*24*3600
        conn = db()
        c = conn.cursor()
        
        # Unified View: Filter by CREATED_TS
        c.execute('SELECT rider, delivered_ts, eta_ts, status FROM orders WHERE created_ts BETWEEN ? AND ?', (start, end))
        
        from collections import defaultdict
        stats = defaultdict(lambda: {'delivered':0,'on_time':0, 'total':0})
        
        for rider, delivered_ts, eta_ts, status in c.fetchall():
            stats[rider]['total'] += 1
            if status == '已送达' or delivered_ts:
                stats[rider]['delivered'] += 1
                try:
                    if eta_ts and int(delivered_ts) <= int(eta_ts):
                        stats[rider]['on_time'] += 1
                except Exception:
                    pass
        conn.close()
        
        # Merge with all registered riders
        try:
            conn_r = db()
            c_r = conn_r.cursor()
            c_r.execute('SELECT name FROM riders')
            registered_riders = {r[0] for r in c_r.fetchall() if r[0]}
            conn_r.close()
        except Exception:
            registered_riders = set()

        res = []
        all_names = set(stats.keys()) | registered_riders

        for rider in all_names:
            if not rider: continue
            s = stats[rider]
            delivered = s['delivered']
            total = s['total']
            on_time_rate = (s['on_time']/delivered) if delivered else 0.0
            accept_rate = 0.9
            positive_rate = 0.95
            res.append({'rider': rider, 'on_time_rate': on_time_rate, 'accept_rate': accept_rate, 'positive_rate': positive_rate, 'orders': total})
        
        try:
            conn2 = db()
            c2 = conn2.cursor()
            for r in res:
                nm = r['rider']
                if nm:
                    c2.execute('INSERT OR IGNORE INTO riders (name, phone) VALUES (?, ?)', (nm, stable_phone(nm)))
                    c2.execute("UPDATE riders SET phone=? WHERE name=? AND (phone IS NULL OR phone='')", (stable_phone(nm), nm))
            conn2.commit()
            conn2.close()
        except Exception:
            pass
        res.sort(key=lambda r: (-r['on_time_rate'], -r['orders'], r['rider']))
        return self.json(res)

    def get_mileage(self, qs):
        start = int((qs.get('start',[0])[0])) if qs.get('start') else 0
        end = int((qs.get('end',[0])[0])) if qs.get('end') else 0
        if not (start and end):
            from time import time
            end = int(time())
            start = end - 7*24*3600
        threshold = 80.0
        conn = db()
        c = conn.cursor()
        c.execute('SELECT date(end_ts/1000, "unixepoch") as d, COALESCE(SUM(distance)/1000.0,0) FROM tracks WHERE (end_ts/1000) BETWEEN ? AND ? GROUP BY d ORDER BY d', (start, end))
        daily = c.fetchall()
        labels = [r[0] for r in daily]
        kms = [round(float(r[1] or 0), 2) for r in daily]
        c.execute('SELECT name, COALESCE(SUM(distance)/1000.0,0) FROM tracks WHERE (end_ts/1000) BETWEEN ? AND ? GROUP BY name ORDER BY SUM(distance) DESC', (start, end))
        ranking = [{'rider': r[0], 'km': round(float(r[1] or 0), 2)} for r in c.fetchall()]
        c.execute('SELECT name, date(end_ts/1000, "unixepoch") as d, COALESCE(SUM(distance)/1000.0,0) as km FROM tracks WHERE (end_ts/1000) BETWEEN ? AND ? GROUP BY name, d HAVING km>? ORDER BY d DESC, km DESC', (start, end, threshold))
        warnings = [{'rider': r[0], 'date': r[1], 'km': round(float(r[2] or 0), 2)} for r in c.fetchall()]
        c.execute('SELECT COUNT(DISTINCT name) FROM tracks WHERE (end_ts/1000) BETWEEN ? AND ?', (start, end))
        riders = c.fetchone()[0] or 0
        totalKm = round(sum(kms), 2)
        conn.close()
        resp = {
            'summary': {'days': int((end-start)/86400), 'totalKm': totalKm, 'riders': riders, 'overDaily': len(warnings), 'threshold': threshold},
            'daily': {'labels': labels, 'km': kms},
            'ranking': ranking,
            'warnings': warnings
        }
        return self.json(resp)

    def get_tracks(self, qs):
        try:
            limit = int((qs.get('limit',[0])[0]) or 0) or 50
            conn = db()
            c = conn.cursor()
            c.execute('SELECT name, phone, start_ts, end_ts, distance FROM tracks ORDER BY end_ts DESC, id DESC LIMIT ?', (limit,))
            rows = c.fetchall()
            conn.close()
            def fmt_ts(ms):
                try:
                    return int(ms)
                except Exception:
                    return 0
            res = [
                {
                    'name': r[0],
                    'phone': r[1],
                    'start_ts': fmt_ts(r[2]),
                    'end_ts': fmt_ts(r[3]),
                    'distance_km': round(float(r[4] or 0)/1000.0, 3)
                }
                for r in rows
            ]
            return self.json(res)
        except Exception as e:
            return self.json_status(500, {'ok': False, 'error': str(e)})

    def post_track_point(self, payload):
        name = payload.get('name')
        phone = payload.get('phone')
        lng = payload.get('lng')
        lat = payload.get('lat')
        ts = int(payload.get('ts') or 0)
        if not (name and lng is not None and lat is not None and ts):
            self.send_response(400)
            cors_headers(self)
            self.end_headers()
            return
        conn = db()
        c = conn.cursor()
        if phone:
            c.execute('INSERT OR IGNORE INTO riders (name, phone) VALUES (?, ?)', (name, phone))
        c.execute('INSERT INTO live_points (name, lng, lat, ts) VALUES (?, ?, ?, ?)', (name, float(lng), float(lat), int(ts)))
        conn.commit()
        conn.close()
        return self.json({"ok": True})

    def post_track_submit(self, payload):
        name = payload.get('name')
        phone = payload.get('phone')
        start_ts = int(payload.get('start_ts') or 0)
        end_ts = int(payload.get('end_ts') or 0)
        distance = float(payload.get('distance') or 0)
        points = payload.get('points') or []
        cleaned = []
        prev = None
        for p in points:
            lng = round(float(p[0]),5)
            lat = round(float(p[1]),5)
            if (prev is None) or (prev[0]!=lng or prev[1]!=lat):
                cleaned.append([lng,lat])
                prev = [lng,lat]
        if not (name and start_ts and end_ts and isinstance(points, list) and points):
            self.send_response(400)
            cors_headers(self)
            self.end_headers()
            return
        conn = db()
        c = conn.cursor()
        if phone:
            c.execute('INSERT OR IGNORE INTO riders (name, phone) VALUES (?, ?)', (name, phone))
        if distance < 0:
            distance = 0.0
        if distance > 200000.0:
            distance = 200000.0
        c.execute('SELECT id FROM tracks WHERE name=? AND start_ts=? AND end_ts=?', (name, start_ts, end_ts))
        row = c.fetchone()
        if row:
            c.execute('UPDATE tracks SET distance=?, points=? WHERE id=?', (distance, json.dumps(cleaned), int(row[0])))
        else:
            c.execute('INSERT INTO tracks (name, phone, start_ts, end_ts, distance, points) VALUES (?, ?, ?, ?, ?, ?)',
                      (name, phone, start_ts, end_ts, distance, json.dumps(cleaned)))
        conn.commit()
        conn.close()
        return self.json({"ok": True})

    def post_order_upsert(self, payload):
        oid = payload.get('id')
        rider = payload.get('rider')
        status = payload.get('status')
        created_ts = payload.get('created_ts')
        pickup_ts = payload.get('pickup_ts')
        delivered_ts = payload.get('delivered_ts')
        eta_ts = payload.get('eta_ts')
        origin_lng = payload.get('origin_lng')
        origin_lat = payload.get('origin_lat')
        dest_lng = payload.get('dest_lng')
        dest_lat = payload.get('dest_lat')
        fee = payload.get('fee')
        distance = payload.get('distance')
        category = payload.get('category')
        if not oid:
            self.send_response(400)
            cors_headers(self)
            self.end_headers()
            return
        conn = db()
        c = conn.cursor()
        try:
            c.execute('INSERT OR REPLACE INTO orders (id, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance, category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (oid, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance, category))
        except Exception:
            c.execute('INSERT OR REPLACE INTO orders (id, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (oid, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance))
        conn.commit()
        conn.close()
        return self.json({"ok": True})

    def post_order_event(self, payload):
        order_id = payload.get('order_id')
        ts = payload.get('ts')
        type_ = payload.get('type')
        meta = json.dumps(payload.get('meta') or {})
        if not (order_id and ts and type_):
            self.send_response(400)
            cors_headers(self)
            self.end_headers()
            return
        conn = db()
        c = conn.cursor()
        c.execute('INSERT INTO order_events (order_id, ts, type, meta) VALUES (?,?,?,?)', (order_id, ts, type_, meta))
        conn.commit()
        conn.close()
        return self.json({"ok": True})

    def post_alert_report(self, payload):
        order_id = payload.get('order_id')
        rider = payload.get('rider')
        type_ = payload.get('type')
        ts = payload.get('ts')
        lng = payload.get('lng')
        lat = payload.get('lat')
        severity = payload.get('severity')
        if not (order_id and rider and type_ and ts):
            self.send_response(400)
            cors_headers(self)
            self.end_headers()
            return
        conn = db()
        c = conn.cursor()
        c.execute('INSERT INTO alerts (order_id, rider, type, ts, lng, lat, severity) VALUES (?,?,?,?,?,?,?)', (order_id, rider, type_, ts, lng, lat, severity))
        conn.commit()
        conn.close()
        return self.json({"ok": True})

    def post_rider_delete(self, payload):
        try:
            name = (payload.get('name') or '').strip()
            if not name:
                return self.json_status(400, {"ok": False, "error": "missing name"})
            conn = db()
            c = conn.cursor()
            c.execute('DELETE FROM alerts WHERE rider=?', (name,))
            c.execute('DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE rider=?)', (name,))
            c.execute('DELETE FROM orders WHERE rider=?', (name,))
            c.execute('DELETE FROM live_points WHERE name=?', (name,))
            c.execute('DELETE FROM tracks WHERE name=?', (name,))
            c.execute('DELETE FROM settlements WHERE rider=?', (name,))
            c.execute('DELETE FROM mileage_daily WHERE rider=?', (name,))
            c.execute('DELETE FROM performance_daily WHERE rider=?', (name,))
            c.execute('DELETE FROM riders WHERE name=?', (name,))
            conn.commit()
            conn.close()
            return self.json({"ok": True})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_mileage_delete_by_rider(self, payload):
        try:
            name = (payload.get('rider') or '').strip()
            start = int(payload.get('start') or 0)
            end = int(payload.get('end') or 0)
            if not name:
                return self.json_status(400, {"ok": False, "error": "missing rider"})
            if not (start and end):
                from time import time
                end = int(time())
                start = end - 7*24*3600
            conn = db()
            c = conn.cursor()
            c.execute('DELETE FROM tracks WHERE name=? AND (end_ts/1000) BETWEEN ? AND ?', (name, start, end))
            conn.commit()
            conn.close()
            return self.json({"ok": True})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_mileage_update(self, payload):
        try:
            name = (payload.get('rider') or '').strip()
            date_str = (payload.get('date') or '').strip()
            km = float(payload.get('km') or 0)
            if not (name and date_str):
                return self.json_status(400, {"ok": False, "error": "missing rider/date"})
            if km < 0:
                km = 0.0
            if km > 200.0:
                km = 200.0
            import datetime
            dt = datetime.datetime.strptime(date_str, '%Y-%m-%d')
            sec = int(dt.timestamp())
            end_ts = (sec + 12*3600) * 1000
            start_ts = (sec + 8*3600) * 1000
            conn = db()
            c = conn.cursor()
            c.execute('DELETE FROM tracks WHERE name=? AND date(end_ts/1000, "unixepoch")=?', (name, date_str))
            c.execute('INSERT INTO tracks (name, phone, start_ts, end_ts, distance, points) VALUES (?, ?, ?, ?, ?, ?)', (name, None, start_ts, end_ts, km*1000.0, json.dumps([])))
            conn.commit()
            conn.close()
            return self.json({"ok": True})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_generator_start(self, payload):
        try:
            rate = int(payload.get('rate_per_interval') or payload.get('rate_per_minute') or 1)
            hours = int(payload.get('hours_window') or 1)
            interval = int(payload.get('interval_minutes') or 5)
            ai = bool(payload.get('ai_profile', True))
            generator_cfg['rate'] = max(0, rate)
            generator_cfg['hours'] = max(1, hours)
            generator_cfg['interval'] = max(1, interval)
            generator_cfg['ai'] = ai
            generator_cfg['enabled'] = True
            global generator_thread
            if generator_thread is None or not generator_thread.is_alive():
                generator_thread = threading.Thread(target=_generator_loop, daemon=True)
                generator_thread.start()
            return self.json({"ok": True, "status": {"enabled": True, "rate": generator_cfg['rate'], "hours": generator_cfg['hours'], "interval": generator_cfg['interval'], "ai": generator_cfg['ai']}})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_generator_stop(self, payload):
        try:
            generator_cfg['enabled'] = False
            return self.json({"ok": True, "status": {"enabled": False}})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_orders_import(self, payload):
        try:
            orders = payload.get('orders')
            if not isinstance(orders, list):
                return self.json_status(400, {"ok": False, "error": "orders must be list"})
            conn = db()
            c = conn.cursor()
            for o in orders:
                oid = o.get('id')
                rider = o.get('rider')
                status = o.get('status')
                created_ts = o.get('created_ts')
                pickup_ts = o.get('pickup_ts')
                delivered_ts = o.get('delivered_ts')
                eta_ts = o.get('eta_ts')
                origin_lng = o.get('origin_lng')
                origin_lat = o.get('origin_lat')
                dest_lng = o.get('dest_lng')
                dest_lat = o.get('dest_lat')
                fee = o.get('fee')
                distance = o.get('distance')
                category = o.get('category')
                if not oid:
                    oid = 'OD'+str(int(time.time()))+str(abs(hash(json.dumps(o)))%10000).zfill(4)
                try:
                    c.execute('INSERT OR REPLACE INTO orders (id, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance, category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (oid, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance, category))
                except Exception:
                    c.execute('INSERT OR REPLACE INTO orders (id, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (oid, rider, status, created_ts, pickup_ts, delivered_ts, eta_ts, origin_lng, origin_lat, dest_lng, dest_lat, fee, distance))
            conn.commit()
            conn.close()
            return self.json({"ok": True, "imported": len(orders)})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_rider_register(self, payload):
        try:
            name = (payload.get('name') or '').strip()
            phone = (payload.get('phone') or '').strip()
            if not (name and phone):
                return self.json_status(400, {"ok": False, "error": "missing"})
            conn = db()
            c = conn.cursor()
            c.execute('INSERT OR REPLACE INTO riders (name, phone) VALUES (?, ?)', (name, phone))
            conn.commit()
            conn.close()
            # Generate initial data for new rider
            try:
                insert_random_orders(20, 48, [name])
            except Exception:
                pass
            return self.json({"ok": True})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

    def post_rider_login(self, payload):
        try:
            name = (payload.get('name') or '').strip()
            phone = (payload.get('phone') or '').strip()
            if not (name and phone):
                return self.json_status(400, {"ok": False})
            conn = db()
            c = conn.cursor()
            c.execute('SELECT phone FROM riders WHERE name=?', (name,))
            row = c.fetchone()
            conn.close()
            if row and (row[0] or '') == phone:
                return self.json_status(200, {"ok": True})
            return self.json_status(401, {"ok": False})
        except Exception as e:
            return self.json_status(500, {"ok": False, "error": str(e)})

def main():
    logging.basicConfig(filename=os.path.join(os.path.dirname(__file__), 'server.log'), level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    logging.info('server starting')
    init_db()
    try:
        backups = os.path.join(os.path.dirname(__file__), 'backups')
        os.makedirs(backups, exist_ok=True)
        src = DB_PATH
        import shutil
        ts = time.strftime('%Y%m%d-%H%M%S')
        dst = os.path.join(backups, f'data-{ts}.db')
        shutil.copyfile(src, dst)
        logging.info(f'backup created: {dst}')
    except Exception as e:
        try:
            logging.warning(f'backup failed: {e}')
        except Exception:
            pass
    port = int(os.environ.get('PORT', '8001'))
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f'API server running on http://localhost:{port}/api')
    logging.info(f'listening on {port}')
    server.serve_forever()

if __name__ == '__main__':
    main()

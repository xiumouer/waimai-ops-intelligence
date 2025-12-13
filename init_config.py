import os

root = os.path.dirname(__file__)
path = os.path.join(root, 'config.local.js')
if os.path.exists(path):
    try:
        if os.path.getsize(path) > 0:
            print('config.local.js exists')
            raise SystemExit(0)
    except Exception:
        pass
api = os.environ.get('API_BASE') or f"http://localhost:{os.environ.get('PORT','8001')}/api"
cfg = {
    'AMAP_KEY': os.environ.get('AMAP_KEY',''),
    'AMAP_SECURITY_JS': os.environ.get('AMAP_SECURITY_JS',''),
    'API_BASE': api
}
content = 'window.APP_CONFIG={' + f"AMAP_KEY:\"{cfg['AMAP_KEY']}\",AMAP_SECURITY_JS:\"{cfg['AMAP_SECURITY_JS']}\",API_BASE:\"{cfg['API_BASE']}\"" + '}'
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('config.local.js initialized')

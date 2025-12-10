import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAMap } from '../utils/amap';

declare global {
  interface Window { __AMAP_KEY__?: string; __AMAP_SECURITY_JS__?: string; _AMapSecurityConfig?: any; AMap?: any }
}

describe('loadAMap', () => {
  beforeEach(() => {
    delete (window as any).AMap;
    delete (window as any).__AMAP_KEY__;
    delete (window as any).__AMAP_SECURITY_JS__;
    delete (window as any)._AMapSecurityConfig;
    const env = (import.meta as any).env || ((import.meta as any).env = {});
    env.VITE_AMAP_KEY = undefined;
    env.VITE_AMAP_SECURITY_JS = undefined;
  });

  it('rejects when script fails to load', async () => {
    // 提供一个伪 key，但模拟脚本加载失败，验证错误分支
    (window as any).__AMAP_KEY__ = 'fake-key';
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((el: any) => {
      setTimeout(() => { el.onerror && el.onerror(new Event('error')); }, 0);
      return el;
    });
    await expect(loadAMap()).rejects.toThrow(/脚本加载失败/);
    appendSpy.mockRestore();
  });

  it('resolves and sets security config when key and securityJs provided', async () => {
    (window as any).__AMAP_KEY__ = 'fake-key';
    (window as any).__AMAP_SECURITY_JS__ = 'sec-code';
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((el: any) => {
      // Simulate AMap ready before onload callback
      (window as any).AMap = { Map: function(){} };
      setTimeout(() => { el.onload && el.onload(new Event('load')); }, 0);
      return el;
    });
    const AMap = await loadAMap();
    expect(appendSpy).toHaveBeenCalled();
    expect(AMap).toBeDefined();
    const cfg = (window as any)._AMapSecurityConfig;
    expect(cfg).toBeDefined();
    expect(typeof cfg.securityJsCode).toBe('string');
    expect(cfg.securityJsCode.length).toBeGreaterThan(0);
    appendSpy.mockRestore();
  });
});
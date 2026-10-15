import { beforeEach, describe, expect, it } from "vitest";
import { getUnfiltered, loadUnfiltered, setUnfiltered, subscribeUnfiltered } from "./unfiltered";

let storage = new Map<string, string>();

class FakeLocalStorage {
  getItem(key: string) {
    return storage.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    storage.set(key, value);
  }
}

/** 模块按浏览器全局取 localStorage，这里把全局装上替身。 */
function installStorage(): void {
  const fake = new FakeLocalStorage();
  (globalThis as { window?: unknown }).window = { localStorage: fake };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: fake,
  });
}

beforeEach(() => {
  storage = new Map();
  installStorage();
  setUnfiltered(false);
  storage.clear();
});

describe("无过滤内容开关", () => {
  it("打开后写进本机，重新读取还是打开", () => {
    setUnfiltered(true);
    expect(storage.get("ai-rp:unfiltered:v1")).toBe("1");

    setUnfiltered(false);
    expect(storage.get("ai-rp:unfiltered:v1")).toBe("0");
    loadUnfiltered();
    expect(getUnfiltered()).toBe(false);

    storage.set("ai-rp:unfiltered:v1", "1");
    loadUnfiltered();
    expect(getUnfiltered()).toBe(true);
  });

  it("没有存过、或者存的值不认识，都按关闭处理", () => {
    expect(getUnfiltered()).toBe(false);

    storage.set("ai-rp:unfiltered:v1", "yes");
    loadUnfiltered();
    expect(getUnfiltered()).toBe(false);
  });

  it("状态变化会通知订阅者，值没变就不通知", () => {
    let calls = 0;
    const unsubscribe = subscribeUnfiltered(() => {
      calls += 1;
    });

    setUnfiltered(true);
    expect(calls).toBe(1);
    setUnfiltered(true);
    expect(calls).toBe(1);

    setUnfiltered(false);
    expect(calls).toBe(2);
    unsubscribe();
    setUnfiltered(true);
    expect(calls).toBe(2);
  });

  it("localStorage 读不了时不抛错，本次打开仍然生效", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(() => loadUnfiltered()).not.toThrow();
    expect(getUnfiltered()).toBe(false);
    expect(() => setUnfiltered(true)).not.toThrow();
    expect(getUnfiltered()).toBe(true);
  });
});

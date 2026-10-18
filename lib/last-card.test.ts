import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetLastCardId,
  pickInitialCardId,
  readLastCardId,
  rememberLastCardId,
} from "./last-card";

let storage = new Map<string, string>();

class FakeLocalStorage {
  getItem(key: string) {
    return storage.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    storage.set(key, value);
  }
  removeItem(key: string) {
    storage.delete(key);
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
});

describe("上次打开的角色", () => {
  it("记下之后重新读还是同一个，清掉之后就没有了", () => {
    expect(readLastCardId()).toBeNull();

    rememberLastCardId("card-b");
    expect(storage.get("ai-rp:last-card:v1")).toBe("card-b");
    expect(readLastCardId()).toBe("card-b");

    forgetLastCardId();
    expect(readLastCardId()).toBeNull();
  });

  it("存过空串或读不了，都按没有存过处理", () => {
    storage.set("ai-rp:last-card:v1", "   ");
    expect(readLastCardId()).toBeNull();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(() => readLastCardId()).not.toThrow();
    expect(readLastCardId()).toBeNull();
    expect(() => rememberLastCardId("card-a")).not.toThrow();
    expect(() => forgetLastCardId()).not.toThrow();
  });
});

describe("启动时进哪张卡", () => {
  const available = ["card-a", "card-b", "card-c"];

  it("优先用上次打开的那张", () => {
    expect(
      pickInitialCardId({
        remembered: "card-b",
        recent: ["card-c", "card-a"],
        available,
      }),
    ).toBe("card-b");
  });

  it("上次那张已经删了，就退到最近聊过的那张", () => {
    expect(
      pickInitialCardId({
        remembered: "card-gone",
        recent: ["card-c", "card-a"],
        available,
      }),
    ).toBe("card-c");
  });

  it("没记过时按会话的新旧顺序找第一张还在的", () => {
    expect(
      pickInitialCardId({
        remembered: null,
        recent: ["card-gone", "card-a"],
        available,
      }),
    ).toBe("card-a");
  });

  it("卡和会话都对不上时返回 null，交给调用方退回第一张", () => {
    expect(
      pickInitialCardId({ remembered: null, recent: [], available }),
    ).toBeNull();
    expect(
      pickInitialCardId({ remembered: "card-x", recent: ["card-y"], available }),
    ).toBeNull();
    expect(
      pickInitialCardId({ remembered: "card-a", recent: [], available: [] }),
    ).toBeNull();
  });
});

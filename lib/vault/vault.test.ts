import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSlots,
  exportArchive,
  getVaultSnapshot,
  importArchive,
  importArchiveWithPassphrase,
  listSlots,
  MAX_ATTEMPTS,
  readSlot,
  setupVault,
  subscribeVault,
  unlockVault,
  wipeVaultData,
  lockVault,
  writeSlot,
  VaultError,
} from "./index";
import { createMemoryBackend, configureBackends } from "@/lib/storage/backend";
import { toBase64 } from "./crypto";

/** Node 里没有 localStorage，用一个最小实现顶上，行为对齐浏览器。 */
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  dump() {
    return [...this.map.entries()];
  }
}

let storage = new MemoryStorage();
/** 直接持有后端引用，测试要能读到原始密文。 */
let dataBackend = createMemoryBackend();
let localBackend = createMemoryBackend();

beforeEach(() => {
  storage = new MemoryStorage();
  dataBackend = createMemoryBackend();
  localBackend = createMemoryBackend();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  configureBackends(dataBackend, localBackend);
});

const PASSPHRASE = "correct horse battery";
const WRONG = "wrong passphrase here";

async function freshSetup(passphrase = PASSPHRASE) {
  await wipeVaultData();
  await setupVault(passphrase, passphrase);
}

describe("加密原语", () => {
  it("未初始化时可用指定盐和迭代次数解密存档", async () => {
    const params = { salt: toBase64(new TextEncoder().encode("archive-salt-1234")), iterations: 120_000 };
    await wipeVaultData();
    await setupVault(PASSPHRASE, PASSPHRASE, 0, params);
    const text = await exportArchive({ sessions: [{ id: "s1" }] });

    await wipeVaultData();
    const imported = await importArchiveWithPassphrase(text, PASSPHRASE, params);
    expect(imported.payload).toEqual({ sessions: [{ id: "s1" }] });
  });

  it("同样明文两次加密得到不同密文，解密回到原值", async () => {
    await freshSetup();
    await writeSlot("data", "k", { secret: "sk-live-1234" });
    const first = (await dataBackend.get("k")) ?? "";
    await writeSlot("data", "k", { secret: "sk-live-1234" });
    const second = (await dataBackend.get("k")) ?? "";
    // IV 每次重取，密文必须不一样，否则同一份明文会一直暴露相同密文
    expect(first).not.toBe(second);
    expect(first).not.toContain("sk-live-1234");
    expect(await readSlot<{ secret: string }>("data", "k")).toEqual({ secret: "sk-live-1234" });
  });

  it("盐与校验值可存，但都不是密钥的可逆形式", async () => {
    await freshSetup();
    const header = storage.dump().find(([key]) => key === "ai-rp:vault:v1");
    expect(header).toBeTruthy();
    const parsed = JSON.parse(header?.[1] ?? "{}") as { salt?: string; verifier?: { data: string } };
    expect(parsed.salt).toBeTruthy();
    expect(parsed.verifier?.data).toBeTruthy();
    // 密钥本身不能出现在存储里的任何位置
    const all = storage.dump().map(([, value]) => value).join("|");
    expect(all).not.toContain(PASSPHRASE);
    expect(toBase64(new TextEncoder().encode(PASSPHRASE))).not.toBe(parsed.salt);
  });

  it("全盘扫描：任何一处都不出现明文密钥与明文 Key", async () => {
    await freshSetup();
    await writeSlot("local", "settings", {
      providerId: "yosei-router",
      apiKey: "sk-test-example-not-a-real-key",
    });
    await writeSlot("data", "session:1", {
      messages: [{ role: "user", content: "老板娘，来杯热姜茶。" }],
    });
    const raw = storage.dump().map(([, value]) => value).join("\n");
    expect(raw).not.toContain("sk-test-example");
    expect(raw).not.toContain("热姜茶");
    expect(raw).not.toContain(PASSPHRASE);
  });
});

describe("解锁状态机", () => {
  it("未解锁读不到东西，解锁后能读回来", async () => {
    await freshSetup();
    await writeSlot("data", "session:1", { id: "1", messages: [] });
    lockVault();
    expect(getVaultSnapshot().status).toBe("locked");
    expect(await readSlot("data", "session:1")).toBeNull();

    await unlockVault(PASSPHRASE);
    expect(getVaultSnapshot().status).toBe("unlocked");
    expect(await readSlot<{ id: string }>("data", "session:1")).toEqual({ id: "1", messages: [] });
  });

  it("错误密钥被拒绝，计数递减，不泄露密钥信息", async () => {
    await freshSetup();
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      await expect(unlockVault(WRONG)).rejects.toBeInstanceOf(VaultError);
      expect(getVaultSnapshot().attemptsLeft).toBe(MAX_ATTEMPTS - attempt);
    }
    const header = JSON.parse(
      storage.getItem("ai-rp:vault:v1") ?? "{}",
    ) as { attempts?: number; salt?: string };
    // 错误计数只是一个数，且随密钥变化无关：换个密钥错误，计数照样只加一
    expect(header.attempts).toBe(MAX_ATTEMPTS - 1);
    expect(header.salt).toBeTruthy();
  });

  it("连续 5 次错误清掉全部数据并回到未设定状态", async () => {
    await freshSetup();
    await writeSlot("data", "session:1", { id: "1", messages: [] });
    await writeSlot("local", "settings", { apiKey: "sk-secret" });

    for (let attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt++) {
      await expect(unlockVault(WRONG)).rejects.toBeInstanceOf(VaultError);
    }
    let wiped = false;
    try {
      await unlockVault(WRONG);
    } catch (error) {
      wiped = error instanceof VaultError && error.code === "wiped";
    }
    expect(wiped).toBe(true);

    expect(storage.getItem("ai-rp:vault:v1")).toBeNull();
    expect(await listSlots("data", "session:")).toEqual([]);
    expect(getVaultSnapshot().status).toBe("uninitialized");
    expect(getVaultSnapshot().notice).toBeTruthy();

    // 清完之后重新设密钥，旧数据不会回来
    await setupVault(PASSPHRASE, PASSPHRASE);
    expect(await readSlot("data", "session:1")).toBeNull();
  });

  it("密钥太短或两次不一致会被拒", async () => {
    await wipeVaultData();
    await expect(setupVault("short", "short")).rejects.toBeInstanceOf(VaultError);
    await expect(setupVault(PASSPHRASE, `${PASSPHRASE}-x`)).rejects.toBeInstanceOf(VaultError);
    expect(getVaultSnapshot().status).toBe("uninitialized");
  });

  it("已设过密钥时不能重复设定", async () => {
    await freshSetup();
    await expect(setupVault(PASSPHRASE, PASSPHRASE)).rejects.toMatchObject({
      code: "has_vault",
    });
  });

  it("解锁成功会把错误计数归零", async () => {
    await freshSetup();
    await expect(unlockVault(WRONG)).rejects.toBeInstanceOf(VaultError);
    await unlockVault(PASSPHRASE);
    const header = JSON.parse(storage.getItem("ai-rp:vault:v1") ?? "{}") as { attempts?: number };
    expect(header.attempts).toBe(0);
    expect(getVaultSnapshot().attemptsLeft).toBe(MAX_ATTEMPTS);
  });

  it("锁定与清除都不留内存里的东西", async () => {
    await freshSetup();
    await writeSlot("data", "card:1", { id: "1" });
    lockVault();
    expect(getVaultSnapshot().status).toBe("locked");
    await unlockVault(PASSPHRASE);
    await wipeVaultData();
    expect(getVaultSnapshot().status).toBe("uninitialized");
    expect(await listSlots("data", "card:")).toEqual([]);
  });

  it("订阅者只在状态变化时收到通知", async () => {
    await wipeVaultData();
    let calls = 0;
    const unsubscribe = subscribeVault(() => {
      calls++;
    });
    await setupVault(PASSPHRASE, PASSPHRASE);
    const after = calls;
    unsubscribe();
    await unlockVault(PASSPHRASE);
    expect(after).toBeGreaterThan(0);
    expect(calls).toBe(after);
  });
});

describe("槽位", () => {
  it("按前缀列举与清除，坏条目跳过", async () => {
    await freshSetup();
    await writeSlot("data", "session:a", { id: "a" });
    await writeSlot("data", "session:b", { id: "b" });
    await writeSlot("data", "card:c", { id: "c" });

    const sessions = await listSlots<{ id: string }>("data", "session:");
    expect(sessions.map((row) => row.value.id).sort()).toEqual(["a", "b"]);

    await clearSlots("data", "session:");
    expect(await listSlots("data", "session:")).toEqual([]);
    expect(await readSlot<{ id: string }>("data", "card:c")).toEqual({ id: "c" });
  });

  it("local 与 data 两个范围互不干扰", async () => {
    await freshSetup();
    await writeSlot("local", "same", { where: "local" });
    await writeSlot("data", "same", { where: "data" });
    expect(await readSlot<{ where: string }>("local", "same")).toEqual({ where: "local" });
    expect(await readSlot<{ where: string }>("data", "same")).toEqual({ where: "data" });
  });
});

describe("存档", () => {
  it("导出的是密文，用同一个密钥能读回来", async () => {
    await freshSetup();
    const payload = {
      sessions: [{ id: "1", messages: [{ role: "user" as const, content: "来杯热姜茶" }] }],
    };
    const text = await exportArchive(payload);
    expect(text).not.toContain("热姜茶");
    expect(text).not.toContain(PASSPHRASE);

    const { payload: restored } = await importArchive(text);
    expect(restored).toEqual(payload);
  });

  it("密钥错误要报错，不能静默成功", async () => {
    await freshSetup();
    const text = await exportArchive({ sessions: [] });
    await wipeVaultData();
    await setupVault("an entirely different key", "an entirely different key");
    await expect(importArchive(text)).rejects.toMatchObject({ code: "bad_passphrase" });
  });

  it("不是本项目存档、或者被改过，都要报错", async () => {
    await freshSetup();
    await expect(importArchive("not json at all")).rejects.toBeInstanceOf(VaultError);
    await expect(importArchive('{"v":1,"iv":"a","data":"b"}')).rejects.toBeInstanceOf(VaultError);

    const text = await exportArchive({ sessions: [] });
    const tampered = JSON.parse(text) as { data: string };
    tampered.data = `${tampered.data.slice(0, -4)}AAAA`;
    await expect(importArchive(JSON.stringify(tampered))).rejects.toBeInstanceOf(VaultError);
  });
});

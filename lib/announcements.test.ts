import { beforeEach, describe, expect, it, vi } from "vitest";

/** 公告读写走 window.localStorage，测试里现搭一个。 */
function installWindow(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

async function loadAnnouncements() {
  return import("./announcements");
}

describe("公告", () => {
  beforeEach(() => {
    vi.resetModules();
    installWindow();
  });

  it("首条公告写清了不支持的内容，也写明了不做审查", async () => {
    const { ANNOUNCEMENTS } = await loadAnnouncements();
    expect(ANNOUNCEMENTS.length).toBeGreaterThan(0);
    const first = ANNOUNCEMENTS[0];
    for (const word of ["色情", "反动", "政治", "宗教"]) {
      expect(first.body).toContain(word);
    }
    expect(first.body).toContain("请勿涉及");
    expect(first.body).toContain("不设内容审查");
    expect(first.title.length).toBeGreaterThan(0);
  });

  it("每条公告都有 id、标题、正文", async () => {
    const { ANNOUNCEMENTS } = await loadAnnouncements();
    const ids = new Set(ANNOUNCEMENTS.map((item) => item.id));
    expect(ids.size).toBe(ANNOUNCEMENTS.length);
    for (const item of ANNOUNCEMENTS) {
      expect(item.id).not.toBe("");
      expect(item.title).not.toBe("");
      expect(item.body).not.toBe("");
    }
  });

  it("关掉的公告不再出现在可见列表里", async () => {
    const { ANNOUNCEMENTS, visibleAnnouncements } = await loadAnnouncements();
    const target = ANNOUNCEMENTS[0].id;
    expect(visibleAnnouncements([]).map((item) => item.id)).toContain(target);
    expect(visibleAnnouncements([target]).map((item) => item.id)).not.toContain(target);
  });

  it("关一次就写进本机，刷新后也不再出现", async () => {
    const store = installWindow();
    const first = await loadAnnouncements();
    const id = first.ANNOUNCEMENTS[0].id;
    first.dismissAnnouncement(id);
    expect(first.getDismissedSnapshot()).toEqual([id]);
    expect(store.get("ai-rp:announcements-dismissed:v1")).toBe(JSON.stringify([id]));

    // 重新加载模块相当于刷新页面：先读本机记录，再看得到什么
    vi.resetModules();
    const second = await loadAnnouncements();
    second.loadDismissed();
    expect(
      second.visibleAnnouncements(second.getDismissedSnapshot()).map((item) => item.id),
    ).not.toContain(id);
  });

  it("同一条公告关第二次不会重复记录", async () => {
    const { ANNOUNCEMENTS, dismissAnnouncement, getDismissedSnapshot } =
      await loadAnnouncements();
    const id = ANNOUNCEMENTS[0].id;
    dismissAnnouncement(id);
    dismissAnnouncement(id);
    expect(getDismissedSnapshot()).toEqual([id]);
  });

  it("本机记录坏了不影响别的功能", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => "{ 这不是 JSON",
        setItem: () => {},
        removeItem: () => {},
      },
    });
    const { ANNOUNCEMENTS, dismissAnnouncement, getDismissedSnapshot } =
      await loadAnnouncements();
    expect(getDismissedSnapshot()).toEqual([]);
    dismissAnnouncement(ANNOUNCEMENTS[0].id);
    expect(getDismissedSnapshot()).toEqual([ANNOUNCEMENTS[0].id]);
  });

  it("localStorage 写不进去也只当这一会话反复出现", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
        removeItem: () => {},
      },
    });
    const { ANNOUNCEMENTS, dismissAnnouncement, getDismissedSnapshot } =
      await loadAnnouncements();
    expect(() => dismissAnnouncement(ANNOUNCEMENTS[0].id)).not.toThrow();
    expect(getDismissedSnapshot()).toEqual([ANNOUNCEMENTS[0].id]);
  });
});

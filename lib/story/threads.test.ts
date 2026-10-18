import { describe, expect, it } from "vitest";
import {
  applyThreadPatch,
  formatThreads,
  normalizeThreads,
  sanitizeThreadPatch,
  selectThreads,
  DEFAULT_THREAD_LIMIT,
  RECENT_TURNS,
  type StoryThread,
} from "./threads";

function thread(over: Partial<StoryThread> & { title: string }): StoryThread {
  return {
    id: over.id ?? over.title,
    summary: "",
    status: "open",
    importance: 3,
    lastActiveAt: 0,
    relatedCharacters: [],
    ...over,
  };
}

/** 一轮上下文的默认值：玩家没说话、场景是空的。 */
function context(over: Partial<Parameters<typeof selectThreads>[1]> = {}) {
  return {
    playerInput: "",
    recentText: "",
    presentCharacters: [],
    location: "",
    turn: 10,
    ...over,
  };
}

describe("剧情线：解析", () => {
  it("收下合法条目，丢掉没有标题的", () => {
    const patch = sanitizeThreadPatch([
      { title: "Fuka 为什么突然转学", status: "open", importance: 4, relatedCharacters: ["Fuka"] },
      { title: "" },
      { summary: "没有标题" },
      "不是对象",
    ]);
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ title: "Fuka 为什么突然转学", status: "open", importance: 4 });
  });

  it("保留目标的完成奖励并显示为目标", () => {
    const patch = sanitizeThreadPatch([{ title: "找到失踪的猫", kind: "goal", reward: "获得一枚旧钥匙" }]);
    const update = applyThreadPatch([], patch, 1);
    expect(update.created[0]).toMatchObject({ kind: "goal", reward: "获得一枚旧钥匙" });
    expect(formatThreads(selectThreads(update.threads, context({ playerInput: "我要找到失踪的猫" })))).toContain("【目标】");
  });

  it("重要度收到 1 到 5，状态只认三个值", () => {
    const patch = sanitizeThreadPatch([
      { title: "线", importance: 99, status: "乱写" },
      { title: "线二", importance: -3 },
    ]);
    expect(patch[0].importance).toBe(5);
    expect(patch[0].status).toBeUndefined();
    expect(patch[1].importance).toBe(1);
  });

  it("旧存档补全，坏值丢掉", () => {
    const threads = normalizeThreads([
      { title: "绷带的来历", status: "open", importance: 4, lastActiveAt: 3 },
      { title: 42 },
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ title: "绷带的来历", importance: 4, lastActiveAt: 3 });
  });
});

describe("剧情线：更新", () => {
  it("新线默认 open，重要度默认 3", () => {
    const { threads, created } = applyThreadPatch([], [{ title: "Fuka 为什么转学" }], 5);
    expect(created).toHaveLength(1);
    expect(threads[0]).toMatchObject({ status: "open", importance: 3, lastActiveAt: 5 });
  });

  it("按标题认回同一条线，不重复新建", () => {
    const first = applyThreadPatch([], [{ title: "绷带的来历" }], 1);
    const second = applyThreadPatch(first.threads, [{ title: "绷带的来历", summary: "左手烫伤" }], 3);
    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(1);
    expect(second.threads).toHaveLength(1);
    expect(second.threads[0].summary).toBe("左手烫伤");
    expect(second.threads[0].lastActiveAt).toBe(3);
  });

  it("标题只写一半也能认回来", () => {
    const first = applyThreadPatch([], [{ title: "左手绷带的来历" }], 1);
    const second = applyThreadPatch(first.threads, [{ title: "绷带" }], 2);
    expect(second.created).toHaveLength(0);
    expect(second.threads).toHaveLength(1);
  });

  it("没提到的线保持原样", () => {
    const base = [thread({ title: "线一" }), thread({ title: "线二" })];
    const { threads } = applyThreadPatch(base, [{ title: "线一", summary: "改了" }], 9);
    expect(threads[1]).toEqual(base[1]);
  });

  it("值没变就不算更新", () => {
    const base = [thread({ title: "线一", summary: "原样" })];
    const { updated, threads } = applyThreadPatch(base, [{ title: "线一", summary: "原样" }], 9);
    expect(updated).toHaveLength(0);
    // 但「最近提到」会刷新
    expect(threads[0].lastActiveAt).toBe(9);
  });

  it("标记 resolved 会记进 resolved 列表", () => {
    const base = [thread({ title: "线一" })];
    const { resolved, threads } = applyThreadPatch(base, [{ title: "线一", status: "resolved" }], 4);
    expect(resolved).toHaveLength(1);
    expect(threads[0].status).toBe("resolved");
  });
});

describe("剧情线：已解决的不能复活", () => {
  it("已解决的线再被提到，只刷新最近提到，内容一个字都不改", () => {
    const base = [thread({ title: "绷带的来历", summary: "说是烫伤", status: "resolved", importance: 5 })];
    const { threads, updated, blocked, created } = applyThreadPatch(
      base,
      [{ title: "绷带的来历", summary: "其实是刀伤", status: "open", importance: 1 }],
      7,
    );

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(blocked).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      summary: "说是烫伤",
      status: "resolved",
      importance: 5,
      lastActiveAt: 7,
    });
  });

  it("搁置的线可以被重新打开", () => {
    const base = [thread({ title: "线一", status: "dormant" })];
    const { threads, updated, blocked } = applyThreadPatch(base, [{ title: "线一", status: "open" }], 5);
    expect(blocked).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(threads[0].status).toBe("open");
  });

  it("新线直接标成 resolved 不入库", () => {
    const { threads, created } = applyThreadPatch([], [{ title: "一闪而过", status: "resolved" }], 2);
    expect(created).toHaveLength(0);
    expect(threads).toHaveLength(0);
  });

  it("超过上限时先丢最旧的已解决项", () => {
    const many: StoryThread[] = [];
    for (let i = 0; i < 10; i += 1) {
      many.push(thread({ title: `旧线${i}`, status: "resolved", lastActiveAt: i }));
    }
    for (let i = 0; i < 40; i += 1) {
      many.push(thread({ title: `线${i}`, status: "open", lastActiveAt: 100 + i }));
    }
    const { threads } = applyThreadPatch(many, [], 200);
    expect(threads).toHaveLength(40);
    // 十条已解决的都被丢了，开着的线一条不少
    expect(threads.some((item) => item.status === "resolved")).toBe(false);
    expect(threads.every((item) => item.status === "open")).toBe(true);
  });
});

describe("剧情线：挑选注入（不要每轮全注入）", () => {
  const threads: StoryThread[] = [
    thread({ title: "左手绷带的来历", importance: 5, relatedCharacters: ["深月风花"], lastActiveAt: 1 }),
    thread({ title: "小卖部欠的账", importance: 2, relatedCharacters: ["店员"], lastActiveAt: 2 }),
    thread({ title: "沈砚丢的那卷宗", importance: 4, relatedCharacters: ["沈砚"], lastActiveAt: 1 }),
    thread({ title: "随口提过的雨伞", importance: 1, lastActiveAt: 1 }),
    thread({ title: "早就说完的事", importance: 5, status: "resolved", lastActiveAt: 1 }),
  ];

  it("已解决的线永远不注入", () => {
    const picked = selectThreads(threads, context({ turn: 20, presentCharacters: ["深月风花"] }));
    expect(picked.some((item) => item.thread.title === "早就说完的事")).toBe(false);
  });

  it("玩家主动追问时一定注入，哪怕它很旧、重要度很低", () => {
    const picked = selectThreads(
      [thread({ title: "随口提过的雨伞", importance: 1, lastActiveAt: 1 })],
      context({ playerInput: "那把雨伞呢？", turn: 30 }),
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].reason).toBe("玩家追问");
  });

  it("相关角色在场时注入", () => {
    const picked = selectThreads(threads, context({ presentCharacters: ["沈砚"], turn: 20 }));
    expect(picked.map((item) => item.thread.title)).toContain("沈砚丢的那卷宗");
  });

  it("高重要度即使没人提到也留一条", () => {
    const picked = selectThreads(threads, context({ turn: 20 }));
    expect(picked.map((item) => item.thread.title)).toContain("左手绷带的来历");
    // 重要度 1、没人提到、也不在场景里的，不注入
    expect(picked.map((item) => item.thread.title)).not.toContain("随口提过的雨伞");
  });

  it("最近提到过的会加分", () => {
    const picked = selectThreads(
      threads,
      context({ recentText: "她提了一句小卖部的账。", turn: 4 }),
    );
    expect(picked.map((item) => item.thread.title)).toContain("小卖部欠的账");
  });

  it("太久没提到就不再算最近", () => {
    const old = [thread({ title: "很久以前的事", importance: 2, lastActiveAt: 1 })];
    const fresh = selectThreads(old, context({ recentText: "很久以前的事又来了", turn: 3 }));
    const stale = selectThreads(
      old,
      context({ recentText: "很久以前的事又来了", turn: RECENT_TURNS + 10 }),
    );
    expect(fresh).toHaveLength(1);
    expect(stale).toHaveLength(0);
  });

  it("搁置的线只在玩家追问时注入", () => {
    const dormant = [thread({ title: "搁下的约定", status: "dormant", importance: 5 })];
    expect(selectThreads(dormant, context({ turn: 3 }))).toHaveLength(0);
    expect(
      selectThreads(dormant, context({ playerInput: "那个约定还算数吗", turn: 3 })),
    ).toHaveLength(1);
  });

  it("最多三条，按分数排", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      thread({ title: `线${i}`, importance: 5, relatedCharacters: ["深月风花"], lastActiveAt: 10 }),
    );
    const picked = selectThreads(many, context({ presentCharacters: ["深月风花"], turn: 10 }));
    expect(picked).toHaveLength(DEFAULT_THREAD_LIMIT);
    expect(picked[0].score).toBeGreaterThanOrEqual(picked[1].score);
  });

  it("没有任何线时返回空，不报错", () => {
    expect(selectThreads([], context())).toEqual([]);
  });
});

describe("剧情线：拼进提示词", () => {
  it("措辞压着：说「不要硬推进」，不说「请推进」", () => {
    const picked = selectThreads(
      [thread({ title: "左手绷带的来历", summary: "她说是烫伤", importance: 5 })],
      context({ turn: 2 }),
    );
    const text = formatThreads(picked);
    expect(text).toContain("左手绷带的来历：她说是烫伤");
    expect(text).toContain("不要为了它们硬推进");
    expect(text).toContain("不要在正文里提起这个列表");
    expect(text).not.toContain("请推进");
  });

  it("没有选中任何线时不占行", () => {
    expect(formatThreads([])).toBe("");
  });
});

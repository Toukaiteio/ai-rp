import { describe, expect, it } from "vitest";
import {
  MAIN_BRANCH,
  MAX_BRANCHES,
  appendToBranch,
  branchPoint,
  createBranch,
  describeBranch,
  mainBranch,
  normalizeTree,
  removeBranch,
  resolveBranch,
  type BranchTree,
  type ChatBranch,
} from "./branch";

const MAIN = ["m0", "m1", "m2", "m3", "m4"];

function treeWith(branches: ChatBranch[], messages: Record<string, string[]> = {}): BranchTree {
  return { branches, messages: { [MAIN_BRANCH]: [], ...messages } };
}

describe("分支：建分支", () => {
  it("主干永远在，且不能删", () => {
    expect(mainBranch()).toMatchObject({ id: MAIN_BRANCH, parentMessageId: "" });
    const tree = treeWith([mainBranch()]);
    expect(removeBranch(tree, MAIN_BRANCH).branches).toHaveLength(1);
  });

  it("从某条消息分出一条新分支", () => {
    const result = createBranch({
      id: "b1",
      parentMessageId: "m2",
      title: "走天台那条线",
      createdAt: 100,
      inheritedMessageIds: ["m0", "m1", "m2"],
      existing: [mainBranch()],
    });
    expect(result).not.toBeNull();
    expect(result?.branch).toMatchObject({
      id: "b1",
      parentMessageId: "m2",
      title: "走天台那条线",
    });
    expect(result?.tree.messages.b1).toEqual(["m0", "m1", "m2"]);
  });

  it("没给标题也能建", () => {
    const result = createBranch({
      id: "b1",
      parentMessageId: "m2",
      createdAt: 1,
      inheritedMessageIds: [],
      existing: [mainBranch()],
    });
    expect(result?.branch.title).toBeUndefined();
  });

  it("id 重复时不建", () => {
    const existing = [mainBranch(), { id: "b1", parentMessageId: "m1", createdAt: 1 }];
    expect(
      createBranch({ id: "b1", parentMessageId: "m2", createdAt: 2, inheritedMessageIds: [], existing }),
    ).toBeNull();
  });

  it("到上限就不建了", () => {
    const existing = [mainBranch()];
    for (let i = 0; i < MAX_BRANCHES; i += 1) {
      existing.push({ id: `b${i}`, parentMessageId: "m1", createdAt: i });
    }
    expect(
      createBranch({ id: "new", parentMessageId: "m2", createdAt: 9, inheritedMessageIds: [], existing }),
    ).toBeNull();
  });

  it("标题太长会截断", () => {
    const result = createBranch({
      id: "b1",
      parentMessageId: "m1",
      title: "很长的标题".repeat(10),
      createdAt: 1,
      inheritedMessageIds: [],
      existing: [mainBranch()],
    });
    expect(result?.branch.title?.length).toBeLessThanOrEqual(24);
  });
});

describe("分支：从哪儿接下去", () => {
  const branch: ChatBranch = { id: "b1", parentMessageId: "m2", createdAt: 1 };

  it("接在父消息的后面", () => {
    expect(branchPoint(branch, MAIN)).toBe(3);
  });

  it("主干永远接在末尾", () => {
    expect(branchPoint(mainBranch(), MAIN)).toBe(5);
  });

  it("没有父消息时从开场接", () => {
    expect(branchPoint({ ...branch, parentMessageId: "" }, MAIN)).toBe(0);
  });

  it("父消息找不到时退到末尾，不让分支变成空的", () => {
    expect(branchPoint({ ...branch, parentMessageId: "被删了" }, MAIN)).toBe(5);
  });
});

describe("分支：切过去显示什么", () => {
  const branch: ChatBranch = { id: "b1", parentMessageId: "m2", createdAt: 1 };

  it("主干留到分叉点，接上分支自己的消息", () => {
    const tree = treeWith([mainBranch(), branch], { b1: ["m0", "m1", "m2", "x0", "x1"] });
    const view = resolveBranch(branch, tree, MAIN);
    expect(view.baseIds).toEqual(["m0", "m1", "m2"]);
    expect(view.branchIds).toEqual(["m0", "m1", "m2", "x0", "x1"]);
  });

  it("分支还没有自己的消息时，就是主干到分叉点为止", () => {
    const tree = treeWith([mainBranch(), branch]);
    expect(resolveBranch(branch, tree, MAIN).branchIds).toEqual([]);
  });

  it("主干视图是全部消息", () => {
    const tree = treeWith([mainBranch()], { [MAIN_BRANCH]: MAIN });
    const view = resolveBranch(mainBranch(), tree, MAIN);
    expect(view.baseIds).toEqual(MAIN);
    expect(view.branchIds).toEqual(MAIN);
  });
});

describe("分支：往下长", () => {
  it("追加消息到分支", () => {
    const tree = treeWith([mainBranch(), { id: "b1", parentMessageId: "m1", createdAt: 1 }], { b1: ["x0"] });
    const next = appendToBranch(tree, "b1", ["x1", "x2"]);
    expect(next.messages.b1).toEqual(["x0", "x1", "x2"]);
  });

  it("往主干追加不在这里管", () => {
    const tree = treeWith([mainBranch()]);
    expect(appendToBranch(tree, MAIN_BRANCH, ["m0"])).toBe(tree);
  });

  it("删分支时把它的消息一起清掉", () => {
    const tree = treeWith(
      [mainBranch(), { id: "b1", parentMessageId: "m1", createdAt: 1 }],
      { b1: ["x0"] },
    );
    const next = removeBranch(tree, "b1");
    expect(next.branches).toHaveLength(1);
    expect(next.messages.b1).toBeUndefined();
  });
});

describe("分支：标题", () => {
  it("有标题就用标题", () => {
    expect(describeBranch({ id: "b1", parentMessageId: "m1", title: "天台线", createdAt: 1 }, 1)).toBe("天台线");
  });

  it("没标题就用序号", () => {
    expect(describeBranch({ id: "b1", parentMessageId: "m1", createdAt: 1 }, 2)).toBe("分支 2");
  });

  it("主干永远叫主线", () => {
    expect(describeBranch(mainBranch(), 0)).toBe("主线");
  });
});

describe("分支：旧存档补全", () => {
  it("坏值丢掉，主干补上", () => {
    const tree = normalizeTree({ branches: [{ id: "b1", parentMessageId: "m1" }, { id: "" }, 42] });
    expect(tree.branches.map((branch) => branch.id)).toEqual([MAIN_BRANCH, "b1"]);
    expect(tree.messages[MAIN_BRANCH]).toEqual([]);
    expect(tree.messages.b1).toEqual([]);
  });

  it("完全没有分支数据时给一棵只有主干的树", () => {
    expect(normalizeTree(undefined).branches).toHaveLength(1);
    expect(normalizeTree("乱写").branches).toHaveLength(1);
  });

  it("消息列表里的坏值丢掉", () => {
    const tree = normalizeTree({
      branches: [{ id: "b1", parentMessageId: "m1" }],
      messages: { b1: ["x0", 42, "", "x1"] },
    });
    expect(tree.messages.b1).toEqual(["x0", "x1"]);
  });

  it("重复的 id 只留一条", () => {
    const tree = normalizeTree({
      branches: [
        { id: "b1", parentMessageId: "m1" },
        { id: "b1", parentMessageId: "m2" },
      ],
    });
    expect(tree.branches.filter((branch) => branch.id === "b1")).toHaveLength(1);
  });

  it("补全之后再补全还是同一份（幂等）", () => {
    const once = normalizeTree({
      branches: [{ id: "b1", parentMessageId: "m1", title: "线" }],
      messages: { b1: ["x0"] },
    });
    expect(normalizeTree(once)).toEqual(once);
  });
});

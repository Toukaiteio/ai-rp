import { describe, expect, it } from "vitest";
import {
  inferResponseMode,
  modeInstruction,
  MODE_INSTRUCTIONS,
  MODE_LABELS,
  RESPONSE_MODES,
  type ResponseMode,
} from "./mode";

describe("回合模式：推断", () => {
  it("要求继续或上一段被截断时用 continue", () => {
    expect(inferResponseMode({ playerInput: "继续" })).toBe("continue");
    expect(inferResponseMode({ playerInput: "接着写" })).toBe("continue");
    expect(inferResponseMode({ playerInput: "然后呢？" })).toBe("continue");
    expect(inferResponseMode({ playerInput: "go on" })).toBe("continue");
    expect(
      inferResponseMode({ playerInput: "随便说点什么", previousReply: "话说到一半", truncated: true }),
    ).toBe("continue");
  });

  it("要求换场或跳时间时用 scene", () => {
    expect(inferResponseMode({ playerInput: "（我们换个场景，第二天早上。）" })).toBe("scene");
    expect(inferResponseMode({ playerInput: "时间跳到傍晚。" })).toBe("scene");
    expect(inferResponseMode({ playerInput: "第二天我再来。" })).toBe("scene");
  });

  it("提问时用 dialogue，中文问句没有问号也算", () => {
    expect(inferResponseMode({ playerInput: "你昨晚去哪儿了？" })).toBe("dialogue");
    expect(inferResponseMode({ playerInput: "这店开了多少年" })).toBe("dialogue");
    expect(inferResponseMode({ playerInput: "你为什么不说话" })).toBe("dialogue");
  });

  it("一两个词用 short", () => {
    expect(inferResponseMode({ playerInput: "……" })).toBe("short");
    expect(inferResponseMode({ playerInput: "哦" })).toBe("short");
    expect(inferResponseMode({ playerInput: "我坐下" })).toBe("short");
    expect(inferResponseMode({ playerInput: "" })).toBe("short");
  });

  it("陈述句里的「什么也」不是提问", () => {
    // 真机跑批里抓到：「我什么也没说」被判成 dialogue，角色就一直在说话
    expect(inferResponseMode({ playerInput: "我什么也没说，就站在门口看着她。" })).toBe("normal");
    expect(inferResponseMode({ playerInput: "没什么好说的，我把伞放下。" })).toBe("normal");
  });

  it("普通叙述用 normal", () => {
    expect(inferResponseMode({ playerInput: "我把湿外套挂在门边的钉子上，坐到你对面。" })).toBe(
      "normal",
    );
  });

  it("优先顺序：续写 > 换场 > 提问 > 太短 > 正常", () => {
    // 「继续」两个字既像短回应又像续写，必须判续写
    expect(inferResponseMode({ playerInput: "继续" })).toBe("continue");
    // 换场句里常常带疑问词，换场优先
    expect(inferResponseMode({ playerInput: "第二天早上，她会说什么呢？" })).toBe("scene");
    // 短句里带疑问词，按提问算
    expect(inferResponseMode({ playerInput: "谁？" })).toBe("dialogue");
  });

  it("玩家输入里的 player 标记不影响判断", () => {
    expect(inferResponseMode({ playerInput: "<player>继续</player>" })).toBe("continue");
  });

  it("五个模式都有标签和指令，指令说的是「写什么」", () => {
    for (const mode of RESPONSE_MODES) {
      expect(MODE_LABELS[mode].length).toBeGreaterThan(0);
      expect(MODE_INSTRUCTIONS[mode].length).toBeGreaterThan(0);
      // 每条指令都要给出具体的做法，不能只有一句「正常写」
      expect(MODE_INSTRUCTIONS[mode].length).toBeGreaterThan(15);
    }
  });

  it("modeInstruction 把模式和做法拼成一行", () => {
    const line = modeInstruction("short");
    expect(line).toContain("简短回应");
    expect(line).toContain("不主动引入新剧情");
  });

  it("每个模式的要求互不重复，覆盖各自的节奏", () => {
    const seen = new Set<string>();
    for (const mode of RESPONSE_MODES) {
      expect(seen.has(MODE_INSTRUCTIONS[mode])).toBe(false);
      seen.add(MODE_INSTRUCTIONS[mode]);
    }
    const expectations: Record<ResponseMode, string> = {
      normal: "接住玩家这一句",
      short: "一个动作、一段对白",
      dialogue: "以对白为主",
      scene: "允许推进场景",
      continue: "只接着上一段",
    };
    for (const mode of RESPONSE_MODES) {
      expect(MODE_INSTRUCTIONS[mode]).toContain(expectations[mode]);
    }
  });
});

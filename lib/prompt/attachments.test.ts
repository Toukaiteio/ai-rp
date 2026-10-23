import { describe, expect, it } from "vitest";
import { assemble } from "@/lib/prompt";

describe("attachment prompt integration", () => {
  it("lists attachments without injecting script source", () => {
    const result = assemble({
      card: {
        name: "港口守望者",
        description: "",
        personality: "",
        scenario: "港口",
        attachments: [
          {
            id: "codex-1",
            kind: "codex",
            version: "1",
            title: "港口资料",
            entries: [{ id: "tide", title: "潮汐", content: "潮水每天涨落。", tags: [], enabled: true }],
          },
          {
            id: "script-1",
            kind: "script",
            version: "1",
            title: "危险脚本",
            runtime: "sandbox",
            source: "globalThis.secret = true",
            requestedPermissions: { network: true, filesystem: true, cardScope: true },
            permissions: { network: false, filesystem: false, cardScope: true },
            status: "unsupported",
            enabled: false,
          },
        ],
      },
      history: [{ role: "user", content: "看一下资料" }],
      seed: 1,
      budget: 4_000,
    });
    const text = result.messages.map((message) => message.content).join("\n");
    expect(text).toContain("codex codex-1");
    expect(text).toContain("script script-1");
    expect(text).toContain("不可执行");
    expect(text).not.toContain("globalThis.secret");
  });
});

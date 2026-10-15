import { describe, expect, it } from "vitest";
import { rememberDecision, type RememberSeal } from "./remember";

function seal(overrides: Partial<RememberSeal> = {}): RememberSeal {
  return {
    issuedAt: 1_000_000,
    maxAgeMs: 60 * 60 * 1000,
    idleMs: 60 * 60 * 1000,
    lastActive: 1_000_000,
    ...overrides,
  };
}

describe("自动解锁的时限", () => {
  it("绝对时限到了就作废，中间有操作也不延长", () => {
    const row = seal({ lastActive: 1_000_000 + 50 * 60 * 1000 });
    expect(rememberDecision(row, row.issuedAt + row.maxAgeMs + 1)).toBe("expired");
  });

  it("没操作也不会提前作废，只看选中的时长", () => {
    const row = seal();
    expect(rememberDecision(row, row.lastActive + 30 * 60 * 1000)).toBe("ok");
  });

  it("时钟往回拨当作废", () => {
    const row = seal();
    expect(rememberDecision(row, row.issuedAt - 120_000)).toBe("clock");
  });

  it("时限内且刚操作过就仍然有效", () => {
    const row = seal();
    expect(rememberDecision(row, row.issuedAt + 60_000)).toBe("ok");
  });
});

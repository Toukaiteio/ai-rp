import { describe, expect, it } from "vitest";
import { rollNotation } from "./dice";

describe("掷骰", () => {
  it("按给定的点数加总，并带上调整值", () => {
    const faces = [4, 6];
    const rolled = rollNotation("2d6+3", () => {
      const next = faces.shift();
      return (next ?? 1) - 1;
    });
    expect(rolled).toEqual({
      notation: "2d6+3",
      total: 13,
      detail: "2d6+3 = 13（4+6+3）",
    });
  });

  it("省略个数时当作 1 颗", () => {
    const rolled = rollNotation("d20", () => 0);
    expect(rolled?.detail).toBe("1d20 = 1（1）");
  });

  it("面数、个数超出范围就不掷", () => {
    expect(rollNotation("0d6")).toBeNull();
    expect(rollNotation("21d6")).toBeNull();
    expect(rollNotation("1d1")).toBeNull();
    expect(rollNotation("1d101")).toBeNull();
    expect(rollNotation("攻击")).toBeNull();
  });
});

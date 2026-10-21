import { describe, expect, it, vi } from "vitest";
import { resolveOnlineCardStartAction } from "./online-card-action";

describe("resolveOnlineCardStartAction", () => {
  it("opens a downloaded local card instead of trying to download it again", () => {
    const selectLocal = vi.fn();
    const add = vi.fn();
    const action = resolveOnlineCardStartAction({
      localId: "local-card",
      done: true,
      onSelectLocal: selectLocal,
      onAdd: add,
    });

    action?.();

    expect(selectLocal).toHaveBeenCalledWith("local-card");
    expect(add).not.toHaveBeenCalled();
  });

  it("downloads a card that is not local yet", () => {
    const add = vi.fn();
    const action = resolveOnlineCardStartAction({ done: false, onAdd: add });

    action?.();

    expect(add).toHaveBeenCalledOnce();
  });

  it("does not expose an action after a completed add without a local record", () => {
    const add = vi.fn();

    expect(resolveOnlineCardStartAction({ done: true, onAdd: add })).toBeUndefined();
  });
});

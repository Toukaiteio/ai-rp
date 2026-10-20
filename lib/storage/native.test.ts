import { afterEach, describe, expect, it } from "vitest";
import { hasNativeFilePicker, isAndroidApp, pickNativeFile } from "./native";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("Android 文件适配层", () => {
  it("通过 bridge 把原生选择器返回的 base64 文件还原为 File", async () => {
    const data = Buffer.from("{\"name\":\"Fuka\"}").toString("base64");
    (globalThis as { window?: unknown }).window = {
      AndroidBridge: {
        pickFile: () => JSON.stringify({ name: "fuka.json", type: "application/json", data }),
      },
    };

    expect(isAndroidApp()).toBe(true);
    expect(hasNativeFilePicker()).toBe(true);
    const file = await pickNativeFile("application/json,.json");
    expect(file?.name).toBe("fuka.json");
    expect(file?.type).toBe("application/json");
    expect(await file?.text()).toBe('{"name":"Fuka"}');
  });

  it("没有 bridge 时返回空文件，不阻塞浏览器端入口", async () => {
    expect(isAndroidApp()).toBe(false);
    expect(hasNativeFilePicker()).toBe(false);
    await expect(pickNativeFile("application/json")).resolves.toBeNull();
  });
});

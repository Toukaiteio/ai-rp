import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScriptPermissionWarning, type ScriptPermissionWarningCopy } from "./ScriptPermissionWarning";

const chineseCopy: ScriptPermissionWarningCopy = {
  warningTitle: "脚本权限受限",
  scriptNotExecuted: "脚本当前不会执行。",
  sensitivePermissionsBlocked: "联网/本地文件权限暂不允许。",
  forcedAfterSave: "保存后仍会被强制限制。",
  disableSensitive: "关闭敏感权限",
  safeStatus: "脚本权限安全：仅允许卡片范围。",
  permissionLabels: {
    network: "联网",
    filesystem: "本地文件",
    cardScope: "卡片范围",
  },
  status: {
    requested: "请求",
    notRequested: "未请求",
    allowed: "允许",
    blocked: "受限",
  },
};

const englishCopy: ScriptPermissionWarningCopy = {
  warningTitle: "Script permissions are restricted",
  scriptNotExecuted: "The script will not run.",
  sensitivePermissionsBlocked: "Network and local-file access are not allowed yet.",
  forcedAfterSave: "The restriction still applies after saving.",
  disableSensitive: "Disable sensitive permissions",
  safeStatus: "Script permissions are safe: card scope only.",
  permissionLabels: {
    network: "Network",
    filesystem: "Local files",
    cardScope: "Card scope",
  },
  status: {
    requested: "requested",
    notRequested: "not requested",
    allowed: "allowed",
    blocked: "blocked",
  },
};

const restrictedPolicy = {
  network: false,
  filesystem: false,
  cardScope: true,
};

describe("ScriptPermissionWarning", () => {
  it("shows a restrained warning and the disable action for sensitive requests", () => {
    const html = renderToStaticMarkup(
      <ScriptPermissionWarning
        requestedPermissions={{ network: true, filesystem: true, cardScope: true }}
        currentPolicy={restrictedPolicy}
        copy={chineseCopy}
        onDisableSensitive={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('data-sensitive-warning="true"');
    expect(html).toContain("脚本当前不会执行。");
    expect(html).toContain("联网/本地文件权限暂不允许。");
    expect(html).toContain("保存后仍会被强制限制。");
    expect(html).toContain("关闭敏感权限");
    expect(html).toContain('data-permission="network"');
    expect(html).toContain('data-policy="blocked"');
    expect(html).toContain('data-permission="cardScope"');
    expect(html).toContain('data-policy="allowed"');
  });

  it("only shows the safe state when no sensitive permission is requested", () => {
    const html = renderToStaticMarkup(
      <ScriptPermissionWarning
        requestedPermissions={{ network: false, filesystem: false, cardScope: true }}
        currentPolicy={restrictedPolicy}
        copy={chineseCopy}
        onDisableSensitive={() => {}}
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-sensitive-warning="false"');
    expect(html).toContain("脚本权限安全：仅允许卡片范围。");
    expect(html).not.toContain("脚本权限受限");
    expect(html).not.toContain("关闭敏感权限");
  });

  it("renders caller-provided English copy without an i18n dependency", () => {
    const html = renderToStaticMarkup(
      <ScriptPermissionWarning
        requestedPermissions={{ network: true, filesystem: false, cardScope: true }}
        currentPolicy={restrictedPolicy}
        copy={englishCopy}
        onDisableSensitive={() => {}}
      />,
    );

    expect(html).toContain("The script will not run.");
    expect(html).toContain("Network and local-file access are not allowed yet.");
    expect(html).toContain("Disable sensitive permissions");
    expect(html).not.toContain("脚本当前不会执行");
  });
});

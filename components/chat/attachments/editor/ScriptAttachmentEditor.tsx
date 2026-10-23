"use client";

import { PillButton } from "@/components/ui";
import type { ScriptAttachment } from "@/lib/attachments";
import type { CardPolishField } from "@/lib/cards";
import { AiPolishButton } from "../../AiPolishButton";
import { ScriptPermissionWarning } from "./ScriptPermissionWarning";

const FIELD_CLASS =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong";

const SAFE_PERMISSIONS = { network: false as const, filesystem: false as const, cardScope: true as const };

const WARNING_COPY = {
  warningTitle: "脚本权限已被限制",
  scriptNotExecuted: "脚本不会执行。",
  sensitivePermissionsBlocked: "敏感权限会在保存时强制关闭。",
  forcedAfterSave: "保存后固定为 sandbox、unsupported、disabled。",
  disableSensitive: "应用安全策略",
  safeStatus: "脚本仅作为卡片内容保存。",
  permissionLabels: { network: "网络", filesystem: "文件系统", cardScope: "卡片范围" },
  status: { requested: "请求", notRequested: "未请求", allowed: "允许", blocked: "阻止" },
} as const;

function sourceLooksSensitive(source: string): boolean {
  return /fetch\s*\(|xmlhttprequest|websocket|filesystem|file system|require\s*\(|import\s+|\bhttps?:\/\//i.test(source);
}

export function ScriptAttachmentEditor({
  attachment,
  onChange,
  onDelete,
  onPolish = async () => "",
  polishingKey = null,
  polishLabel = "AI polish",
  polishingLabel = "…",
}: {
  attachment: ScriptAttachment;
  onChange: (attachment: ScriptAttachment) => void;
  onDelete: () => void;
  onPolish?: (field: CardPolishField, value: string, key: string) => Promise<string>;
  polishingKey?: string | null;
  polishLabel?: string;
  polishingLabel?: string;
}) {
  const requestedPermissions = attachment.requestedPermissions ?? {
    network: false,
    filesystem: false,
    cardScope: true,
  };
  const sourceSensitive = sourceLooksSensitive(attachment.source);
  const sensitive = sourceSensitive || requestedPermissions.network || requestedPermissions.filesystem;

  function patch(patch: Partial<ScriptAttachment>) {
    onChange({
      ...attachment,
      ...patch,
      runtime: "sandbox",
      permissions: SAFE_PERMISSIONS,
      status: "unsupported",
      enabled: false,
    });
  }

  function setRequestedPermission(key: "network" | "filesystem" | "cardScope", value: boolean) {
    patch({
      requestedPermissions: {
        ...requestedPermissions,
        [key]: value,
      },
    });
  }

  function polishTitle() {
    void onPolish("script_title", attachment.title ?? "", `${attachment.id}:title`)
      .then((title) => patch({ title }))
      .catch(() => undefined);
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-[15px] font-bold text-ink">脚本设置</h3>
          <p className="m-0 mt-1 text-[11.5px] text-ink-3">脚本只保存，不会在应用内执行。</p>
        </div>
        <PillButton type="button" size="sm" variant="danger" onClick={onDelete}>删除</PillButton>
      </div>
      {sensitive ? (
        <div className="mt-4">
          <ScriptPermissionWarning
            requestedPermissions={{
              network: sourceSensitive || requestedPermissions.network,
              filesystem: sourceSensitive || requestedPermissions.filesystem,
              cardScope: requestedPermissions.cardScope,
            }}
            currentPolicy={SAFE_PERMISSIONS}
            copy={WARNING_COPY}
            onDisableSensitive={() => patch({ permissions: SAFE_PERMISSIONS })}
          />
        </div>
      ) : null}
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-ink">ID</span>
            <input className={FIELD_CLASS} value={attachment.id} onChange={(event) => patch({ id: event.target.value })} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2 text-[12px] font-bold text-ink">
              <span>标题</span>
              <AiPolishButton
                onClick={polishTitle}
                busy={polishingKey === `${attachment.id}:title`}
                label={polishLabel}
                workingLabel={polishingLabel}
              />
            </span>
            <input className={FIELD_CLASS} value={attachment.title ?? ""} onChange={(event) => patch({ title: event.target.value })} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-ink">Source</span>
          <textarea className={`${FIELD_CLASS} min-h-[280px] resize-y font-mono text-[12px] leading-relaxed`} value={attachment.source} onChange={(event) => patch({ source: event.target.value })} spellCheck={false} />
        </label>
        <div className="grid gap-2 text-[11.5px] text-ink-3 sm:grid-cols-3">
          <span className="rounded-md bg-surface-2 px-3 py-2">network: false</span>
          <span className="rounded-md bg-surface-2 px-3 py-2">filesystem: false</span>
          <span className="rounded-md bg-surface-2 px-3 py-2">cardScope: true</span>
        </div>
        <fieldset className="grid gap-2 rounded-md border border-line bg-surface-2 p-3">
          <legend className="px-1 text-[12px] font-bold text-ink">脚本申请的权限</legend>
          {([
            ["network", "网络"],
            ["filesystem", "本地文件"],
            ["cardScope", "卡片范围"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 text-[12px] text-ink-2">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={requestedPermissions[key]}
                onChange={(event) => setRequestedPermission(key, event.target.checked)}
              />
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  );
}

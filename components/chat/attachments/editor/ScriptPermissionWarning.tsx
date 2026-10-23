import type { ReactNode } from "react";
import type { ScriptPermissions } from "@/lib/attachments";
import { Capsule, PillButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export type ScriptPermissionKey = keyof ScriptPermissions;

export type ScriptPermissionPolicy = {
  [Key in ScriptPermissionKey]: boolean;
};

export interface ScriptPermissionWarningCopy {
  warningTitle: ReactNode;
  scriptNotExecuted: ReactNode;
  sensitivePermissionsBlocked: ReactNode;
  forcedAfterSave: ReactNode;
  disableSensitive: ReactNode;
  safeStatus: ReactNode;
  permissionLabels: Record<ScriptPermissionKey, ReactNode>;
  status: {
    requested: ReactNode;
    notRequested: ReactNode;
    allowed: ReactNode;
    blocked: ReactNode;
  };
}

export interface ScriptPermissionWarningProps {
  requestedPermissions: ScriptPermissionPolicy;
  currentPolicy: ScriptPermissionPolicy;
  copy: ScriptPermissionWarningCopy;
  onDisableSensitive: () => void;
  className?: string;
}

const PERMISSION_KEYS: ScriptPermissionKey[] = ["network", "filesystem", "cardScope"];

export function ScriptPermissionWarning({
  requestedPermissions,
  currentPolicy,
  copy,
  onDisableSensitive,
  className,
}: ScriptPermissionWarningProps) {
  const hasSensitivePermissions = requestedPermissions.network || requestedPermissions.filesystem;

  return (
    <section
      role={hasSensitivePermissions ? "alert" : "status"}
      data-sensitive-warning={hasSensitivePermissions ? "true" : "false"}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border p-3 md:p-4",
        hasSensitivePermissions ? "border-danger bg-danger-soft" : "border-line bg-surface-2",
        className,
      )}
    >
      <div className="min-w-0">
        {hasSensitivePermissions ? <h3 className="m-0 mb-1 text-[14px] font-bold text-danger">{copy.warningTitle}</h3> : null}
        <p className={cn("m-0 break-words text-[13px] leading-relaxed", hasSensitivePermissions ? "text-ink" : "text-ink-2")}>
          {hasSensitivePermissions ? (
            <>
              {copy.scriptNotExecuted} {copy.sensitivePermissionsBlocked}
            </>
          ) : (
            copy.safeStatus
          )}
        </p>
      </div>

      <div className="flex min-w-0 flex-wrap gap-2" role="list">
        {PERMISSION_KEYS.map((key) => {
          const requested = requestedPermissions[key];
          const allowed = currentPolicy[key];
          return (
            <Capsule
              key={key}
              role="listitem"
              data-permission={key}
              data-requested={requested ? "true" : "false"}
              data-policy={allowed ? "allowed" : "blocked"}
              tone={allowed ? "strong" : "muted"}
              className={cn(
                "max-w-full flex-wrap whitespace-normal break-words",
                allowed ? "border-ok bg-ok-soft text-ok" : "border-danger bg-danger-soft text-danger",
              )}
            >
              <span className="break-words">{copy.permissionLabels[key]}</span>
              <span aria-hidden="true">·</span>
              <span className="break-words">{requested ? copy.status.requested : copy.status.notRequested}</span>
              <span aria-hidden="true">/</span>
              <span className="break-words">{allowed ? copy.status.allowed : copy.status.blocked}</span>
            </Capsule>
          );
        })}
      </div>

      {hasSensitivePermissions ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-danger pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 min-w-0 break-words text-[12px] leading-relaxed text-ink-2">{copy.forcedAfterSave}</p>
          <PillButton
            size="sm"
            variant="ghost"
            onClick={onDisableSensitive}
            className="w-full shrink-0 sm:w-auto"
          >
            {copy.disableSensitive}
          </PillButton>
        </div>
      ) : null}
    </section>
  );
}

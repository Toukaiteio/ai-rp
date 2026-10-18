export const BACKUP_INTERVAL_HOURS = [24, 72, 168] as const;

export type BackupIntervalHours = (typeof BACKUP_INTERVAL_HOURS)[number];

export interface AutoBackupSettings {
  enabled: boolean;
  intervalHours: BackupIntervalHours;
  lastBackupAt: number | null;
}

export function defaultAutoBackupSettings(): AutoBackupSettings {
  return { enabled: false, intervalHours: 24, lastBackupAt: null };
}

export function normalizeAutoBackupSettings(value: Partial<AutoBackupSettings> | undefined): AutoBackupSettings {
  const defaults = defaultAutoBackupSettings();
  const intervalHours = BACKUP_INTERVAL_HOURS.includes(value?.intervalHours as BackupIntervalHours)
    ? (value?.intervalHours as BackupIntervalHours)
    : defaults.intervalHours;
  return {
    enabled: value?.enabled === true,
    intervalHours,
    lastBackupAt: typeof value?.lastBackupAt === "number" && value.lastBackupAt > 0 ? value.lastBackupAt : null,
  };
}

export function isBackupDue(settings: AutoBackupSettings, now = Date.now()): boolean {
  if (!settings.enabled) return false;
  if (settings.lastBackupAt === null) return true;
  return now - settings.lastBackupAt >= settings.intervalHours * 60 * 60 * 1000;
}

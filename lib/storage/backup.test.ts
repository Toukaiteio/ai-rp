import { describe, expect, it } from "vitest";
import { defaultAutoBackupSettings, isBackupDue, normalizeAutoBackupSettings } from "./backup";

describe("automatic backup schedule", () => {
  it("defaults to disabled daily backups", () => {
    expect(defaultAutoBackupSettings()).toEqual({ enabled: false, intervalHours: 24, lastBackupAt: null });
  });

  it("normalizes settings from the encrypted slot", () => {
    expect(normalizeAutoBackupSettings({ enabled: true, intervalHours: 72, lastBackupAt: -1 })).toEqual({
      enabled: true,
      intervalHours: 72,
      lastBackupAt: null,
    });
  });

  it("only reports an enabled schedule as due", () => {
    const now = 1_000_000;
    expect(isBackupDue({ enabled: false, intervalHours: 24, lastBackupAt: null }, now)).toBe(false);
    expect(isBackupDue({ enabled: true, intervalHours: 24, lastBackupAt: null }, now)).toBe(true);
    expect(isBackupDue({ enabled: true, intervalHours: 24, lastBackupAt: now - 24 * 60 * 60 * 1000 }, now)).toBe(true);
    expect(isBackupDue({ enabled: true, intervalHours: 24, lastBackupAt: now - 1 }, now)).toBe(false);
  });
});

const STORAGE_KEY = "ai-rp:card-translation-reminder:v1";

export function shouldConfirmCardTranslation(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "skip";
  } catch {
    return true;
  }
}

export function confirmCardTranslation(skipReminder: boolean): void {
  if (!skipReminder) return;
  try {
    localStorage.setItem(STORAGE_KEY, "skip");
  } catch {
    // 无法持久化时，下次继续提醒。
  }
}

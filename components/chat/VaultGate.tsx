"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { AnnouncementBell, AnnouncementDialog } from "./Announcements";
import { IconGithub, IconLock } from "@/components/icons";
import { PillButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { explainError } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { MessageKey } from "@/lib/i18n";
import {
  MAX_ATTEMPTS,
  MIN_PASSPHRASE_LENGTH,
  probeVault,
  setupVault,
  unlockVault,
  type VaultStatus as VaultState,
} from "@/lib/vault";
import {
  REMEMBER_OPTIONS,
  getRememberPref,
  getRememberPrefServer,
  loadRememberPref,
  setRememberPref,
  subscribeRememberPref,
  type RememberOptionId,
} from "@/lib/vault/remember";

/**
 * 未解锁时的唯一入口。
 *
 * 这个画面不加载任何聊天内容、不显示任何配置，
 * 因为那些数据全在密文里，没有密钥本来也读不出来。
 * 画面只留三样：一把锁、一个输入框、一个按钮。公告在右上角。
 */

export function VaultGate({
  status,
  attemptsLeft,
  notice,
}: {
  status: VaultState;
  attemptsLeft: number;
  notice: string | null;
}) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const { t } = useI18n();
  const rememberMs = useSyncExternalStore(
    subscribeRememberPref,
    getRememberPref,
    getRememberPrefServer,
  );

  useEffect(() => {
    loadRememberPref();
    void probeVault();
  }, []);

  const isSetup = status === "uninitialized";

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (isSetup) {
        await setupVault(value, confirm, rememberMs);
        setValue("");
        setConfirm("");
      } else {
        await unlockVault(value, rememberMs);
        setValue("");
      }
    } catch (caught) {
      setError(explainError(caught, t));
      setValue("");
      setConfirm("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-dvh items-center justify-center bg-background px-6 pb-[18dvh]">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <a
          href="https://github.com/Toukaiteio/ai-rp"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("vault.github")}
          className="grid size-10 shrink-0 place-items-center rounded-pill border border-line bg-surface text-ink transition-colors hover:border-line-strong"
        >
          <IconGithub className="size-[18px]" />
        </a>
        <AnnouncementBell onClick={() => setAnnounceOpen(true)} />
      </div>

      <div className="relative flex w-full max-w-[360px] flex-col items-center">
        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void submit();
          }}
        >
          <div className="flex items-center gap-2 rounded-pill border border-line bg-surface pr-1.5 pl-4 transition-colors focus-within:border-line-strong">
            <IconLock className="size-[17px] shrink-0 text-ink-2" />
            <input
              type="password"
              autoFocus
              autoComplete={isSetup ? "new-password" : "current-password"}
              spellCheck={false}
              placeholder={
                isSetup
                  ? t("vault.placeholderSetup", { min: MIN_PASSPHRASE_LENGTH })
                  : t("vault.placeholder")
              }
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[14.5px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {isSetup ? (
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder={t("vault.confirm")}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full rounded-pill border border-line bg-surface px-5 py-3 text-center text-[14.5px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
          ) : null}

          <PillButton
            variant="primary"
            block
            disabled={busy || !value || (isSetup && !confirm)}
            onClick={() => void submit()}
          >
            {busy ? t("vault.deriving") : isSetup ? t("vault.setup") : t("vault.unlock")}
          </PillButton>

          <RememberToggle ms={rememberMs} label={t("vault.remember")} />

          {error ? (
            <p className="m-0 text-center text-[12.5px] leading-relaxed text-danger">
              {error}
            </p>
          ) : null}

          {!error && !isSetup && attemptsLeft < MAX_ATTEMPTS ? (
            <p className="m-0 text-center text-[12.5px] leading-relaxed text-danger">
              {t("vault.attempts", { left: attemptsLeft, max: MAX_ATTEMPTS })}
            </p>
          ) : null}

          {notice ? (
            <p className="m-0 text-center text-[12.5px] leading-relaxed text-ink-2">
              {notice === "wiped" ? t("vault.notice.wiped") : notice}
            </p>
          ) : null}
        </form>

        <RememberChoices open={rememberMs > 0} selected={rememberMs} />
      </div>

      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
    </div>
  );
}

const REMEMBER_LABEL: Record<RememberOptionId, MessageKey> = {
  "15m": "vault.remember.15m",
  "1h": "vault.remember.1h",
  "8h": "vault.remember.8h",
  "1d": "vault.remember.1d",
  "7d": "vault.remember.7d",
};

const DEFAULT_REMEMBER_MS = REMEMBER_OPTIONS.find((option) => option.id === "1h")?.ms ?? REMEMBER_OPTIONS[0].ms;

/** 时长按钮从中间散开、收回中间。位移写在变量里，动画只负责播放。 */
function rememberMotion(index: number, phase: "open" | "closed"): CSSProperties {
  const center = (REMEMBER_OPTIONS.length - 1) / 2;
  const shift = (index - center) * 22;
  const order = phase === "open" ? index : REMEMBER_OPTIONS.length - 1 - index;
  return {
    ["--remember-x" as string]: `${-shift}px`,
    animationDelay: `${order * 28}ms`,
  };
}

function RememberChoices({ open, selected }: { open: boolean; selected: number }) {
  const { t } = useI18n();
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState<"open" | "closed">(open ? "open" : "closed");

  if (open) {
    if (!present) setPresent(true);
    if (phase !== "open") setPhase("open");
  } else if (present && phase !== "closed") {
    setPhase("closed");
  }

  if (!present) return null;

  return (
    <div
      className={cn(
        "absolute inset-x-0 top-full mt-3 flex flex-wrap justify-center gap-1.5",
        phase === "closed" && "pointer-events-none",
      )}
      onAnimationEnd={(event) => {
        if (phase !== "closed" || event.animationName !== "remember-collapse") return;
        if (event.target !== event.currentTarget.querySelector("button")) return;
        setPresent(false);
      }}
    >
      {REMEMBER_OPTIONS.map((option, index) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setRememberPref(option.ms)}
          className={cn(
            phase === "open" ? "remember-spread" : "remember-collapse",
            "rounded-pill border px-2.5 py-1 text-[12px] transition-colors",
            selected === option.ms
              ? "border-selected-line bg-selected font-medium text-selected-ink"
              : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
          )}
          style={rememberMotion(index, phase)}
        >
          {t(REMEMBER_LABEL[option.id])}
        </button>
      ))}
    </div>
  );
}

function RememberToggle({ ms, label }: { ms: number; label: string }) {
  const on = ms > 0;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setRememberPref(on ? 0 : DEFAULT_REMEMBER_MS)}
      className="flex w-full items-center justify-between rounded-pill border border-line bg-surface px-4 py-2.5 text-[13px] text-ink"
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-[22px] w-10 shrink-0 items-center justify-start rounded-pill p-0.5",
          "transition-colors duration-200 ease-out motion-reduce:transition-none",
          on ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-pill transition-transform duration-200 ease-out motion-reduce:transition-none",
            on ? "bg-accent-ink" : "bg-ink",
          )}
          style={{ transform: on ? "translateX(20px)" : "translateX(0)" }}
        />
      </span>
    </button>
  );
}

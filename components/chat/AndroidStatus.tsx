"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/use-i18n";

export function AndroidStatus({ enabled }: { enabled: boolean }) {
  const { locale, t } = useI18n();
  const [batteryPercent, setBatteryPercent] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const updateTime = () =>
      setCurrentTime(
        new Date().toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
    const initialTime = window.setTimeout(updateTime, 0);
    const timeTimer = window.setInterval(updateTime, 30_000);
    const batteryApi = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        addEventListener: (type: "levelchange", listener: () => void) => void;
        removeEventListener: (type: "levelchange", listener: () => void) => void;
      }>;
    };
    let battery: Awaited<ReturnType<NonNullable<typeof batteryApi.getBattery>>> | null = null;
    let onLevelChange: (() => void) | null = null;
    void batteryApi.getBattery?.().then((next) => {
      battery = next;
      const update = () => setBatteryPercent(Math.round(next.level * 100));
      onLevelChange = update;
      update();
      next.addEventListener("levelchange", update);
    });

    return () => {
      window.clearTimeout(initialTime);
      window.clearInterval(timeTimer);
      if (battery && onLevelChange) battery.removeEventListener("levelchange", onLevelChange);
    };
  }, [enabled, locale]);

  if (!enabled) return null;

  return (
    <div className="flex min-h-6 w-full items-center border-b border-line/60 text-[11px] leading-4 text-ink-2">
      <span>{currentTime}</span>
      <span className="ml-auto">
        {t("topbar.battery")}: {batteryPercent == null ? "--" : `${batteryPercent}%`}
      </span>
    </div>
  );
}

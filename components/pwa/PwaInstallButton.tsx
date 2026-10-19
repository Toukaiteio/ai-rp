"use client";

import { useState } from "react";
import { IconDownload } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { isNativeApp } from "@/lib/storage/native";
import { useI18n } from "@/lib/i18n/use-i18n";

/** 浏览器里给出桌面版和安卓版下载。已经在壳里就不再显示。 */
export function PwaInstallButton() {
  const [open, setOpen] = useState(false);
  const [native] = useState(() => isNativeApp());
  const { t } = useI18n();

  if (native) return null;

  return (
    <span className="relative">
      <IconButton
        aria-label={t("pwa.install")}
        aria-expanded={open}
        title={t("pwa.install")}
        onClick={() => setOpen((value) => !value)}
      >
        <IconDownload />
      </IconButton>
      {open ? (
        <span className="absolute top-12 right-0 z-50 flex w-56 flex-col gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-ink-2 shadow-pop">
          <span>{t("pwa.installHelp")}</span>
          <a
            className="font-bold text-ink hover:underline"
            href="https://github.com/Toukaiteio/ai-rp/releases/latest/download/ai-rp-windows.zip"
            download
          >
            {t("pwa.desktop")}
          </a>
          <a
            className="font-bold text-ink hover:underline"
            href="https://github.com/Toukaiteio/ai-rp/releases/latest/download/ai-rp-android.apk"
            download
          >
            {t("pwa.android")}
          </a>
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { IconDownload } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n/use-i18n";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** 只在浏览器真的准备好安装时出现，避免在界面里常驻一块说明文字。 */
export function PwaInstallButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [standalone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches,
  );
  const { t } = useI18n();

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone) return null;

  return (
    <span className="relative">
      <IconButton
        aria-label={t("pwa.install")}
        title={t("pwa.install")}
        onClick={() => {
          if (!promptEvent) {
            setHelpOpen((open) => !open);
            return;
          }
          const current = promptEvent;
          setPromptEvent(null);
          void current.prompt().then(() => current.userChoice);
        }}
      >
        <IconDownload />
      </IconButton>
      {helpOpen ? (
        <span className="absolute top-12 right-0 z-50 w-56 rounded-md border border-line bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-ink-2 shadow-pop">
          {t("pwa.installHelp")}
        </span>
      ) : null}
    </span>
  );
}

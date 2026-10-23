"use client";

import { useEffect, useState } from "react";
import type { AttachmentWorkspaceMode } from "./AttachmentWorkspace";

function modeForViewport(width: number, height: number): AttachmentWorkspaceMode {
  if (width >= 1100 && height >= 700) return "desktop";
  if (width < 640 || height < 640) return "fullscreen";
  return "overlay";
}

export function useAttachmentWorkspaceMode(open: boolean): AttachmentWorkspaceMode {
  const [mode, setMode] = useState<AttachmentWorkspaceMode>("fullscreen");

  useEffect(() => {
    if (!open) return;
    const update = () => setMode(modeForViewport(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  return mode;
}

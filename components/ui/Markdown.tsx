import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useI18n } from "@/lib/i18n/use-i18n";
import { cn } from "./cn";

export interface MarkdownMacroMarker {
  text: string;
  name: string;
  source: string;
}

/** 二段点击的点亮窗口：超时没点第二下就熄掉，再点重新点亮。 */
const MACRO_ARM_MS = 3000;

/**
 * 对话正文的 Markdown。
 * 不渲染原始 HTML，图片只留说明文字，链接只允许 http(s) 和 mailto。
 * 单个换行也断开，角色卡习惯用换行而不是空行分段。
 */

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

function safeUrl(url: string): string {
  const value = url.trim();
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  return "";
}

export function MarkdownText({
  text,
  tone = "ink",
  className,
  macroMarkers,
  onMacroClick,
}: {
  text: string;
  /** bubble 用在玩家的气泡里，代码底取气泡文字的浅色，深浅两套主题都分得开 */
  tone?: "ink" | "bubble";
  className?: string;
  macroMarkers?: Readonly<Record<string, MarkdownMacroMarker>>;
  /** 二段点击的第二下（点亮状态下再点）才会触发 */
  onMacroClick?: (macro: MarkdownMacroMarker) => void;
}) {
  const { t } = useI18n();
  const [armed, setArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  function tapMacro(id: string, macro: MarkdownMacroMarker): void {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (armed === id) {
      setArmed(null);
      onMacroClick?.(macro);
      return;
    }
    setArmed(id);
    armTimer.current = setTimeout(() => setArmed(null), MACRO_ARM_MS);
  }

  const markdownComponents: Components = {
    ...components,
    a: ({ href, children }) => {
      const id = href?.match(/^macro:(.+)$/i)?.[1];
      const macro = id === undefined ? undefined : macroMarkers?.[id];
      if (macro && id !== undefined) {
        const lit = armed === id;
        return (
          <button
            type="button"
            title={lit && macro.name === "user" ? t("chat.macroArmed") : macro.source}
            aria-label={`${macro.source}: ${macro.text}`}
            className={cn(
              "border-0 border-b border-dashed bg-transparent px-0 font-inherit transition-colors",
              lit ? "border-solid border-armed text-armed" : "border-current text-inherit",
            )}
            onClick={() => tapMacro(id, macro)}
          >
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };

  return (
    <div
      className={cn(
        "[&_p]:m-0 [&_p+p]:mt-2.5",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_strong]:font-bold",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:my-2 [&_blockquote]:border-l [&_blockquote]:border-current [&_blockquote]:pl-3 [&_blockquote]:opacity-80",
        tone === "bubble"
          ? "[&_code]:bg-bubble-ink/15 [&_pre]:bg-bubble-ink/15"
          : "[&_code]:bg-surface-2 [&_pre]:bg-surface-2",
        "[&_code]:rounded-sm [&_code]:px-1 [&_code]:font-sans [&_code]:text-[0.9em]",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:font-sans [&_pre]:text-[13px] [&_pre]:leading-relaxed",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:font-serif [&_h1]:text-[1.15em] [&_h1]:font-black",
        "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-serif [&_h2]:text-[1.08em] [&_h2]:font-black",
        "[&_h3]:mt-2.5 [&_h3]:mb-1 [&_h3]:font-serif [&_h3]:text-[1em] [&_h3]:font-bold",
        "[&_hr]:my-3 [&_hr]:border-line",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={(url) => (/^macro:/i.test(url) ? url : safeUrl(url))}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

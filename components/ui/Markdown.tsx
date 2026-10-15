import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "./cn";

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
}: {
  text: string;
  /** bubble 用在玩家的浅色气泡里，代码底改成浅墨，避免深色块把字吞掉 */
  tone?: "ink" | "bubble";
  className?: string;
}) {
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
          ? "[&_code]:bg-ink/10 [&_pre]:bg-ink/10"
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
        urlTransform={safeUrl}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

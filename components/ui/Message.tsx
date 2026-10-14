import type { ReactNode, Ref, UIEventHandler } from "react";
import { cn } from "./cn";

/* 旁白即正文：字体、字号、行距、颜色与角色对白完全一致，排在同一文字栏里 */
export function Prose({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "font-serif text-[16.5px] leading-[1.95] text-ink",
        "[&_p]:m-0 [&_p]:mb-2.5 [&_p:last-child]:mb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* 旁白：无头像、无名牌、无消息背景，只是缩进到与对白同一栏 */
export function NarratorBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="ml-12 min-w-0 flex-1">
        <Prose>{children}</Prose>
      </div>
    </div>
  );
}

/* 角色对白：头像 + 姓名，正文墨色。
   actions 用来把「重新生成 / 继续」这类操作贴在最后一条回复内部，
   和正文同一个文字栏，不额外占一层间距。 */
export function DialogueBlock({
  who,
  avatar,
  sceneTag,
  actions,
  children,
}: {
  who: ReactNode;
  avatar?: ReactNode;
  sceneTag?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 size-9 shrink-0 overflow-hidden rounded-pill bg-surface-2">
        {avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-[5px] flex items-center gap-2 text-[12.5px] text-ink-2">
          {who}
          {sceneTag ? (
            <span className="rounded-pill border border-line px-[9px] py-px text-[11px] text-ink-2">
              {sceneTag}
            </span>
          ) : null}
        </div>
        <Prose>{children}</Prose>
        {actions}
      </div>
    </div>
  );
}

/* 玩家：右侧最亮的气泡，只有玩家能产生，模型不得代写 */
export function PlayerBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-card bg-bubble px-[18px] py-[11px] text-[15.5px] leading-[1.65] text-bubble-ink">
        {children}
      </div>
    </div>
  );
}

/* 场景事件：居中胶囊，无说话人，用于场景切换、时间流逝与状态变化 */
export function SceneEvent({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-pill border border-line bg-surface-2 px-4 py-[5px] text-center text-[12.5px] text-ink-2">
        {children}
      </span>
    </div>
  );
}

/* 只出现在最后一条回复下方：重新生成、继续、生成 CG */
export function MessageActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-3 flex flex-wrap gap-2", className)}>
      {children}
    </div>
  );
}

/* 流式输出时的打字机光标 */
export function TypingCursor() {
  return <span className="cursor-blink" aria-hidden="true" />;
}

/* 对话滚动区：唯一可滚动的地方，上下留白由内层列控制。
   ref 透传出去给自动滚动用，onScroll 用来判断玩家有没有往回翻。 */
export function ChatScroll({
  children,
  className,
  ref,
  onScroll,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={cn(
        "min-h-0 flex-1 overflow-y-auto px-5 pt-[26px] pb-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* 文字栏：旁白与对白共用同一列宽，缩进关系才成立 */
export function ChatColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-[660px] flex-col gap-[26px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* 开场建议输入：只在没有对话时出现 */
export function SuggestRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[660px] flex-wrap gap-2 px-5 pt-0.5 pb-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

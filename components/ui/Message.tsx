import type { ReactNode, Ref, UIEventHandler } from "react";
import { cn } from "./cn";

/* 对白正文：整屏最常读的一段，墨色最亮、行距最松 */
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

/* 旁白正文：比对白暗一档、小半号、行距收紧。
   谁在说话、谁只交代场景，靠这三样就能分开，不用改字体。 */
export function NarratorProse({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "font-serif text-[15px] leading-[1.8] text-ink-2",
        "[&_p]:m-0 [&_p]:mb-2.5 [&_p:last-child]:mb-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* 旁白：无头像、无名牌、无消息背景，缩进到与对白同一栏。
   左缘一条细线画在留白里（负外边距把那 14px 让出来），
   所以旁白正文的起始位置和对白正文严格对齐，只有明暗和字号的差别。 */
export function NarratorBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="ml-12 min-w-0 flex-1">
        <div className="-ml-[14px] border-l border-line pl-[13px]">
          <NarratorProse>{children}</NarratorProse>
        </div>
      </div>
    </div>
  );
}

/* 当前角色的动作与心理活动：不显示头像和名字，但与对白保持同一文字栏。
   和旁白共用左缘细线这个形状，靠颜色分开：旁白是中性灰，动作是淡黄。
   全站只在这里破一次「不用色相」的规矩，因为这两块最容易看混。 */
export function ActionBlock({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="ml-12 min-w-0 flex-1">
        <div className="-ml-[14px] border-l border-act-line pl-[13px]">
          <div className="font-serif text-[15px] leading-[1.8] italic text-act [&_p]:m-0 [&_p]:mb-2.5 [&_p:last-child]:mb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* 角色对白：头像 + 姓名，正文墨色。
   同一个人连着说几段时，后面的块传 continued：只留出同宽的左侧空槽，
   头像和名字不再重复，正文仍然和第一条严格对齐。
   actions 用来把「重新生成 / 继续」这类操作贴在最后一条回复内部，
   和正文同一个文字栏，不额外占一层间距。 */
export function DialogueBlock({
  who,
  avatar,
  sceneTag,
  actions,
  continued = false,
  children,
}: {
  who: ReactNode;
  avatar?: ReactNode;
  sceneTag?: ReactNode;
  actions?: ReactNode;
  /** 同一说话人的后续段落：不重复头像和名字 */
  continued?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      {avatar ? (
        continued ? (
          <div className="mt-0.5 size-9 shrink-0" aria-hidden="true" />
        ) : (
          <div className="mt-0.5 size-9 shrink-0 overflow-hidden rounded-pill bg-surface-2">
            {avatar}
          </div>
        )
      ) : null}
      <div className="min-w-0 flex-1">
        {continued ? null : (
          <div className="mb-[5px] flex items-center gap-2 text-[12.5px] text-ink-2">
            {who}
            {sceneTag ? (
              <span className="rounded-pill border border-line px-[9px] py-px text-[11px] text-ink-2">
                {sceneTag}
              </span>
            ) : null}
          </div>
        )}
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

/* 手动分章：横线夹着章名，比场景胶囊更大、更亮，扫一眼就能分开。 */
export function ChapterMark({
  id,
  index,
  title,
}: {
  id: string;
  index: string;
  title: string;
}) {
  return (
    <div id={id} className="flex scroll-mt-6 items-center gap-3 py-3">
      <span className="h-px flex-1 bg-line-strong" />
      <span className="max-w-[70%] shrink-0 text-center">
        <span className="block text-[11px] tracking-[0.14em] text-ink-2">{index}</span>
        <span className="mt-0.5 block font-serif text-[17px] leading-tight font-black text-ink">
          {title}
        </span>
      </span>
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  );
}

/* 场景事件：居中胶囊，无说话人，用于场景切换、时间流逝与状态变化 */
export function SceneEvent({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center">
      <div className="w-fit max-w-[80%] rounded-pill border border-line bg-surface-2 px-4 py-[5px] text-center text-[12.5px] text-ink-2 [&_p]:m-0">
        {children}
      </div>
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
    <div className={cn("mt-1 flex flex-wrap gap-2", className)}>
      {children}
    </div>
  );
}

/* 流式输出时的打字机光标 */
export function TypingCursor() {
  return <span className="cursor-blink" aria-hidden="true" />;
}

/* 只显示一个需要等待的异步阶段，不扩展成卡片或阶段列表。 */
export function TaskBrief({
  title,
}: {
  title: string;
}) {
  return (
    <div className="stage-status truncate text-[12px] leading-5 text-ink-2">
      {title}
    </div>
  );
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

/* 建议输入前的分隔：一条细线加一个极小的说明。
   操作胶囊和建议胶囊长得太像，挨在一起时看不出哪个是对这条回复的操作、
   哪个是玩家接下来能说的话，所以用一条线加一行字把它们分开。 */
export function SuggestDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="shrink-0 text-[11px] tracking-[0.08em] text-ink-3">{label}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
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

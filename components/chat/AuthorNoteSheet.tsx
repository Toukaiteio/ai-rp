"use client";

/**
 * 作者注编辑面板。
 *
 * 只编辑一样东西：**这一轮怎么写**。世界设定、人物设定、剧情事实都不属于它，
 * 面板里明说了这一点——不然玩家会把设定写进这里，然后和角色卡打架。
 *
 * 从顶栏那个大脑图标进来（那里本来就是「模型现在被喂了什么」的位置）。
 * 当前聊天专属，存在会话里；清空就回退到角色卡的默认注记。
 */
import { useState } from "react";
import { ActPill, OptChip, PillButton, Sheet } from "@/components/ui";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { AuthorNote } from "@/lib/prompt/types";
import { DEFAULT_NOTE_DEPTH, MAX_NOTE_CHARS } from "@/lib/prompt";
import { formatSceneState, isEmptySceneState, type SceneState } from "@/lib/scene";
import type { StoryThread } from "@/lib/story";

/** 面板里的例子。照抄这几句就能得到一个能用的作者注。 */
const EXAMPLES = [
  "本轮保持克制。",
  "只写角色对玩家刚才那句话的直接反应。",
  "act 只保留一个可见动作。",
  "不要替玩家行动。",
  "不要推进新的剧情线。",
];

const FREQUENCIES: Array<{ value: number; key: NoteKey }> = [
  { value: 1, key: "note.freq.every" },
  { value: 2, key: "note.freq.every2" },
  { value: 4, key: "note.freq.every4" },
  { value: 0, key: "note.freq.off" },
];

const DEPTHS: Array<{ value: number; key: NoteKey }> = [
  { value: 1, key: "note.depth.last" },
  { value: 2, key: "note.depth.2" },
  { value: 3, key: "note.depth.3" },
];

type NoteKey =
  | "note.freq.every"
  | "note.freq.every2"
  | "note.freq.every4"
  | "note.freq.off"
  | "note.depth.last"
  | "note.depth.2"
  | "note.depth.3";

export function AuthorNoteSheet({
  open,
  note,
  cardDefault,
  scene,
  threads,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  /** 当前聊天专属的注记 */
  note: AuthorNote | null;
  /** 角色卡上的默认注记，只作提示 */
  cardDefault?: string;
  /** 当前场景状态，只读展示 */
  scene?: SceneState;
  /** 未完成的剧情线，只读展示。已解决的不列 */
  threads?: StoryThread[];
  onClose: () => void;
  onSave: (note: AuthorNote | null) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const sceneText = scene && !isEmptySceneState(scene) ? formatSceneState(scene) : "";
  const openThreads = (threads ?? [])
    .filter((thread) => thread.status !== "resolved")
    .sort((a, b) => b.importance - a.importance || b.lastActiveAt - a.lastActiveAt)
    .slice(0, 6);

  return (
    <Sheet open={open} title={t("note.title")} description={t("note.hint")}>
      {sceneText ? (
        <div className="mb-4 rounded-card border border-line bg-surface-2 px-4 py-3">
          <p className="m-0 mb-1 text-[12px] tracking-[0.08em] text-ink-3">{t("scene.title")}</p>
          <p className="m-0 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{sceneText}</p>
        </div>
      ) : null}

      {openThreads.length > 0 ? (
        <div className="mb-4 rounded-card border border-line bg-surface-2 px-4 py-3">
          <p className="m-0 mb-1 text-[12px] tracking-[0.08em] text-ink-3">{t("thread.title")}</p>
          <ul className="m-0 list-none space-y-0.5 p-0 text-[13px] leading-relaxed text-ink-2">
            {openThreads.map((thread) => (
              <li key={thread.id}>
                · {thread.title}
                <span className="ml-1 text-[11.5px] text-ink-3">
                  {t("thread.importance", { n: thread.importance })}
                  {thread.status === "dormant" ? ` · ${t("thread.dormant")}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-1.5 text-[11.5px] text-ink-3">{t("thread.hint")}</p>
        </div>
      ) : null}

      {/*
        表单用 key 跟着 open 重挂：关掉再打开时状态从当前注记重新初始化，
        不用 effect 同步，也就不会先画出上一次没保存的草稿。
      */}
      <NoteForm
        key={open ? "open" : "closed"}
        note={note}
        cardDefault={cardDefault}
        onClose={onClose}
        onSave={onSave}
        onClear={onClear}
      />
    </Sheet>
  );
}

function NoteForm({
  note,
  cardDefault,
  onClose,
  onSave,
  onClear,
}: {
  note: AuthorNote | null;
  cardDefault?: string;
  onClose: () => void;
  onSave: (note: AuthorNote | null) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(note?.text ?? "");
  const [frequency, setFrequency] = useState(note?.frequency ?? 1);
  const [depth, setDepth] = useState(note?.depth ?? DEFAULT_NOTE_DEPTH);
  const trimmed = text.trim();

  return (
    <>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, MAX_NOTE_CHARS))}
        rows={5}
        placeholder={t("note.placeholder")}
        className="w-full resize-y rounded-card border border-line bg-surface-2 px-4 py-3 text-[14.5px] leading-relaxed text-ink outline-none focus:border-line-strong"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-ink-3">{t("note.examples")}</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() =>
              setText((current) => {
                const next = current.trim() ? `${current.trim()}\n${example}` : example;
                return next.slice(0, MAX_NOTE_CHARS);
              })
            }
            className="rounded-pill border border-line bg-surface px-2.5 py-0.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            {example}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="m-0 mb-1.5 text-[12.5px] text-ink-2">{t("note.frequency")}</p>
        <div className="flex flex-wrap gap-1.5">
          {FREQUENCIES.map((item) => (
            <OptChip
              key={item.value}
              selected={frequency === item.value}
              onClick={() => setFrequency(item.value)}
            >
              {t(item.key)}
            </OptChip>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="m-0 mb-1.5 text-[12.5px] text-ink-2">{t("note.depth")}</p>
        <div className="flex flex-wrap gap-1.5">
          {DEPTHS.map((item) => (
            <OptChip key={item.value} selected={depth === item.value} onClick={() => setDepth(item.value)}>
              {t(item.key)}
            </OptChip>
          ))}
        </div>
      </div>

      {cardDefault?.trim() ? (
        <p className="mt-3 mb-0 text-[12px] leading-relaxed text-ink-3">
          {t("note.cardDefault")}
          {cardDefault.trim().slice(0, 120)}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <PillButton
          variant="primary"
          block
          disabled={!trimmed}
          onClick={() => onSave({ text: trimmed, frequency, depth })}
        >
          {t("note.save")}
        </PillButton>
        <ActPill onClick={onClose}>{t("common.close")}</ActPill>
        <ActPill onClick={onClear}>{t("note.clear")}</ActPill>
      </div>
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import {
  BackPill,
  CharacterCard,
  IconButton,
  ImportCard,
  PillButton,
  ScreenHead,
  Tag,
} from "@/components/ui";
import { IconDownload, IconTrash } from "@/components/icons";
import {
  downloadCard,
  isPlayableCard,
  readCardFile,
  type CardEntry,
} from "@/lib/cards";
import { addImportedCard, removeImportedCard } from "@/lib/storage/cards";
import { Avatar } from "./Avatar";

/** 描述在卡片上只露一句，避免长设定把卡片撑爆。 */
function firstSentence(text: string, limit = 46): string {
  const flat = text.replace(/\s+/g, " ").replace(/【[^】]*】/g, "").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit)}…`;
}

export function ShelfScreen({
  cards,
  currentCardId,
  onSelect,
  onBack,
}: {
  cards: CardEntry[];
  currentCardId: string;
  onSelect: (cardId: string) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const result = await readCardFile(file);
    if (!result.ok) {
      setError(`导入失败：${result.error}`);
      return;
    }
    await addImportedCard(result.card);
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-[760px] px-6 py-8">
        <ScreenHead
          title="角色架"
          subtitle={`${cards.length} 张卡`}
          action={<BackPill onClick={onBack}>回到对话</BackPill>}
        />

        {error ? (
          <div className="mb-4 rounded-md bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((entry) => {
            const playable = isPlayableCard(entry.card.data);
            return (
              <CharacterCard
                key={entry.id}
                portrait={<Avatar name={entry.card.data.name} />}
                name={entry.card.data.name}
                description={firstSentence(entry.card.data.description)}
                tags={
                  <>
                    {entry.source === "imported" ? <Tag>导入</Tag> : null}
                    {entry.card.data.tags?.slice(0, 3).map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </>
                }
                current={entry.id === currentCardId}
                onStart={playable ? () => onSelect(entry.id) : undefined}
                actions={
                  <>
                    <IconButton
                      aria-label={`导出 ${entry.card.data.name}`}
                      className="size-8"
                      onClick={() => downloadCard(entry.card)}
                    >
                      <IconDownload className="size-4" />
                    </IconButton>
                    {entry.source === "imported" ? (
                      <IconButton
                        aria-label={`删除 ${entry.card.data.name}`}
                        className="size-8 text-danger hover:text-danger-hover"
                        onClick={() => void removeImportedCard(entry.id)}
                      >
                        <IconTrash className="size-4" />
                      </IconButton>
                    ) : null}
                  </>
                }
              />
            );
          })}

          <ImportCard onClick={() => fileRef.current?.click()} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            // 清空，同一个文件连选两次也要能触发
            event.target.value = "";
          }}
        />

        <div className="mt-6 flex justify-center">
          <PillButton variant="ghost" onClick={() => fileRef.current?.click()}>
            导入角色卡 JSON
          </PillButton>
        </div>
      </div>
    </div>
  );
}

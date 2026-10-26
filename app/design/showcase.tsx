"use client";

import { useState } from "react";
import {
  ActPill,
  ActionBlock,
  BackPill,
  Badge,
  Bar,
  BookRow,
  Capsule,
  CapsuleButton,
  ChapterRow,
  CharacterCard,
  ChatColumn,
  ChatScroll,
  CgCard,
  CgLoading,
  Composer,
  DialogueBlock,
  Field,
  FieldAction,
  FieldInput,
  FormGroup,
  Frame,
  Grab,
  HistoryRow,
  IconButton,
  ImportCard,
  MenuRow,
  MessageActions,
  NarratorBlock,
  OptChip,
  OptRow,
  PillButton,
  PlayerBubble,
  Prose,
  SceneEvent,
  ScreenHead,
  Segmented,
  Sheet,
  SliderRow,
  SuggestChip,
  SuggestDivider,
  SuggestRow,
  Tag,
  Toast,
  TopBar,
  TypingCursor,
  VaultStatus,
  VaultWarn,
  Veil,
} from "@/components/ui";
import {
  IconBack,
  IconBook,
  IconCheck,
  IconEye,
  IconHistory,
  IconImage,
  IconSearch,
  IconTrash,
  IconX,
} from "@/components/icons";
import { translate } from "@/lib/i18n";

/** 展示页固定用中文文案，和运行时界面共用同一张表。 */
const z = translate.bind(null, "zh");

/* ------------------------------------------------------------------
   页面内的排版小工具
   ------------------------------------------------------------------ */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-14">
      <div className="mb-4">
        <h2 className="m-0 mb-1 font-serif text-[22px] font-black text-ink">
          {title}
        </h2>
        {note ? <p className="m-0 text-[13.5px] text-ink-2">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Demo({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-line bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

/* 色卡直接引用令牌，不写字面色值。
   半透明令牌（遮罩、压字底）要垫一层明暗相间的格子才看得出透明度，
   格子取 ink-3 与 background，两套主题下都有对比。 */
function Swatch({
  name,
  token,
  overLight = false,
}: {
  name: string;
  token: string;
  overLight?: boolean;
}) {
  const value = `var(${token})`;
  return (
    <div className="flex w-[96px] flex-col items-center gap-1.5 text-center text-[12.5px] text-ink-2">
      <span
        className="size-[52px] rounded-pill border border-line"
        style={{
          background: overLight
            ? `linear-gradient(${value}, ${value}), repeating-conic-gradient(var(--ink-3) 0% 25%, var(--background) 0% 50%) 0 0 / 12px 12px`
            : value,
        }}
      />
      <b className="text-[13px] font-medium text-ink">{name}</b>
      <code className="text-[11px]">{token}</code>
    </div>
  );
}

/* 演示用头像：用令牌化的色块代替真实图片，不引入外部资源 */
function Avatar({ initial }: { initial: string }) {
  return (
    <span className="grid h-full w-full place-items-center bg-surface-3 font-serif text-sm font-black text-ink-2">
      {initial}
    </span>
  );
}

export function Showcase() {
  const [screen, setScreen] = useState<"chat" | "shelf" | "settings">("chat");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [provider, setProvider] = useState("Yosei-Router");
  const [length, setLength] = useState("适中");
  const [temp, setTemp] = useState(9);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"more" | "history" | null>(null);

  const phone = device === "phone";

  function flashToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 1800);
  }

  return (
    <main className="mx-auto max-w-[1100px] px-6 pt-14 pb-24">
      <header className="mb-14">
        <h1 className="m-0 mb-2 font-serif text-[34px] leading-tight font-black text-ink">
          UI 组件总览
        </h1>
        <p className="m-0 max-w-[62ch] text-[15px] text-ink-2">
          从早期交互原型中提取。所有颜色、圆角、阴影、字体都来自
          <code className="mx-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink">
            app/globals.css
          </code>
          的令牌层，组件内不出现字面色值。默认是中性深灰
          <code className="mx-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink">
            #161616
          </code>
          ，可在连接设置里切到浅色：两套取值都只写在令牌层，画面结构不变，也都不引入蓝、金、紫色相；
          高饱和色只保留给删除、重置这类破坏性操作。唯一一处例外是动作块的黄
          <code className="mx-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink">
            --act
          </code>
          ：它和旁白只差明暗与斜体，看久了容易混，所以用色相把两者拉开。
        </p>
      </header>

      <Section
        title="设计令牌"
        note="中性灰阶承担全部底色与文字。强调色是中性高对比色而不是彩色，同一时刻只出现一处。切换 data-theme 时色卡会跟着变。"
      >
        <Demo>
          <div className="mb-6 flex flex-wrap gap-4">
            <Swatch name="底色" token="--background" />
            <Swatch name="浮层" token="--surface" />
            <Swatch name="内嵌" token="--surface-2" />
            <Swatch name="填充" token="--surface-3" />
            <Swatch name="描边" token="--line" />
            <Swatch name="描边强" token="--line-strong" />
          </div>
          <div className="mb-6 flex flex-wrap gap-4">
            <Swatch name="主文字" token="--ink" />
            <Swatch name="次级" token="--ink-2" />
            <Swatch name="弱化" token="--ink-3" />
            <Swatch name="强调" token="--accent" />
            <Swatch name="选中" token="--selected" />
            <Swatch name="气泡" token="--bubble" />
            <Swatch name="动作" token="--act" />
          </div>
          <div className="flex flex-wrap gap-4">
            <Swatch name="危险" token="--danger" />
            <Swatch name="危险浅" token="--danger-soft" />
            <Swatch name="正向" token="--ok" />
            <Swatch name="正向浅" token="--ok-soft" />
            <Swatch name="遮罩" token="--veil" overLight />
            <Swatch name="压字底" token="--overlay" overLight />
          </div>
          <p className="mt-6 mb-0 text-[13px] leading-relaxed text-ink-2">
            圆角只有四档：胶囊 999、外框 28、卡片 24、容器 20、小件 14 / 10。
            换肤只需要改
            <code className="mx-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink">
              :root
            </code>
            与
            <code className="mx-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[12px] text-ink">
              :root[data-theme=&quot;light&quot;]
            </code>
            这两层。
          </p>
        </Demo>
      </Section>

      <Section
        title="按钮层级"
        note="同一屏主按钮最多一个，层级靠填充区分。破坏性操作用高饱和红，是唯一允许抢眼的地方。"
      >
        <Demo>
          <div className="flex flex-wrap items-center gap-3">
            <PillButton variant="primary">保存连接</PillButton>
            <PillButton variant="ghost">次按钮</PillButton>
            <PillButton variant="danger">删除会话</PillButton>
            <PillButton variant="ghost" size="sm">
              小号次按钮
            </PillButton>
            <PillButton variant="ghost" disabled>
              禁用
            </PillButton>
            <IconButton aria-label="搜索">
              <IconSearch />
            </IconButton>
            <IconButton aria-label="删除">
              <IconTrash />
            </IconButton>
            <BackPill>{z("shelf.back")}</BackPill>
          </div>
          <div className="mt-5 max-w-[320px]">
            <PillButton variant="primary" block>
              块级主按钮
            </PillButton>
            <div className="h-2.5" />
            <PillButton variant="danger" block>
              重置整个会话
            </PillButton>
          </div>
        </Demo>
      </Section>

      <Section
        title="胶囊与选项"
        note="状态胶囊不带圆点，状态靠文字说清。选项平铺成胶囊，不做大下拉列表。"
      >
        <Demo>
          <div className="flex flex-wrap items-center gap-3">
            <Capsule>晚星旅店 · 雨夜</Capsule>
            <Capsule tone="strong">场景切换</Capsule>
            <CapsuleButton>
              <span>记忆</span>
              <span>62%</span>
            </CapsuleButton>
            <Tag>旅店一楼</Tag>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <OptChip selected>Chat Completions</OptChip>
            <OptChip>OpenAI</OptChip>
            <OptChip>DeepSeek</OptChip>
            <OptChip disabled>Anthropic Messages · 后续</OptChip>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ActPill hot>重新生成</ActPill>
            <ActPill>继续</ActPill>
            <ActPill>生成当前场景 CG</ActPill>
            <ActPill disabled>禁用态</ActPill>
            <SuggestChip>来杯热姜茶</SuggestChip>
            <SuggestChip>今晚能留宿吗</SuggestChip>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Badge>缓存命中 92%</Badge>
            <Badge tone="ok">
              <IconCheck className="size-3" />
              已保存
            </Badge>
            <Badge tone="danger">
              <IconX className="size-3" />
              已断开
            </Badge>
          </div>
        </Demo>
      </Section>

      <Section title="分段控件" note="轨道用次级填充，选中块浮起来。">
        <Demo>
          <Segmented
            label="原型画面"
            value={screen}
            onChange={setScreen}
            items={[
              { value: "chat", label: "对话" },
              { value: "shelf", label: "角色架" },
              { value: "settings", label: "连接设置" },
            ]}
          />
          <p className="mt-4 mb-0 text-[13.5px] text-ink-2">
            当前选中：{screen}
          </p>
        </Demo>
      </Section>

      <Section
        title="表单"
        note="只留真正影响手感的两个量，其余参数走角色卡默认值。"
      >
        <Demo>
          <div className="max-w-[560px]">
            <FormGroup
              title="提供商"
              note="预设在前，自定义在最后。不做大下拉列表。"
            >
              <OptRow>
                {["Yosei-Router", "OpenAI", "DeepSeek", "自定义"].map((item) => (
                  <OptChip
                    key={item}
                    selected={provider === item}
                    onClick={() => setProvider(item)}
                  >
                    {item}
                  </OptChip>
                ))}
              </OptRow>
            </FormGroup>

            <div className="h-6" />

            <FormGroup
              title="API Key"
              note="加密后存入本机，不经任何服务器。"
            >
              <Field>
                <FieldInput type="password" placeholder="sk-…" autoComplete="off" />
                <FieldAction aria-label="显示或隐藏 Key">
                  <IconEye className="size-[17px]" />
                </FieldAction>
              </Field>
            </FormGroup>

            <div className="h-6" />

            <FormGroup title="生成" note="只留随机度与回复长度。">
              <SliderRow
                label="随机度"
                value={temp}
                min={0}
                max={20}
                onChange={setTemp}
                display={(temp / 10).toFixed(1)}
              />
              <OptRow className="mt-3">
                {["回复偏短", "适中", "偏长"].map((item) => (
                  <OptChip
                    key={item}
                    selected={length === item}
                    onClick={() => setLength(item)}
                  >
                    {item}
                  </OptChip>
                ))}
              </OptRow>
            </FormGroup>

            <div className="h-6" />

            <FormGroup title="安全">
              <VaultStatus>
                <b>尚未设定密钥</b>
                <br />
                设定后，本机数据一律先加密再落盘；
                <VaultWarn>连续输错密钥 5 次，将清除本机全部存储。</VaultWarn>
              </VaultStatus>
            </FormGroup>
          </div>
        </Demo>
      </Section>

      <Section
        title="消息块"
        note="旁白即正文：不加头像、不加名牌、不用消息背景，与角色对白共用同一文字栏。动作块同形不同色，淡黄把角色的动作和旁白区分开。"
      >
        <Demo className="p-0">
          <ChatScroll className="max-h-none">
            <ChatColumn>
              <SceneEvent>场景切换 · 旅店一楼</SceneEvent>
              <NarratorBlock>
                <p>
                  深秋的雨夜，晚星旅店一楼。壁炉的火快灭了，窗外的石板路泛着冷光，今晚有宵禁，城门已经关了。
                </p>
              </NarratorBlock>
              <DialogueBlock
                who="林晚晴"
                sceneTag="旅店一楼"
                avatar={<Avatar initial="林" />}
              >
                <p>
                  哟，稀客。三年了，饭钱还没还，就敢来蹭雨？先擦擦，感冒了可没人给你熬药。
                </p>
              </DialogueBlock>
              <ActionBlock>
                <p>她嘴上不饶人，手却已经把干毛巾甩到你怀里，眼神往门外扫了一眼。</p>
              </ActionBlock>
              <PlayerBubble>老板娘，来杯热姜茶。</PlayerBubble>
              <NarratorBlock>
                <p>
                  她抬头看了你一眼，从柜子下摸出一个陶杯，倒上热姜茶，推到你面前。
                </p>
              </NarratorBlock>
              <DialogueBlock who="林晚晴" avatar={<Avatar initial="林" />}>
                <p>
                  热酒没有，只有这个。喝了暖身子，钱记在账上。
                  <TypingCursor />
                </p>
                <MessageActions>
                  <ActPill hot>重新生成</ActPill>
                  <ActPill>继续</ActPill>
                  <ActPill>生成当前场景 CG</ActPill>
                </MessageActions>
              </DialogueBlock>
              <div className="ml-12 flex flex-col gap-2.5">
                <SuggestDivider label={z("chat.suggestLabel")} />
                <SuggestRow className="!w-auto !px-0 !py-0">
                  <SuggestChip>不介意，你慢慢来</SuggestChip>
                  <SuggestChip>帮你把笔帽捡回来了</SuggestChip>
                  <SuggestChip>你好像很紧张，没事的</SuggestChip>
                </SuggestRow>
              </div>
              <CgCard
                caption="场景 CG · 由 gpt-image-2.5 生成"
                icon={<IconImage className="size-[13px]" />}
              >
                <div className="grid aspect-[16/10] w-full place-items-center bg-surface-3 text-sm text-ink-3">
                  场景 CG 占位
                </div>
              </CgCard>
              <CgLoading label={z("loader.image")} />
            </ChatColumn>
          </ChatScroll>
        </Demo>
      </Section>

      <Section
        title="输入胶囊"
        note="只有一层。发送键常驻右端，无输入时是灰圆，有输入立刻变成强调色。"
      >
        <Demo className="relative pb-28">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => {
              setDraft("");
              flashToast("已发送");
            }}
            placeholder="对林晚晴说……"
            hint="Enter 发送，Shift + Enter 换行"
          />
          <div className="mt-6">
            <SuggestRow>
              <SuggestChip onClick={() => setDraft("老板娘，来杯热姜茶。")}>
                来杯热姜茶
              </SuggestChip>
              <SuggestChip onClick={() => setDraft("外面雨太大了，我今晚能留宿吗？")}>
                今晚能留宿吗
              </SuggestChip>
            </SuggestRow>
          </div>
          <Toast open={toast !== null}>{toast}</Toast>
        </Demo>
      </Section>

      <Section
        title="角色卡"
        note="点「开始」直接进对话，当前角色呈灰态，不给假入口。"
      >
        <Demo>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CharacterCard
              portrait={<Avatar initial="林" />}
              name="林晚晴"
              description="晚星旅店老板娘。嘴上不饶人，账本记得比谁都清，北方来的旧事从不主动提。"
              tags={
                <>
                  <Tag>日常</Tag>
                  <Tag>慢热</Tag>
                </>
              }
              turns="已聊 12 轮"
              current
              currentLabel={z("common.current")}
              startLabel={z("common.start")}
            />
            <CharacterCard
              portrait={<Avatar initial="艾" />}
              name="艾莉娅"
              description="公会新人，火系法杖比人还高。争强好胜，夸一句能飘三天。"
              tags={<Tag>冒险</Tag>}
              turns="已聊 3 轮"
              startLabel={z("common.start")}
            />
            <ImportCard label={z("card.import")} />
          </div>
        </Demo>
      </Section>

      <Section
        title="列表行"
        note="回退、分章、封面都用同一套行式布局，靠右侧注解区分用途。"
      >
        <Demo>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                导出为 EPUB
              </h3>
              <BookRow
                cover={<Avatar initial="书" />}
                title="雨夜晚星旅店"
                meta="主角 林晚晴 · 封面取自场景 CG"
              />
              <ChapterRow index="第一章" title="雨夜来客" note="场景 · 旅店一楼" />
              <ChapterRow index="第二章" title="一杯姜茶" note="自动续分中" />
            </div>
            <div>
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                回到之前的消息
              </h3>
              <HistoryRow label="第 4 轮" text="老板娘，来一杯热姜茶。" action="回到这里" />
              <HistoryRow label="第 3 轮" text="你左眉那道疤，是怎么来的？" action="回到这里" />
              <HistoryRow label="第 2 轮" text="外面雨太大了，我今晚能留宿吗？" action="回到这里" />
            </div>
          </div>
        </Demo>
      </Section>

      <Section
        title="顶栏 / 外框 / 抽屉 / 面板"
        note="抽屉与面板绝对定位在外框里。低频功能全收进抽屉，重置用红。"
      >
        <div className="flex flex-wrap items-start gap-6">
          <Frame phone={phone}>
            <TopBar
              avatar={<Avatar initial="林" />}
              name="林晚晴"
              subtitle="晚星旅店老板娘"
              whoLabel="切换角色"
              historyLabel="回退消息与重置会话"
              exportLabel="导出为 EPUB"
              settingsLabel="连接设置"
              compact={phone}
              onHistory={() => setSheet("history")}
              onExport={() => setSheet("more")}
              onSettings={() => setSheet("more")}
            />
            <div className="grid flex-1 place-items-center gap-3 p-6">
              <p className="m-0 text-center text-[13.5px] text-ink-2">
                点顶栏图标，或下面两个按钮
              </p>
              <div className="flex flex-wrap justify-center gap-2.5">
                <PillButton size="sm" onClick={() => setSheet("more")}>
                  更多功能抽屉
                </PillButton>
                <PillButton
                  size="sm"
                  variant="danger"
                  onClick={() => setSheet("history")}
                >
                  回退与重置
                </PillButton>
              </div>
            </div>

            <Veil
               open={sheet !== null}
               onClose={() => {
                 setSheet(null);
               }}
            />

            <Sheet
              open={sheet === "more"}
              title="这一刻，还能做什么"
              description="低频功能全部收在这里，不占首屏。"
            >
              <MenuRow
                icon={<IconImage className="size-[18px]" />}
                note="按场景生成"
                onClick={() => setSheet("more")}
              >
                生成当前场景 CG
              </MenuRow>
              <MenuRow
                icon={<IconHistory className="size-[18px]" />}
                note="按轮次回退"
                onClick={() => setSheet("history")}
              >
                回到之前的消息
              </MenuRow>
              <MenuRow
                icon={<IconBook className="size-[18px]" />}
                note="按场景分章"
              >
                导出为 EPUB
              </MenuRow>
              <MenuRow
                tone="danger"
                icon={<IconTrash className="size-[18px]" />}
                note="清空对话，回到开场白"
                onClick={() => {
                  setSheet(null);
                  flashToast("已回到开场白");
                }}
              >
                重置整个会话
              </MenuRow>
            </Sheet>

            <Sheet
              open={sheet === "history"}
              title="回到之前的消息"
              description="点任意一轮即可回退，之后的对话会被截断。"
            >
              <HistoryRow label="第 4 轮" text="老板娘，来一杯热姜茶。" action="回到这里" />
              <HistoryRow label="第 3 轮" text="你左眉那道疤，是怎么来的？" action="回到这里" />
              <HistoryRow label="第 2 轮" text="外面雨太大了，我今晚能留宿吗？" action="回到这里" />
              <div className="mt-5">
                <PillButton variant="danger" block>
                  重置整个会话
                </PillButton>
              </div>
            </Sheet>

             <Toast open={toast !== null}>{toast}</Toast>
          </Frame>

          <Demo className="min-w-[260px] flex-1">
            <Segmented
              label="设备宽度"
              value={device}
              onChange={setDevice}
              items={[
                { value: "desktop", label: "桌面" },
                { value: "phone", label: "手机" },
              ]}
            />
            <div className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                页面内页头
              </h3>
              <div className="rounded-lg border border-line p-4">
                <ScreenHead
                  title="角色架"
                  subtitle="标题左侧是返回箭头，右侧是铃铛，和对话页顶栏一样贴两端"
                  before={
                    <IconButton aria-label={z("shelf.back")}>
                      <IconBack />
                    </IconButton>
                  }
                  action={<BackPill>{z("shelf.back")}</BackPill>}
                />
              </div>
            </div>
            <div className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                上下文占用条
              </h3>
              <Bar value={62} />
              <div className="h-2.5" />
              <Bar value={92} tone="ok" />
              <div className="h-2.5" />
              <Bar value={100} tone="danger" />
            </div>
            <div className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                抽屉把手
              </h3>
              <div className="rounded-lg border border-line bg-surface-2 pt-3 pb-1">
                <Grab />
              </div>
            </div>
            <div className="mt-5">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">
                正文排版
              </h3>
              <Prose>
                <p>
                  她抬头看了你一眼，从柜子下摸出一个陶杯，倒上热姜茶，推到你面前。
                </p>
              </Prose>
            </div>
          </Demo>
        </div>
      </Section>

      <footer className="border-t border-line pt-5 text-[13.5px] text-ink-2">
        令牌层：app/globals.css · 组件：components/ui/ · 图标：components/icons.tsx
      </footer>
    </main>
  );
}

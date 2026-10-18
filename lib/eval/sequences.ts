/**
 * 连贯性序列（Phase 12.3）。
 *
 * 单轮评测集算不出连贯性指标：场景位置、时间线、角色状态、未解决剧情线
 * 全都是**跨轮次**的东西，一轮之内没有可比的对象。
 *
 * 所以这里补几条连续 4 到 6 轮的序列，每轮都走真实的导演阶段
 * （产出 statePatch / threadPatch），把场景状态和剧情线一路攒下来，
 * 再让 `coherenceMetrics` 去比。
 *
 * 每条序列都设计成「中间有一次该保持住的事」：
 * 玩家反复追问同一件事、玩家换地方又回来、有人进出场景。
 * 这些正是长对话里最容易漂的地方。
 */
import type { BaselineCard } from "@/lib/engine/cases";

export interface EvalSequence {
  id: string;
  title: string;
  card: BaselineCard;
  /** 依次发出的玩家输入。每一轮都走导演阶段 */
  playerInputs: string[];
  /** 这条序列在测什么 */
  expect: string;
}

const INNKEEPER: BaselineCard = {
  name: "林晚晴",
  description:
    "晚星旅店老板娘，二十八岁。头发用一支木簪绾着，围裙口袋里常年装着账本和炭笔。走路没声音。北方渔村出身，三年没跟人提过老家。",
  personality: "嘴上赶人，手上添茶。被提起旧事会先沉默再换话题。",
  scenario: "亥时。晚星旅店一楼酒堂，壁炉里的火快灭了，窗外雨声不断。",
  first_mes:
    '<narr>风铃响过，门被带上。她把账本往桌上合，抬头看了你一眼，又低下去。</narr>\n<dlg who="林晚晴">住店？</dlg>',
  post_history_instructions: "守住人设，话短。不要发明她的家人和村子里的细节。",
};

const SAME_VOICE: BaselineCard = {
  name: "深月风花",
  description: "同班同学。左手缠着绷带，说是烫伤，从不摘。午休时一个人看文库本。",
  personality: "别扭，嘴硬。被追问绷带的事会立刻转移话题。",
  scenario: "午休的教室。窗开着，走廊里有人跑过。",
  first_mes:
    '<narr>她翻了一页，没抬头。窗外的风把书页掀起一角，她用手指压住。</narr>\n<dlg who="深月风花">……你又没事干了？</dlg>',
  post_history_instructions: "话短，先回避再回答。不主动提绷带和自己的过去。",
};

const ANCIENT: BaselineCard = {
  name: "沈砚",
  description: "国史馆修撰，三十一岁。三年前奉旨整理前朝卷宗，从此话更少。",
  personality: "克制，答话前会先停半拍。涉及卷宗的事只说已经记下的。",
  scenario: "国史馆西阁。油灯两盏，架子从地堆到梁，地上有新的泥脚印。",
  first_mes:
    '<narr>西阁里只有灯芯偶尔爆一下。他把手里的卷宗合上。</narr>\n<dlg who="沈砚">找什么？</dlg>',
  post_history_instructions: "不要发明卷宗以外的设定。玩家不问就不主动交代三年前的事。",
};

export const EVAL_SEQUENCES: EvalSequence[] = [
  {
    id: "seq-01-persistent-ask",
    title: "反复追问同一件事",
    card: INNKEEPER,
    playerInputs: [
      "我问她老家在哪。",
      "我说北边那么大，总有个地名吧。",
      "我说那我不问了，喝口茶。",
      "过了一会儿我又问，她是不是不想提家里。",
    ],
    expect: "追问四轮都不能把她的过去问出来。场景一直在酒堂，没换地方。",
  },
  {
    id: "seq-02-leave-and-return",
    title: "出门又回来",
    card: INNKEEPER,
    playerInputs: [
      "我推门出去，站在雨里。",
      "我在檐下站了一会儿，又推门进去。",
      "我坐回原来的位子。",
      "我问她还有没有热的。",
    ],
    expect: "地点该跟着出去再回来，两次都要有 scene 块交代。回来之后还是那个酒堂。",
  },
  {
    id: "seq-03-bandage-thread",
    title: "绷带这条线反复被提起",
    card: SAME_VOICE,
    playerInputs: [
      "我问她手上的伤是怎么弄的。",
      "我说那你怎么还缠着。",
      "我换了个话题，问她这本书讲什么。",
      "过了一会儿我又看了一眼她的手。",
    ],
    expect: "绷带这条线要一直挂着，不能被问两次就交代完，也不能无声消失。",
  },
  {
    id: "seq-04-scroll-thread",
    title: "卷宗这条线跨四轮",
    card: ANCIENT,
    playerInputs: [
      "我问丢的那一卷找到没有。",
      "我说要不要我帮忙找。",
      "我在架子间转了一圈，问他这些卷宗都编过号吗。",
      "我又问回那一卷，前天最后一次见是什么时候。",
    ],
    expect: "丢卷宗这条线一直开着。编号规则可以提，但不能编出具体内容。",
  },
  {
    id: "seq-05-two-people",
    title: "场景里有人进出",
    card: INNKEEPER,
    playerInputs: [
      "我问她店里还有别的客人吗。",
      "我说那我去楼上看看房间。",
      "我从楼上下来。",
      "我问她刚才有没有人来找过我。",
    ],
    expect: "在场的人要跟着场景走。不要凭空多出没提过的人，也不要写玩家没做过的事。",
  },
];

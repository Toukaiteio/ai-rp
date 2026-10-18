import { ensureImportedCardsLoaded } from "@/lib/storage/cards";
import { getSessionStore } from "@/lib/storage";
import {
  forgetLastCardId,
  pickInitialCardId,
  readLastCardId,
  rememberLastCardId,
} from "./last-card";

/**
 * 启动时该进哪个角色。
 *
 * 卡表和会话表都要先读完才判定得了，所以是异步的：卡表决定记下的 id 还在
 * 不在，会话表决定「上一次」是哪张。判完顺手写回本机，下次启动走同步那条主路。
 *
 * 返回 null 表示没有可回的角色（一张卡都没有，或者卡和会话都对不上），
 * 由调用方退回角色架的第一张。
 */
export async function resolveStartupCardId(): Promise<string | null> {
  const records = await ensureImportedCardsLoaded();
  // list() 按最近更新排序，第一条就是最后聊过的那张卡
  const sessions = await getSessionStore().list();

  const remembered = readLastCardId();
  const chosen = pickInitialCardId({
    remembered,
    recent: sessions.map((session) => session.cardId),
    available: records.map((record) => record.id),
  });

  // 记下的那张已经不在了就别再留着，免得每次启动都先找一个不存在的 id
  if (remembered && remembered !== chosen) forgetLastCardId();
  if (chosen) rememberLastCardId(chosen);
  return chosen;
}

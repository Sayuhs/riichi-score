/**
 * 试算沙盒的结果格式化。
 *
 * ## 沙盒是什么
 *
 * 一个「随便改牌、实时看结果」的模式：打开后，每点一张牌就重算一次，
 * 结果直接显示在录牌界面底部 —— 不用走「下一步 → 设场况 → 算番」。
 *
 * 它的独有价值是**试**：改一张立刻看到「有役了 / 还是没役 / 变多少点」。
 * 正式的算番流程做不到这一点（要来回切页面）。
 *
 * ## 为什么逻辑放这里而不是组件里
 *
 * `.vue` 在本项目里测不到（装不了 jsdom）。凡是有对错之分的逻辑都放纯模块。
 * 这里要格式化的是「番数 / 符数 / 点数 / 役名」，算错了会让人照着错的去收钱。
 *
 * ## 为什么沙盒不显示本场和立直棒
 *
 * 那是**场面**信息（这局第几本场、桌上几根立直棒），沙盒里只是在试牌型，
 * 没有场面。显示它们只会让人以为数字算错了。
 */
import type { ScoreResult, ScoreError } from "../score/types.ts";
import { yakuLabel } from "./labels.ts";

export interface SandboxResult {
  /** 一句话摘要（永远非空，便于固定高度显示） */
  text: string;
  /** 有没有役（用来决定配色） */
  tone: "ok" | "bad" | "idle";
}

/** 还没录完 / 还不能算 */
const IDLE: SandboxResult = { text: "", tone: "idle" };

/**
 * 把一次算番结果格式化成沙盒要显示的一行字。
 *
 * @param result  算番结果（`null` = 还没算）
 * @param error   算番失败的原因（`null` = 没失败）
 * @param ready   手牌是否已经录完（没录完就不用显示错误）
 */
export function formatSandboxResult(
  result: ScoreResult | null,
  error: ScoreError | null,
  ready: boolean,
): SandboxResult {
  if (!ready) return IDLE;

  if (error) {
    if (error.kind === "no-yaku") {
      return { text: "无役 —— 光这样不能和牌", tone: "bad" };
    }
    if (error.kind === "invalid-hand") {
      return { text: "牌型不成立", tone: "bad" };
    }
    if (error.kind === "invalid-context") {
      return { text: "场况有矛盾", tone: "bad" };
    }
    return { text: "算不出来（罕见情况）", tone: "bad" };
  }

  if (!result) return IDLE;

  // 役名：役满时 han 是 0，只有 limit
  const names = result.yaku.map((y) => yakuLabel(y.name));
  const nameText = names.length ? names.join("、") : "（只有宝牌，不算役）";

  // 番：役满时显示「役满」而不是「0 番」
  const hanText = result.limit ? limitZh(result.limit) : `${result.han} 番`;

  return {
    text: `${nameText} · ${hanText} ${result.fu} 符 · ${result.total.toLocaleString()} 点`,
    tone: names.length ? "ok" : "bad",
  };
}

/** 役满倍数的中文 */
function limitZh(limit: string): string {
  if (limit.includes("quadruple")) return "四倍役满";
  if (limit.includes("triple")) return "三倍役满";
  if (limit.includes("double")) return "双倍役满";
  return "役满";
}

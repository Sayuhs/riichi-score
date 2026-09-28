/**
 * 「手牌不成立」的诊断。
 *
 * ## 为什么需要它
 *
 * 引擎对牌形不成立只吐一句英文：
 *   `Tiles do not form a winning hand: no valid grouping completes with the winning tile.`
 * 里面**没有任何可用信息** —— 不说哪里不对，也不说差什么。
 * 用户看到「手牌不成立」就卡住了：知道错了，但不知道怎么改。
 *
 * ## 怎么诊断（不靠猜，靠试和算）
 *
 * 两类真实错因都可以**确定性**地查出来：
 *
 * 1. **换哪一张就能和牌** —— 牌形不成立通常就是打错了一张牌。
 *    做法：门前 + 和牌张的每个位置 × 34 种牌面逐个替换，每一条候选都**过一遍引擎**。
 *
 * 2. **某张牌超过 4 张 / 根本凑不成面子** ——
 *    交给 `hand-shape.ts` 的 `shapeProblems`（同步、不依赖引擎）。
 *
 * ## ⚠️ 踩过的大坑：换牌建议必须「换完能真的和牌」
 *
 * 早期版本的换牌搜索只用**自写的分解器**判「牌形成立」，**不看有没有役**。
 * 于是会给出一句看起来很有道理、实际没用的建议：
 *
 *     手里 345p(吃) + 888p(碰) + 1m1m2m3m5m6m7m + 和牌张 6s
 *     → 建议「把 1万 换成 6条」
 *     → 换了之后：123m + 567m + 66s 雀头 + 345p + 888p
 *       牌形**是**成立了，但两组副露 + 手里还有 1万，**照样无役**，白改一遍。
 *
 * 现在整个搜索复用 `no-yaku-advice.ts` 的 `findTileSwaps` ——
 * 它的每一条候选都经过 `score()`，被淘汰的有两种：牌还不成立、或者还是没役。
 * 所以「有建议」= 「照着改就能和牌」。
 *
 * 附带的好处：换牌建议只出现在**自己能改的牌**上（门前 + 和牌张）。
 * 副露是整组进来的，改不了其中的单张 —— 对副露提「把这一张换成 XX」是空话。
 */
import type { GameState } from "./game-state.ts";
import type { HandState } from "./hand-state.ts";
import { findTileSwaps, type TileSwap } from "./no-yaku-advice.ts";
import { shapeProblems } from "./hand-shape.ts";
import { tileLabel } from "./tiles.ts";

export interface InvalidHandAdvice {
  /** 一句话结论 */
  verdict: string;
  /** 具体问题（可能多条，**永远非空**） */
  problems: string[];
  /** 换成某张牌就能「牌形成立 **而且有役**」；空数组 = 换单张救不回来 */
  swaps: TileSwap[];
  /** 其中「换和牌张」那一条（如果有）—— 它通常就是真相 */
  winningFix?: { from: string; to: string; yaku: string[]; han: number };
}

/**
 * 诊断「手牌不成立」。
 *
 * 调用方必须已经确认 `score()` 返回的是 `invalid-hand`。
 */
export async function diagnoseInvalidHand(
  hand: HandState,
  game: GameState,
): Promise<InvalidHandAdvice> {
  const problems = shapeProblems(hand, game);

  // 不限条数地搜，好把「换和牌张」那一条也包含进来 —— 它经常排在后面，
  // 但恰恰最有可能是真相（和牌张点错了）。
  const all = await findTileSwaps(hand, game, { limit: Number.MAX_SAFE_INTEGER });
  const win = all.find((s) => s.isWinning);
  const swaps = all.slice(0, 6);

  let verdict: string;
  if (swaps.length === 0) {
    verdict =
      "这手牌的牌形不成立，而且换单张牌也凑不出能和牌的牌形 —— 下面是我能看出的具体问题。";
  } else if (win) {
    verdict =
      `把「和牌张」从 ${tileLabel(win.from)} 改成 ${tileLabel(win.to)}，` +
      "牌形就成立、而且有役了。";
  } else {
    verdict = "这手牌的牌形不成立 —— 换成下面这些牌，牌形就成立、而且有役。";
  }

  return {
    verdict,
    problems,
    swaps,
    ...(win
      ? { winningFix: { from: win.from, to: win.to, yaku: win.yaku, han: win.han } }
      : {}),
  };
}

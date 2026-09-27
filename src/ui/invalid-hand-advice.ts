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
 * 三类真实错因都可以**确定性**地查出来：
 *
 * 1. **换哪一张就能成立** —— 牌形不成立通常就是打错了一张牌。
 *    做法：14 个位置 × 34 种牌面逐个替换，看哪种能构成和牌形。
 *    用自写的分解器穷举（不走引擎），476 次判定很快。
 *
 * 2. **某张牌超过 4 张** —— 引擎把「手牌 + 副露 + 表宝 + 里宝」合并计数，
 *    所以**宝牌指示牌和手牌撞牌**也会报「手牌不成立」，
 *    而用户根本想不到是宝牌的问题。
 *
 * 3. **根本凑不成面子** —— 用一个标准的「4 组面子 + 1 对雀头」分解器，
 *    算出最多能凑出几组、剩哪几张不成形。
 */
import type { GameState } from "./game-state.ts";
import type { HandState } from "./hand-state.ts";
import { buildHandInput } from "./build-input.ts";
import { score } from "../score/index.ts";
import { tileLabel } from "./tiles.ts";

export interface InvalidHandAdvice {
  /** 一句话结论 */
  verdict: string;
  /** 具体问题（可能多条） */
  problems: string[];
  /** 如果「换和牌张」就能成立，给出建议 */
  winningFix?: { from: string; to: string };
}

// ---------------------------------------------------------------- 牌面工具

/** 牌面 → 0~33 下标（万 0-8 / 筒 9-17 / 索 18-26 / 字 27-33）。赤 5 归一到普通 5 */
function tileIndex(t: string): number {
  const rank = Number(t[0]);
  const r = rank === 0 ? 5 : rank;
  const suit = t[1]!;
  const base = suit === "m" ? 0 : suit === "p" ? 9 : suit === "s" ? 18 : 27;
  return base + r - 1;
}

function indexToTile(i: number): string {
  if (i >= 27) return `${i - 26}z`;
  return `${(i % 9) + 1}${["m", "p", "s"][Math.floor(i / 9)]!}`;
}

function toCounts(tiles: string[]): number[] {
  const counts = new Array<number>(34).fill(0);
  for (const t of tiles) counts[tileIndex(t)]! += 1;
  return counts;
}

function leftoversOf(counts: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 34; i++) {
    for (let k = 0; k < counts[i]!; k++) out.push(indexToTile(i));
  }
  return out;
}

/**
 * 能不能恰好抽出 n 组面子（顺子或刻子）。
 *
 * @param exact true = 必须把牌全部用完（用于判定和牌形）
 *              false = 允许剩余（用于「最多能凑几组」）
 */
function extractSets(counts: number[], n: number, exact: boolean): boolean {
  if (n === 0) return exact ? counts.every((c) => c === 0) : true;

  const first = counts.findIndex((c) => c > 0);
  if (first < 0) return false;

  // 刻子
  if (counts[first]! >= 3) {
    counts[first]! -= 3;
    const hit = extractSets(counts, n - 1, exact);
    counts[first]! += 3;
    if (hit) return true;
  }

  // 顺子（字牌不能成顺）
  const rankInSuit = first % 9;
  if (first < 27 && rankInSuit <= 6 && counts[first + 1]! > 0 && counts[first + 2]! > 0) {
    counts[first]! -= 1;
    counts[first + 1]! -= 1;
    counts[first + 2]! -= 1;
    const hit = extractSets(counts, n - 1, exact);
    counts[first]! += 1;
    counts[first + 1]! += 1;
    counts[first + 2]! += 1;
    if (hit) return true;
  }

  return false;
}

/** 14 张能不能构成「4 组面子 + 1 对雀头」 */
function isStandardWin(tiles: string[]): boolean {
  if (tiles.length !== 14) return false;
  for (let i = 0; i < 34; i++) {
    const counts = toCounts(tiles);
    if (counts[i]! < 2) continue;
    counts[i]! -= 2;
    if (extractSets(counts, 4, true)) return true;
  }
  return false;
}

/** 七对子：7 组各不相同的对子 */
function isSevenPairs(tiles: string[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = toCounts(tiles);
  return counts.filter((c) => c === 2).length === 7;
}

/** 国士无双：13 种幺九各一张 + 其中一种再来一张 */
function isKokushi(tiles: string[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = toCounts(tiles);
  const isOrphan = (i: number) => i >= 27 || i % 9 === 0 || i % 9 === 8;

  let pairs = 0;
  for (let i = 0; i < 34; i++) {
    const c = counts[i]!;
    if (!isOrphan(i)) {
      if (c > 0) return false;
      continue;
    }
    if (c === 2) pairs += 1;
    else if (c !== 1) return false;
  }
  return pairs === 1;
}

/** 尽力分解：最多能凑出几组面子、还剩哪几张 */
function bestPartial(tiles: string[]): { sets: number; leftover: string[] } {
  let best: { sets: number; leftover: string[] } = { sets: 0, leftover: tiles.slice() };

  const consider = (counts: number[], n: number): void => {
    if (n > best.sets) best = { sets: n, leftover: leftoversOf(counts) };
  };

  // ① 先取一对当雀头，再凑面子
  for (let i = 0; i < 34; i++) {
    const base = toCounts(tiles);
    if (base[i]! < 2) continue;
    base[i]! -= 2;
    for (let n = 4; n >= 1; n--) {
      const copy = base.slice();
      if (extractSets(copy, n, false)) {
        consider(copy, n);
        break;
      }
    }
  }

  // ② 不取雀头，只凑面子
  for (let n = 4; n >= 1; n--) {
    const copy = toCounts(tiles);
    if (extractSets(copy, n, false)) {
      consider(copy, n);
      break;
    }
  }

  return best;
}

function zh(t: string): string {
  try {
    return tileLabel(t);
  } catch {
    return t;
  }
}

// ---------------------------------------------------------------- 诊断主体

/**
 * 诊断「手牌不成立」。
 *
 * 调用方必须已经确认 `score()` 返回的是 `invalid-hand`。
 */
export async function diagnoseInvalidHand(
  hand: HandState,
  game: GameState,
): Promise<InvalidHandAdvice> {
  const problems: string[] = [];

  const fourteen = [
    ...hand.concealed,
    ...(hand.winningTile ? [hand.winningTile] : []),
    ...hand.melds.flatMap((m) => m.tiles),
  ];

  // ---- 1. 某张牌超过 4 张（含宝牌指示牌）----
  //
  // ⚠️ 这条最容易被忽略：引擎把「手牌 + 副露 + 表宝 + 里宝」合并计数，
  //    所以**指示牌和手牌撞牌**也会报「手牌不成立」，
  //    用户完全想不到是宝牌指示牌的问题。
  const counts = toCounts(fourteen);
  const indicators = [...game.doraIndicators, ...game.uradoraIndicators];
  const indicatorCounts = toCounts(indicators);

  for (let i = 0; i < 34; i++) {
    const inHand = counts[i]!;
    const inIndicators = indicatorCounts[i]!;
    if (inIndicators > 0 && inHand + inIndicators > 4) {
      problems.push(
        `「${zh(indexToTile(i))}」在手里有 ${inHand} 张，又被设成宝牌指示牌 ` +
          `${inIndicators} 张 —— 同一张牌最多 4 张（指示牌也算在内）`,
      );
    } else if (inHand > 4) {
      problems.push(`「${zh(indexToTile(i))}」出现了 ${inHand} 张，最多只能有 4 张`);
    }
  }

  // ---- 2. 换哪一张牌就能成立（牌形错误最常见的修法）----
  //
  // ⚠️ 我第一版写的是「把和牌张与门前某张互换」—— 那是**错的**：
  //    互换不改变 14 张的多重集，引擎给的答案必然一样，
  //    所以那个循环永远不会命中。
  //
  //    正确做法是**替换成别的牌面**（真的改变多重集）。
  //
  //    穷举规模：14 个位置 × 34 种牌 = 476 次牌形判定。
  //    这里用自己的分解器（不走引擎），所以很快。
  //
  //    对**牌形**错误来说，「换哪张」的建议命中率很高 ——
  //    因为牌形不成立通常就是打错了一张牌。
  //    （注：这和无役的情况不同。无役时换一张常常直接破坏面子结构，
  //      实测命中 0；但牌形不成立时反过来了。）
  if (fourteen.length === 14) {
    const fixes: { at: number; from: string; to: string; isWinning: boolean }[] = [];
    const winIndex = fourteen.length - 1; // 最后一张约定为和牌张

    for (let i = 0; i < fourteen.length && fixes.length < 6; i++) {
      for (let k = 0; k < 34; k++) {
        const to = indexToTile(k);
        if (to === fourteen[i]) continue;
        const next = [...fourteen];
        next[i] = to;
        if (isStandardWin(next) || isSevenPairs(next) || isKokushi(next)) {
          fixes.push({
            at: i,
            from: fourteen[i]!,
            to,
            isWinning: i === winIndex,
          });
          break; // 同一个位置只报一个最直接的改法，避免刷屏
        }
      }
    }

    if (fixes.length) {
      const winFix = fixes.find((f) => f.isWinning);
      const first = winFix ?? fixes[0]!;
      // 只报「换和牌张」这一条（如果有），因为它通常就是真相
      return {
        verdict: winFix
          ? `把「和牌张」从 ${zh(winFix.from)} 改成 ${zh(winFix.to)}，牌形就成立了。`
          : `把一张 ${zh(first.from)} 换成 ${zh(first.to)}，牌形就成立了。`,
        problems,
        winningFix: winFix ? { from: winFix.from, to: winFix.to } : undefined,
      };
    }
  }
  // ---- 3. 是不是接近七对子 / 国士，或者根本凑不成面子 ----
  if (fourteen.length === 14 && !isStandardWin(fourteen) && !isSevenPairs(fourteen) && !isKokushi(fourteen)) {
    const partial = bestPartial(fourteen);
    const pairCount = counts.filter((c) => c >= 2).length;

    if (partial.leftover.length > 0) {
      problems.push(
        `能凑出 ${partial.sets} 组面子，但剩下的 ${partial.leftover.map(zh).join("、")} ` +
          `凑不成面子`,
      );
    }
    problems.push(
      `14 张要组成「4 组面子 + 1 对雀头」；现在还差 ${4 - partial.sets} 组面子` +
        (pairCount === 0 ? "，而且一张对子都没有" : ""),
    );
    problems.push("（七对子和国士无双也算和牌形，但这手牌两者都不是）");
  }

  if (problems.length === 0) {
    problems.push("牌形构不成「4 组面子 + 1 对雀头」，也不是七对子或国士无双");
  }

  return {
    verdict: "这手牌的牌形不成立 —— 下面是我能看出的具体问题。",
    problems,
  };
}

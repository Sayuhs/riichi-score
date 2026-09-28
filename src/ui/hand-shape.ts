/**
 * 牌形判定 —— 「这一手牌能不能构成和牌形」。
 *
 * ## 为什么单独成模块
 *
 * 同一件事实有**两个**消费者，各写一份必然走偏：
 *
 *   · 录满时的预检（`hand-precheck.ts`）—— 牌形不成立就该拦住「下一步」，
 *     因为牌形不成立时算番必然失败，让用户白跑一趟
 *   · 「手牌不成立」的诊断（`invalid-hand-advice.ts`）—— 要说清楚缺口在哪
 *
 * ## 按「逻辑张数」判，不按物理张数
 *
 * 引擎的契约是：`门前张数 + 副露组数 × 3 + 1 = 14` —— 每个杠只占 3 格。
 * 所以这里**只数副露的组数**，不看这组里有 3 张还是 4 张：杠本来就是一组面子。
 *
 * ⚠️ 踩过的坑：早期版本把「门前 + 和牌张 + 副露**实际张数**」拼成一个数组再判，
 *    有杠时拼出来是 15~18 张，判定函数一看长度不是 14 就直接返回 false，
 *    于是**有杠的牌形永远判不出来**。现在的入口 `isWinningShape` 只吃 `HandState`，
 *    张数按组数算，从源头避免这个错误。
 *
 * ## 七对子 / 国士无双
 *
 * 这两个也是和牌形，但它们要求**门清**（有副露时 14 张的多重集都对不上），
 * 所以只在 `melds.length === 0` 时才判。
 */
import type { GameState } from "./game-state.ts";
import type { HandState } from "./hand-state.ts";
import { tileLabel } from "./tiles.ts";

// ---------------------------------------------------------------- 牌面工具

/** 牌面 → 0~33 下标（万 0-8 / 饼 9-17 / 条 18-26 / 字 27-33）。赤 5 归一到普通 5 */
export function tileIndex(t: string): number {
  const rank = Number(t[0]);
  const r = rank === 0 ? 5 : rank;
  const suit = t[1]!;
  const base = suit === "m" ? 0 : suit === "p" ? 9 : suit === "s" ? 18 : 27;
  return base + r - 1;
}

export function indexToTile(i: number): string {
  if (i >= 27) return `${i - 26}z`;
  return `${(i % 9) + 1}${["m", "p", "s"][Math.floor(i / 9)]!}`;
}

export function toCounts(tiles: string[]): number[] {
  const counts = new Array<number>(34).fill(0);
  for (const t of tiles) counts[tileIndex(t)]! += 1;
  return counts;
}

export function leftoversOf(counts: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 34; i++) {
    for (let k = 0; k < counts[i]!; k++) out.push(indexToTile(i));
  }
  return out;
}

// ---------------------------------------------------------------- 分解器

/**
 * 能不能恰好抽出 n 组面子（顺子或刻子）。
 *
 * @param exact true = 必须把牌全部用完（用于判定和牌形）
 *              false = 允许剩余（用于「最多能凑几组」）
 */
export function extractSets(counts: number[], n: number, exact: boolean): boolean {
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

/**
 * `tiles` 能不能拆成 `setsNeeded` 组面子 + 1 对雀头。
 *
 * 张数必须**恰好**是 `setsNeeded * 3 + 2`（多一张少一张都直接否掉）。
 */
export function canFormWinningShape(tiles: string[], setsNeeded: number): boolean {
  if (setsNeeded < 0) return false;
  if (tiles.length !== setsNeeded * 3 + 2) return false;

  const counts = toCounts(tiles);
  // 同一种牌最多 4 张 —— 超了就不是合法的牌了（引擎也会报错）。
  // 注意 4 张本身是合法的（可以当刻子 + 顺子里的一张），所以是 > 4 才否。
  if (counts.some((c) => c > 4)) return false;

  for (let i = 0; i < 34; i++) {
    if (counts[i]! < 2) continue;
    counts[i]! -= 2;
    const hit = extractSets(counts, setsNeeded, true);
    counts[i]! += 2;
    if (hit) return true;
  }
  return false;
}

/** 七对子：7 组各不相同的对子 */
export function isSevenPairs(tiles: string[]): boolean {
  if (tiles.length !== 14) return false;
  const counts = toCounts(tiles);
  return counts.filter((c) => c === 2).length === 7;
}

/** 国士无双：13 种幺九各一张 + 其中一种再来一张 */
export function isKokushi(tiles: string[]): boolean {
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

/**
 * 尽力分解：最多能凑出几组面子、还剩哪几张。
 *
 * `maxSets` 是「还剩几组面子要凑」（无副露是 4，一组副露是 3……），
 * 不能写死 4 —— 带副露时那样算出来的缺口是错的。
 */
export function bestPartial(
  tiles: string[],
  maxSets: number,
): { sets: number; leftover: string[] } {
  let best: { sets: number; leftover: string[] } = { sets: 0, leftover: tiles.slice() };

  const consider = (counts: number[], n: number): void => {
    if (n > best.sets) best = { sets: n, leftover: leftoversOf(counts) };
  };

  // ① 先取一对当雀头，再凑面子
  for (let i = 0; i < 34; i++) {
    const base = toCounts(tiles);
    if (base[i]! < 2) continue;
    base[i]! -= 2;
    for (let n = maxSets; n >= 1; n--) {
      const copy = base.slice();
      if (extractSets(copy, n, false)) {
        consider(copy, n);
        break;
      }
    }
  }

  // ② 不取雀头，只凑面子
  for (let n = maxSets; n >= 1; n--) {
    const copy = toCounts(tiles);
    if (extractSets(copy, n, false)) {
      consider(copy, n);
      break;
    }
  }

  return best;
}

// ---------------------------------------------------------------- 顶层入口

/**
 * 这手牌是不是**合法和牌形**。
 *
 * 只看牌形，**不看有没有役** —— 「有役」是场况的函数（立直、自摸、役牌……），
 * 不是牌形的性质。两件事要分开判，否则会互相污染：
 *   · 牌形不成立 → 换牌是唯一出路（这个模块管）
 *   · 牌形成立但没役 → 可能只是场况没设对（`no-yaku-advice.ts` 管）
 *
 * 调用方必须先确认手牌**已录完**（`isComplete`），否则张数对不上必然返回 false。
 */
export function isWinningShape(hand: HandState): boolean {
  const meldCount = hand.melds.length;
  const setsNeeded = 4 - meldCount;
  if (setsNeeded < 0) return false;

  const tiles = [
    ...hand.concealed,
    ...(hand.winningTile ? [hand.winningTile] : []),
  ];

  // 门前 + 和牌张应当是「(4 - 副露组数) 组面子 + 雀头」
  if (tiles.length !== setsNeeded * 3 + 2) return false;

  // 七对子 / 国士无双都要求门清
  if (meldCount === 0 && (isSevenPairs(tiles) || isKokushi(tiles))) return true;

  return canFormWinningShape(tiles, setsNeeded);
}

// ---------------------------------------------------------------- 问题描述

function zh(t: string): string {
  try {
    return tileLabel(t);
  } catch {
    return t;
  }
}

/**
 * 牌形问题的中文描述（同步、不依赖引擎）。
 *
 * 引擎对手牌不成立只吐一句英文：
 *   `Tiles do not form a winning hand: no valid grouping completes with the winning tile.`
 * 里面没有任何可用信息 —— 不说哪里不对，也不说差什么。
 *
 * 这里给出**可以照着改**的话：某种牌超过 4 张、能凑出几组、剩哪几张不成形。
 *
 * @returns 空数组 = 牌形没问题（但「没问题」不代表有役）
 */
export function shapeProblems(hand: HandState, game: GameState): string[] {
  const problems: string[] = [];
  const meldCount = hand.melds.length;
  const tiles = [
    ...hand.concealed,
    ...(hand.winningTile ? [hand.winningTile] : []),
  ];
  const setsNeeded = 4 - meldCount;

  // ---- 1. 某张牌超过 4 张（含宝牌指示牌）----
  //
  // ⚠️ 这条最容易被忽略：引擎把「手牌 + 副露 + 表宝 + 里宝」合并计数，
  //    所以**指示牌和手牌撞牌**也会报「手牌不成立」，
  //    用户完全想不到是宝牌指示牌的问题。
  const all = [...tiles, ...hand.melds.flatMap((m) => m.tiles)];
  const counts = toCounts(all);
  const indicatorCounts = toCounts([...game.doraIndicators, ...game.uradoraIndicators]);

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

  // ---- 2. 牌形缺口 ----
  //
  // ⚠️ 这一段只在牌形**确实不成立**时才该说话。
  //    牌形成立时 `problems` 可以是空数组 ——「没有问题」就是它该有的答案。
  //    早期版本把兜底那句写成了无条件执行，于是**成立的牌也会收到
  //    「牌形构不成…」的警告**，等于每次调用都误报。
  if (!isWinningShape(hand)) {
    const goal =
      meldCount === 0
        ? "14 张要组成「4 组面子 + 1 对雀头」"
        : `14 张要组成「4 组面子 + 1 对雀头」，其中 ${meldCount} 组已经是副露`;

    const partial = bestPartial(tiles, setsNeeded);
    const pairCount = toCounts(tiles).filter((c) => c >= 2).length;

    if (partial.leftover.length > 0) {
      problems.push(
        `能凑出 ${meldCount + partial.sets} 组面子，但剩下的 ` +
          `${partial.leftover.map(zh).join("、")} 凑不成面子`,
      );
    }
    problems.push(
      `${goal}；现在还差 ${setsNeeded - partial.sets} 组面子` +
        (pairCount === 0 ? "，而且一张对子都没有" : ""),
    );
    if (meldCount === 0) {
      problems.push("（七对子和国士无双也算和牌形，但这手牌两者都不是）");
    }
  }

  return problems;
}

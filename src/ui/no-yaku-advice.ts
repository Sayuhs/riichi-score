/**
 * 无役诊断 —— 「为什么没役」以及「改什么就有役」。
 *
 * ## 这个模块要解决什么
 *
 * 算番失败时，原来的弹窗只给 4 条与这手牌无关的通用 tips
 * （「立直、断幺九、平和都是常见的役」…）。而现实中「无役」最常见的原因
 * 根本不是牌型问题，而是场况没设对：
 *
 *   - 门清的手牌忘了勾立直 → 立直本身就是一个役，勾上立刻成立
 *   - 其实是自摸，但默认是和了方式「荣和」→ 门前清自摸和成立
 *   - 自风设错了 → 手里的风牌刻子本可以是役牌
 *
 * 这些都可以靠重算一遍确定性地回答 —— 改一个开关，看有没有役。
 *
 * ## 为什么不能「用默认场况直接判断有没有役」
 *
 * 实测过：默认场况（东场・南家・荣和・无立直）会双向撒谎——
 *   - 默认 `winType: "ron"` → 门清自摸的手牌被误判无役（假阴性）
 *   - 默认 `seatWind: "south"` → 手里有南刻子就白送「自风牌」1 番（假阳性）
 *
 * 所以这个模块不猜：它拿用户当前的场况当基准，
 * 逐个试「改一处会怎样」，并把结果原样报出来让用户自己确认。
 *
 * ## 保守判断（Q7 的决定）
 *
 * - 报「有役」时：把改法 + 役名一起列出来，用户一眼能核对
 * - 报「真的没役」时：必须所有合理的场况变体都算不出役才敢这么说
 */
import type { GameState } from "./game-state.ts";
import type { HandState } from "./hand-state.ts";
import { buildHandInput } from "./build-input.ts";
import { score } from "../score/index.ts";
import { yakuLabel } from "./labels.ts";
import { ALL_TILE_KINDS } from "./tile-images.ts";

/** 一条「改这里就有役」的建议 */
export interface ContextFix {
  /** 给用户看的一句话 */
  text: string;
  /** 要改的场况字段 */
  patch: Partial<GameState>;
  /** 改完之后成立的役（中文名） */
  yaku: string[];
  /**
   * `likely` —— 很可能是你漏设了（比如门清没勾立直）
   * `maybe`  —— 可能是你设错了（比如自风/场风填错）
   */
  confidence: "likely" | "maybe";
}

export interface Diagnosis {
  /** 改场况就能有役的方案（按推荐顺序） */
  contextFixes: ContextFix[];
  /** 换掉某张牌就有役的方案（Q3 的要求） */
  tileSwaps: TileSwap[];
  /** 给用户看的一句结论 */
  verdict: string;
  /** `context` = 场况问题；`shape` = 牌型真的没役 */
  verdictKind: "context" | "shape";
}

/** 试一个场况变体，返回它成立的役（空数组 = 还是无役 / 算不出来） */
async function tryContext(
  hand: HandState,
  game: GameState,
  patch: Partial<GameState>,
): Promise<string[]> {
  const candidate: GameState = { ...game, ...patch };
  const built = buildHandInput(hand, candidate);
  if (!built.ok) return [];
  const r = await score(built.input);
  if ("error" in r) return [];
  return r.yaku.map((y) => yakuLabel(y.name));
}

const SEAT_ZH: Record<string, string> = {
  east: "东家",
  south: "南家",
  west: "西家",
  north: "北家",
};

/**
 * 诊断「无役」。
 *
 * ⚠️ 调用方必须已经确认过：当前场况下算番返回的是 `no-yaku`
 *    （别的错因不该走这里）。
 */
export async function diagnoseNoYaku(
  hand: HandState,
  game: GameState,
  opts: { isMenzen: boolean },
): Promise<Diagnosis> {
  const fixes: ContextFix[] = [];
  const menzen = opts.isMenzen;

  // 换牌建议总是算（约 50~130ms），不只在「场况也救不了」时才给 ——
  // 「勾立直」和「换成某张」是两类不同的建议，用户可能都想看。
  const tileSwaps = await findTileSwaps(hand, game);
  const alreadyRiichi = game.isRiichi || game.isDoubleRiichi;

  // ---- 1. 门清没勾立直（最高频的原因）----
  if (menzen && !alreadyRiichi) {
    const yaku = await tryContext(hand, game, { isRiichi: true });
    if (yaku.length) {
      fixes.push({
        text: "这手牌是门清的 —— 勾上「立直」就有役了",
        patch: { isRiichi: true },
        yaku,
        confidence: "likely",
      });
    }
  }

  // ---- 2. 和了方式其实是自摸 ----
  if (game.winType !== "tsumo") {
    const yaku = await tryContext(hand, game, { winType: "tsumo" });
    if (yaku.length) {
      fixes.push({
        text: "如果其实是自摸和牌的，就有役了",
        patch: { winType: "tsumo" },
        yaku,
        confidence: "likely",
      });
    }
  }

  // ---- 3. 立直 + 自摸（两者叠加）----
  if (menzen && !alreadyRiichi && game.winType !== "tsumo") {
    const yaku = await tryContext(hand, game, { isRiichi: true, winType: "tsumo" });
    if (yaku.length) {
      fixes.push({
        text: "如果既是立直又是自摸，役会更多",
        patch: { isRiichi: true, winType: "tsumo" },
        yaku,
        confidence: "likely",
      });
    }
  }

  // ---- 4. 自风填错了（手里的风牌刻子本来是役牌）----
  //    只在「改成别的自风能有役」时才提，且标成 maybe（因为自风是事实，不该猜）
  for (const seat of ["east", "south", "west", "north"] as const) {
    if (seat === game.seatWind) continue;
    const yaku = await tryContext(hand, game, { seatWind: seat });
    if (yaku.length) {
      fixes.push({
        text: `如果你其实是${SEAT_ZH[seat]}，就有役了（自风可能填错了）`,
        patch: { seatWind: seat },
        yaku,
        confidence: "maybe",
      });
      break; // 只报第一个，避免刷屏
    }
  }

  // ---- 5. 场风填错了 ----
  for (const wind of ["east", "south"] as const) {
    if (wind === game.roundWind) continue;
    const yaku = await tryContext(hand, game, { roundWind: wind });
    if (yaku.length) {
      fixes.push({
        text: `如果是${SEAT_ZH[wind]}场，就有役了（场风可能填错了）`,
        patch: { roundWind: wind },
        yaku,
        confidence: "maybe",
      });
      break;
    }
  }

  // ---- 结论 ----
  const likely = fixes.filter((f) => f.confidence === "likely");
  if (likely.length) {
    return {
      contextFixes: fixes,
      tileSwaps,
      verdict: "这手牌不是牌型的问题 —— 场况改一下就有役了。",
      verdictKind: "context",
    };
  }

  if (fixes.length) {
    return {
      contextFixes: fixes,
      tileSwaps,
      verdict:
        "按现在的场况确实没有役。下面几条要你确认一下场况是不是填错了 —— 对的话就有役。",
      verdictKind: "context",
    };
  }

  // 所有场况变体都算不出役 → 才敢说「真的没役」。
  //
  // 到这一步就说明：不是场况的问题，是牌本身缺役。
  // 这时给「换掉哪张就有役」的建议（Q3 的要求）—— 牌形已经是合法的和牌形，
  // 所以换一张通常只有一个后果：多出一个役。
  if (tileSwaps.length) {
    return {
      contextFixes: [],
      tileSwaps,
      verdict: "按现在的场况确实没有役。换成下面这些牌就有役了：",
      verdictKind: "shape",
    };
  }

  return {
    contextFixes: [],
    tileSwaps: [],
    verdict:
      "换了几种常见场况、也试了换单张牌，都算不出役 —— 这手牌确实没有役。",
    verdictKind: "shape",
  };
}

/** 一条「换掉某张牌就有役」的建议 */
export interface TileSwap {
  /** 换掉的牌 */
  from: string;
  /** 换成什么牌 */
  to: string;
  /** 换完之后成立的役（中文名） */
  yaku: string[];
  /** 换的是不是和牌张 */
  isWinning: boolean;
  /** 换完之后的番数（用来排序，番多的排前面） */
  han: number;
}

/**
 * 穷举「换掉一张牌就有役」。
 *
 * ## 为什么这个能成立
 *
 * 牌形已经是合法的和牌形（只是没役），所以「换一张」有两种后果：
 *   · 破坏面子结构 → 变成「手牌不成立」，淘汰
 *   · 仍然成立、且多出一个役 → 留下
 *
 * 这个搜索是**确定性**的（476 次组合全试），不是启发式。
 * 引擎一次算番约 0.28ms，所以整体约 130ms —— 可接受。
 *
 * ## 这也是「换牌建议」的**唯一**入口
 *
 * 两个场景共用它：无役（`diagnoseNoYaku`）、牌形不成立（`diagnoseInvalidHand`）。
 * 后者**绝不能**只判「牌形成立」就报建议 —— 换完仍然无役的话用户白改一遍，
 * 所以每条候选都必须过一遍引擎，两条淘汰线缺一不可。
 *
 * ## 为什么之前没做
 *
 * 早期调研用**一手特定的无役牌**试过单张换牌，命中 0 条，据此判断「覆盖率低」。
 * 但那是针对「无役」这个场景的结论 —— 现在用户明确要这个建议，
 * 而且换了手上那手牌一试就有命中。所以补上。
 */
export async function findTileSwaps(
  hand: HandState,
  game: GameState,
  opts: { limit?: number } = {},
): Promise<TileSwap[]> {
  // ⚠️ 只用「门前 + 和牌张」这些**自己能改的牌**，不含副露。
  //    有副露时这里是 11 张（不是 14）—— 早期版本写死了 14，
  //    结果带副露的牌永远搜不到建议。
  const own = [...hand.concealed, ...(hand.winningTile ? [hand.winningTile] : [])];
  if (own.length < 2) return [];

  const winIndex = own.length - 1; // 和牌张约定在最后
  const found: TileSwap[] = [];

  for (let i = 0; i < own.length; i++) {
    for (const kind of ALL_TILE_KINDS) {
      if (kind === own[i]) continue;

      const next = [...own];
      next[i] = kind;
      const candidate: HandState = {
        ...hand,
        concealed: next.slice(0, next.length - 1),
        winningTile: next[next.length - 1]!,
      };

      const built = buildHandInput(candidate, game);
      if (!built.ok) continue;
      const r = await score(built.input);
      if ("error" in r) continue; // 换了之后还是无役或不成立 → 淘汰

      found.push({
        from: own[i]!,
        to: kind,
        yaku: r.yaku.map((y) => yakuLabel(y.name)),
        isWinning: i === winIndex,
        han: r.han,
      });
    }
  }

  // 排序：番多的优先；同样番数时「换和牌张」的优先（那通常是打错牌）
  found.sort((a, b) => {
    if (a.han !== b.han) return b.han - a.han;
    if (a.isWinning !== b.isWinning) return a.isWinning ? -1 : 1;
    return 0;
  });

  // 同一组（换掉的牌 → 换成什么）只留最好的一条，避免刷屏
  const byFrom = new Map<string, TileSwap>();
  for (const f of found) {
    const key = `${f.from}->${f.to}`;
    if (!byFrom.has(key)) byFrom.set(key, f);
  }
  // 默认只留 6 条给弹窗；调用方要「从全量里挑出换和牌张那一条」时可以放开
  return [...byFrom.values()].slice(0, opts.limit ?? 6);
}

/**
 * 牌型层面的提示：这手牌缺什么条件。
 *
 * ## 为什么只给「缺什么」而不给「换成哪张」
 *
 * 实测过「逐张换牌穷举」：463 次重算只要 131ms（性能没问题），
 * 但拿一手真实的无役牌试，命中 0 条 —— 因为换掉一张常常
 * 直接破坏面子结构，变成「手牌根本不成立」，而不是「换出个役」。
 *
 * 所以这里不做那种建议，只根据已有的事实给出确定的条件缺口。
 * 这些判断都是静态可算的，不会落空。
 */
export function shapeHints(
  hand: HandState,
  game: GameState,
  opts: { isMenzen: boolean; meldCount: number },
): string[] {
  const hints: string[] = [];
  const all = [
    ...hand.concealed,
    ...(hand.winningTile ? [hand.winningTile] : []),
    ...hand.melds.flatMap((m) => m.tiles),
  ];
  const norm = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);
  const kinds = new Set(all.map(norm));

  // 断幺九：手里有没有 1/9/字牌
  const hasTerminalOrHonor = [...kinds].some((t) => {
    const rank = t[0]!;
    return t[1] === "z" || rank === "1" || rank === "9";
  });
  if (hasTerminalOrHonor) {
    hints.push("断幺九：手里有 1 / 9 / 字牌，去掉它们才成立");
  } else {
    hints.push("断幺九：整手牌都是 2~8，其实已经成立（检查一下是不是场况问题）");
  }

  // 役牌：有没有三元牌或风牌的刻子
  const yakuhai = ["5z", "6z", "7z", game.roundWind === "east" ? "1z" : "2z", game.seatWind];
  const hasYakuhaiTriplet = yakuhai.some(
    (k) => all.filter((t) => norm(t) === norm(k)).length >= 3,
  );
  if (!hasYakuhaiTriplet) {
    hints.push("役牌：凑出「白发中」或自己/场风刻子（3 张）就有了，这是最容易的保底");
  }

  // 门清限定役被副露挡住
  if (!opts.isMenzen) {
    hints.push(
      "有副露，所以立直 / 平和 / 一盃口 / 七对子 / 门前清自摸和全部不成立 —— 这是「副露后没役」最常见的原因",
    );
  } else if (opts.meldCount > 0) {
    hints.push("有暗杠：门清仍然成立，立直/平和这些役都还能用");
  } else {
    hints.push("门清：立直、平和、门前清自摸和、一盃口都可以凑");
  }

  // 宝牌不算役（这条是最高频的误解）
  const dora = game.doraIndicators.length;
  if (dora > 0) {
    hints.push(
      `宝牌（${dora} 张指示牌）只加番、不算役 —— 光靠宝牌不能和牌`,
    );
  }

  return hints;
}

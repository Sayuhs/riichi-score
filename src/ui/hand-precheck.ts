/**
 * 录入完成时的「预检」。
 *
 * ## 要解决的问题
 *
 * 录完牌 → 点下一步 → 设场况 → 按算番 → 才发现「无役」。白跑一趟。
 *
 * ## 但不能简单地「无役就拦」
 *
 * 「有没有役」**不取决于牌型，取决于场况**。同一手牌 `123m 456m 789p 234s 99s`：
 *
 *   荣和 + 不立直  → 无役
 *   勾上立直       → 有役（立直）
 *   自摸           → 有役（门前清自摸和）
 *
 * 如果按「当前场况无役」就禁用「下一步」，用户**永远进不去场况页**，
 * 也就永远勾不上立直 —— 这手牌直接卡死。而现实中「无役」绝大多数
 * 恰恰就是忘了勾立直。
 *
 * ## 所以分成三档
 *
 * | 预检结果 | 含义 | 界面 |
 * |---------|------|------|
 * | `ok` | 当前场况就有役 | 正常，不打扰 |
 * | `context-hint` | 当前没役，但**勾上某个开关就有** | **允许下一步**，提示「记得勾立直」 |
 * | `hopeless` | 试遍常见场况变体都没役 | **拦住**，要求换牌，并直接给换牌建议 |
 *
 * 只有 `hopeless` 才拦 —— 那时换牌确实是唯一出路，符合「没役就只能换牌」的直觉。
 */
import type { GameState } from "./game-state.ts";
import type { HandState } from "./hand-state.ts";
import { buildHandInput } from "./build-input.ts";
import { isComplete } from "./hand-state.ts";
import { score } from "../score/index.ts";
import { findTileSwaps, type TileSwap } from "./no-yaku-advice.ts";

export type PrecheckKind = "idle" | "ok" | "context-hint" | "hopeless";

export interface PrecheckResult {
  kind: PrecheckKind;
  /** 提示文案 —— **永远非空**，便于固定高度不留抖动 */
  text: string;
  /** `hopeless` 时的换牌建议（含参考役） */
  swaps: TileSwap[];
}

const IDLE: PrecheckResult = { kind: "idle", text: "", swaps: [] };
const OK: PrecheckResult = { kind: "ok", text: "", swaps: [] };

/** 试一个场况变体，返回它成立的役名（空数组 = 还是没役） */
async function yakuUnder(
  hand: HandState,
  game: GameState,
  patch: Partial<GameState>,
): Promise<string[]> {
  const built = buildHandInput(hand, { ...game, ...patch });
  if (!built.ok) return [];
  const r = await score(built.input);
  if ("error" in r) return [];
  return r.yaku.map((y) => y.name);
}

/**
 * 预检一手已录完的牌。
 *
 * 只在手牌**完整**时才跑（不完整时没有意义，也不该浪费算力）。
 */
export async function precheckHand(
  hand: HandState,
  game: GameState,
  opts: { isMenzen: boolean },
): Promise<PrecheckResult> {
  if (!isComplete(hand)) return IDLE;

  // --- 当前场况 ---
  const built = buildHandInput(hand, game);
  if (!built.ok) return IDLE;
  const current = await score(built.input);

  // 不是「无役」的问题（牌形不成立 / 场况矛盾）→ 交给既有的诊断，这里不拦
  if ("error" in current) {
    if (current.error.kind !== "no-yaku") return OK;
  } else {
    // 当前场况就有役
    return OK;
  }

  // --- 当前无役：试常见变体 ---
  const variations: { patch: Partial<GameState>; label: string; applicable: boolean }[] = [
    {
      patch: { isRiichi: true },
      label: "立直",
      applicable: opts.isMenzen && !game.isRiichi && !game.isDoubleRiichi,
    },
    {
      patch: { winType: "tsumo" },
      label: "自摸",
      applicable: game.winType !== "tsumo",
    },
    {
      patch: { isRiichi: true, winType: "tsumo" },
      label: "立直 + 自摸",
      applicable: opts.isMenzen && !game.isRiichi && !game.isDoubleRiichi && game.winType !== "tsumo",
    },
  ];

  for (const v of variations) {
    if (!v.applicable) continue;
    const names = await yakuUnder(hand, game, v.patch);
    if (names.length) {
      return {
        kind: "context-hint",
        text: `当前场况下没有役 —— 但勾上「${v.label}」就有了。`,
        swaps: [],
      };
    }
  }

  // --- 试遍变体都没役 → 真的没役，换牌是唯一出路 ---
  const swaps = await findTileSwaps(hand, game);

  return {
    kind: "hopeless",
    text: swaps.length
      ? "这手牌没有役 —— 换成下面这些牌之一才有役。"
      : "这手牌没有役，而且换单张牌也凑不出役。",
    swaps,
  };
}

/**
 * 宝牌指示牌的点选规则。
 *
 * ## 为什么这些规则必须在应用层实现
 *
 * agent 实测过引擎（`riichi-score@3.0.0`）的行为 —— **它对指示牌几乎完全不校验**：
 *
 * | 输入 | 引擎反应 |
 * |------|---------|
 * | 6 张指示牌 | 不报错，`dora` 直接等于 6 |
 * | 8 张指示牌 | 不报错，`dora` 等于 8 |
 * | 非法牌面 `"9z"` | **静默忽略**，`dora = 0` |
 * | 表 1 张 + 里 6 张 | 不报错（表里张数必须相等这条它不管） |
 *
 * 也就是说：**输错了不会报错，会静默算出离谱的番数。**
 * 「最多 5 张」「表里张数相等」「同一张牌 ≤ 4」全靠这一层挡。
 *
 * 唯一引擎会管的是「同一张牌（手牌+副露+表宝+里宝）≤ 4 张」，
 * 但它吐的是英文 `A tile appears more than four times: 1m (5).` ——
 * 与其让用户看到那句，不如在这里提前禁掉。
 *
 * ## 这些规则为什么是纯函数
 *
 * 因为 `.vue` 在这个项目里**测不到**（装不了 jsdom）。
 * 宝牌文本框那个 bug 能溜过 274 个测试，就是因为规则写在组件里。
 */
import type { TileStr } from "../score/types.ts";
import { ALL_TILE_KINDS, PICKER_ROWS } from "./tile-images.ts";

/**
 * 指示牌数量上限：初始 1 张 + 最多 4 次杠。
 *
 * ⚠️ 依据说明（诚实标注）：
 *    tenhou 的 mjlog 规范只给出**结构**（初始 1 张 + 每次杠追加 1 张），
 *    没有明文写「5」。那个「4 次杠」来自外部规则知识（王牌只有 4 张岭上牌）。
 *    仓库里唯一写出「5」的地方是 docs/DESIGN.md。
 *    四杠子（役满）的和牌确实可能出现第 5 张，所以 5 必须接受。
 */
export const MAX_INDICATORS = 5;

/** 同一张牌的总数上限（手牌 + 副露 + 表宝 + 里宝 合并计数） */
export const MAX_COPIES = 4;

/**
 * 指示牌可选的牌面。
 *
 * **不含赤 5**（Q15 的决策）：赤 5 虽然理论上可能被翻成指示牌，
 * 但它对算分**零影响** —— 指示牌显示 `5m` 还是 `赤5m`，翻出来的都是 `6m`。
 * 而允许它就得同时扣两种预算（4 枚上限 + 赤牌数），复杂度不值当。
 */
export const SELECTABLE_ROWS: string[][] = PICKER_ROWS.slice(0, 4);

/** 可选牌面的扁平列表 */
export const SELECTABLE_KINDS: string[] = ALL_TILE_KINDS;

/**
 * 把赤 5 归一到普通 5。
 *
 * 引擎内部也这么做（`replaceAkadora`），因为「同一张牌 ≤ 4」是
 * 按物理牌张数算的 —— `0m` 和 `5m` 是同一张牌的两个形态。
 */
export function normalizeKind(tile: string): string {
  return tile[0] === "0" ? `5${tile[1]}` : tile;
}

/** 是不是赤 5 */
export function isAkaFive(tile: string): boolean {
  return tile[0] === "0";
}

export interface IndicatorState {
  dora: TileStr[];
  uradora: TileStr[];
}

export interface PickCheck {
  ok: boolean;
  /** 不能选的原因（可直接显示给用户） */
  reason?: string;
}

/**
 * 判断某张牌能不能作为指示牌加进去。
 *
 * @param which      加进「表宝」还是「里宝」
 * @param tile       牌面
 * @param current    当前已选的表宝/里宝
 * @param countInHand 手牌 + 副露里某张牌有几张（用 `hand-state.countKind`）
 */
export function canPick(
  which: "dora" | "uradora",
  tile: string,
  current: IndicatorState,
  countInHand: (kind: string) => number,
): PickCheck {
  if (isAkaFive(tile)) {
    return { ok: false, reason: "指示牌不用赤 5（对算分没有影响）" };
  }

  const list = which === "dora" ? current.dora : current.uradora;

  if (list.length >= MAX_INDICATORS) {
    return {
      ok: false,
      reason: `最多 ${MAX_INDICATORS} 张（初始 1 张 + 最多 4 次杠）`,
    };
  }

  // 里宝张数不能超过表宝 —— 表里一一对应，翻几张表宝就压几张里宝
  if (which === "uradora" && list.length >= current.dora.length) {
    return {
      ok: false,
      reason: "里宝牌张数不能超过宝牌张数（表里一一对应）",
    };
  }

  // 同一张牌合并计数 ≤ 4
  const kind = normalizeKind(tile);
  let total = countInHand(kind);
  for (const t of [...current.dora, ...current.uradora]) {
    if (normalizeKind(t) === kind) total++;
  }
  if (total >= MAX_COPIES) {
    return {
      ok: false,
      reason: `「${kind}」已经用了 ${MAX_COPIES} 张（手牌 + 副露 + 指示牌合计）`,
    };
  }

  return { ok: true };
}

/**
 * 加一张指示牌。
 *
 * 注意：**不同位置的重复指示牌是合法的**（两张 `3m` 指示牌完全没问题），
 * 只要不撞上「同一张牌 ≤ 4」那条。所以这里不去重。
 */
export function addIndicator(
  state: IndicatorState,
  which: "dora" | "uradora",
  tile: string,
  countInHand: (kind: string) => number,
): { state: IndicatorState; notice: string | null } {
  const check = canPick(which, tile, state, countInHand);
  if (!check.ok) return { state, notice: check.reason ?? "这张牌不能选" };

  const list = which === "dora" ? state.dora : state.uradora;
  return {
    state: { ...state, [which]: [...list, tile] },
    notice: null,
  };
}

/**
 * 删一张指示牌。
 *
 * ⚠️ 删掉表宝后，里宝可能比表宝多 —— 那违反「表里一一对应」，
 *    所以把多出来的里宝截掉。否则用户会进入一个自己没造过的非法状态。
 */
export function removeIndicator(
  state: IndicatorState,
  which: "dora" | "uradora",
  index: number,
): IndicatorState {
  const list = [...(which === "dora" ? state.dora : state.uradora)];
  list.splice(index, 1);

  const next: IndicatorState = { ...state, [which]: list };
  if (next.uradora.length > next.dora.length) {
    next.uradora = next.uradora.slice(0, next.dora.length);
  }
  return next;
}

/** 里宝现在能不能选（未立直时整块锁死） */
export function uradoraEnabled(state: IndicatorState, isRiichi: boolean): boolean {
  // 没有表宝就不可能有里宝；未立直时里宝也不会被翻开
  return isRiichi && state.dora.length > 0;
}

/**
 * 那个把状态翻转的操作：切换某张指示牌。
 *
 * 点已有的 → 删掉；点新的 → 加上。返回新状态和提示文案。
 */
export function toggleIndicator(
  state: IndicatorState,
  which: "dora" | "uradora",
  tile: string,
  countInHand: (kind: string) => number,
): { state: IndicatorState; notice: string | null } {
  const list = which === "dora" ? state.dora : state.uradora;
  const idx = list.indexOf(tile);
  if (idx >= 0) {
    return { state: removeIndicator(state, which, idx), notice: null };
  }
  return addIndicator(state, which, tile, countInHand);
}

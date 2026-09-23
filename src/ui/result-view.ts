/**
 * 结算结果页的派生数据。
 *
 * ## 为什么这些逻辑不写在组件里
 *
 * 这个项目**无法测试 `.vue` 组件** —— 沙箱装不了 jsdom，组件挂不起来
 * （见 `ui/__tests__/render.test.ts` 顶部的说明）。
 * 所以凡是有对错之分的逻辑都必须放在纯模块里，组件只做接线。
 *
 * 这条规矩不是洁癖：宝牌输入框那个 bug 能溜过 274 个测试，
 * 就是因为「解析出来的结果怎么用」这段逻辑写在组件里，测不到。
 */
import type { ScoreResult, Seat } from "../score/types.ts";
import { ALL_SEATS, sumPayments } from "../score/honba.ts";

/** 支付明细的一行 */
export interface PaymentRow {
  seat: Seat;
  /** 引擎给出的基础支付 */
  base: number;
  /** 本场带来的额外支付 */
  honba: number;
  /** 合计 —— **取自 `finalPayments`，不是 base + honba 现算的** */
  total: number;
}

/**
 * 把支付明细摊成「逐家一行」。
 *
 * ## 关键设计：合计只认 `finalPayments`
 *
 * 合并逻辑（基础支付 + 本场）的唯一来源是 `honba.ts` 的 `mergePayments`。
 * 如果这里再写一遍 `base + honba`，就又多了一处「同一条规则写两遍」——
 * 这个项目已经因为同类重复出过好几个 bug（尺寸公式、亲家判定、赤 5 折算）。
 *
 * 所以合计直接读 `finalPayments`，`honba` 用减法反推。
 * 配套测试断言 `(seat, total)` 与 `finalPayments` 逐项相等 ——
 * 一旦有人在这里加算式，测试会红。
 */
export function buildPaymentRows(result: ScoreResult): PaymentRow[] {
  const rows: PaymentRow[] = [];

  for (const seat of ALL_SEATS) {
    const total = result.finalPayments.find((p) => p.seat === seat)?.value;
    // 只列出真正参与支付的座位：
    // 自摸时和牌者不付，荣和时非放铳者不付
    if (total === undefined) continue;

    const base = result.basePayments.find((p) => p.seat === seat)?.value ?? 0;
    rows.push({ seat, base, honba: total - base, total });
  }

  return rows;
}

/**
 * 本场带来的支付合计。
 *
 * 荣和时由放铳者独付 300 × 本场数；自摸时三家各付 100 × 本场数 ——
 * 两种情况的总和都是 300 × 本场数，所以这个数字适合直接展示。
 */
export function honbaTotal(result: ScoreResult): number {
  return sumPayments(result.honbaPayments);
}

/**
 * 本场提示文案。
 *
 * ⚠️ 这里曾经直接把 `result.honbaPayments` 插进模板 —— 它的类型是 `Payment[]`，
 *    Vue 插值对象数组会渲染成 `[object Object]`，
 *    所以有本场时用户看到的是「本场 [object Object] 已计入。」
 *
 * 现在文案由纯函数生成，可被测试断言「不含 [object Object]」。
 */
export function honbaNote(result: ScoreResult): string {
  if (result.honbaPayments.length === 0) return "";
  return `本场（共 ${honbaTotal(result).toLocaleString()} 点）已计入。`;
}

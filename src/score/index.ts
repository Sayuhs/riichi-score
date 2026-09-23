/**
 * Scorer 统一入口。
 *
 * 对外只暴露这一个函数：`score()`。UI 不需要知道底下用的是哪个引擎，
 * 也不需要知道本场数/立直棒是引擎算的还是我们自己加的。
 *
 * 合成流程：
 *   1. 引擎算出「役 / 番 / 符 / 基本点 / 支付明细」（不含本场与立直棒）
 *   2. 本层加上本场数的额外支付
 *   3. 本层加上立直棒收入
 *   4. 可选：手动覆盖（争议时的逃生舱）
 */
import { honbaPayments, mergePayments, riichiBonus, sumPayments } from "./honba.ts";
import { scoreWithRiichiScore } from "./engine-riichi-score.ts";
import type {
  EngineResult,
  HandInput,
  ScoreError,
  ScoreResult,
  YakuEntry,
} from "./types.ts";

export * from "./types.ts";
export {
  honbaPayments,
  riichiBonus,
  isDealer,
  mergePayments,
  sumPayments,
} from "./honba.ts";

/** 手动覆盖：库不支持的场面（包、双响、罕见规则）时直接填结果 */
export interface ManualOverride {
  han?: number;
  fu?: number;
  /** 直接指定和牌者总收入；给了这个就忽略其余 */
  total?: number;
  yakuNote?: string;
}

export interface ScoreOptions {
  /** 手动覆盖：库不支持的场面（包、双响、罕见规则）时直接填结果 */
  override?: ManualOverride;
}

/** 失败形态。用判别联合，让调用方 `'error' in r` 之后能直接读到 `kind` 与 `message` */
export type Failure = { error: ScoreError };
export type Outcome = ScoreResult | Failure;

/**
 * 算一手牌。
 *
 * 固定用 `riichi-score`（天凤规则默认值正确，已实测）。
 * `@sacckey/mahjong` 只在测试里作为**交叉验证的第二意见**使用，
 * 所以不在这里暴露——否则动态 import 会把它打进发布包（多 6KB）。
 * 需要交叉对拍时请直接调 `engine-sacckey.ts`（见 __tests__/crosscheck2.ts）。
 */
export async function score(
  input: HandInput,
  options: ScoreOptions = {},
): Promise<Outcome> {
  return composeResult(input, scoreWithRiichiScore(input), options);
}

/**
 * 把引擎结果 + 本场/立直棒 合成最终结果。
 * 单独导出，便于测试与「手动覆盖」纯逻辑复用。
 */
export function composeResult(
  input: HandInput,
  engineResult: EngineResult,
  options: ScoreOptions = {},
): Outcome {
  const { context } = input;
  const honba = context.honba ?? 0;
  const sticks = context.riichiSticks ?? 0;

  if (!engineResult.ok) {
    // 有手动覆盖时，即使引擎说没役也照样出结果 —— 这正是逃生舱的意义
    if (options.override && manualLooksUsable(options.override)) {
      return buildOverrideResult(input, options.override, honba, sticks);
    }
    return { error: engineResult.error };
  }

  const s = engineResult.score;
  const basePayments = s.payments;
  const extra = honbaPayments(honba, {
    winType: context.winType,
    seatWind: context.seatWind,
    ...(context.from ? { from: context.from } : {}),
  });
  const bonus = riichiBonus(sticks);
  const finalPayments = mergePayments(basePayments, extra);

  return {
    yaku: s.yaku,
    han: s.han,
    fu: s.fu,
    basicPoints: s.basicPoints,
    ...(s.limit ? { limit: s.limit } : {}),
    fuItems: s.fuItems,
    honbaPayments: extra,
    riichiBonus: bonus,
    basePayments,
    finalPayments,
    total: sumPayments(finalPayments) + bonus,
    dora: s.dora,
    uradora: s.uradora,
    akadora: s.akadora,
  };
}

function manualLooksUsable(o: ManualOverride): boolean {
  return o.total != null || (o.han != null && o.fu != null);
}

/**
 * 手动覆盖的结果。
 * 只做最基本的支付推导（荣和 4/6 倍、自摸 1/1/2 倍），够用即可——
 * 这是逃生舱，不是第二套算点引擎。
 */
function buildOverrideResult(
  input: HandInput,
  o: ManualOverride,
  honba: number,
  sticks: number,
): ScoreResult {
  const { context } = input;
  const dealer = context.seatWind === "east";
  const extra = honbaPayments(honba, {
    winType: context.winType,
    seatWind: context.seatWind,
    ...(context.from ? { from: context.from } : {}),
  });
  const bonus = riichiBonus(sticks);

  // 直接给了总点数就照用，不做反推
  if (o.total != null && (o.han == null || o.fu == null)) {
    return {
      yaku: o.yakuNote ? [{ name: o.yakuNote, han: 0 } as YakuEntry] : [],
      han: o.han ?? 0,
      fu: o.fu ?? 0,
      basicPoints: 0,
      fuItems: [],
      honbaPayments: extra,
      riichiBonus: bonus,
      basePayments: [],
      finalPayments: [],
      total: o.total,
      dora: 0,
      uradora: 0,
      akadora: 0,
      overridden: true,
    };
  }

  const han = o.han ?? 0;
  const fu = o.fu ?? 0;
  const basic =
    han >= 13 ? 8000 : han >= 11 ? 6000 : han >= 8 ? 4000 : han >= 6 ? 3000 : han >= 5 ? 2000 : Math.min(fu * 2 ** (2 + han), 2000);
  const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

  const basePayments = context.winType === "ron"
    ? [{ seat: (context.from ?? "west"), value: ceil100((dealer ? 6 : 4) * basic) }]
    : (["east", "south", "west", "north"] as const)
        .filter((seat) => seat !== context.seatWind)
        .map((seat) => ({
          seat,
          value: ceil100((dealer || seat === "east" ? 2 : 1) * basic),
        }));

  const finalPayments = mergePayments(basePayments, extra);

  return {
    yaku: o.yakuNote ? [{ name: o.yakuNote, han: 0 } as YakuEntry] : [],
    han,
    fu,
    basicPoints: basic,
    fuItems: [],
    honbaPayments: extra,
    riichiBonus: bonus,
    basePayments,
    finalPayments,
    total: sumPayments(finalPayments) + bonus,
    dora: 0,
    uradora: 0,
    akadora: 0,
    overridden: true,
  };
}

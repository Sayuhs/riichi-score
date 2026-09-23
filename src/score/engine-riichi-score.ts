/**
 * `riichi-score` 适配器。
 *
 * 该引擎的特点（已实测）：
 *  - `closedTiles` 是**不含和牌张**的 13 张（副露时相应减少）
 *  - 牌记法就用天凤风格 '1m' / '0p'(赤5) / '5z'，与本层领域类型一致
 *  - **不处理本场数与立直棒** —— 由 honba.ts 在外层补算
 *  - 不支持「包」与双响
 *  - `run` 的 from 必须是和牌者的上家，否则直接报错
 *
 * 这个适配器把引擎的怪癖挡在外面，对外只暴露 types.ts 的领域类型。
 */
import {
  calculate as engineCalculate,
  createGameState,
} from "riichi-score";
import type { Meld, Seat, TileStr } from "./types.ts";
import type {
  EngineResult,
  EngineScore,
  FuItem,
  HandInput,
  Payment,
  YakuEntry,
} from "./types.ts";

/** 座位到上家的映射：从和牌者视角，chi 只能来自上家 */
const KAMICHA: Record<Seat, Seat> = {
  east: "north",
  south: "east",
  west: "south",
  north: "west",
};

/** 把本层 Meld 转成引擎要的 openMelds */
function toEngineMelds(melds: Meld[] | undefined, seatWind: Seat) {
  return (melds ?? []).map((meld) => {
    if (meld.type === "ankan") {
      // 暗杠没有鸣牌来源，也没有被鸣的牌
      return { type: "ankan" as const, tiles: [...meld.tiles] as TileStr[] };
    }
    return {
      type: meld.type,
      tiles: [...meld.tiles] as TileStr[],
      // 引擎会校验 chi 必须来自上家，这里直接按规则补上，UI 不必操心
      from: meld.from ?? KAMICHA[seatWind],
      calledIndex: meld.calledIndex ?? 0,
    };
  });
}

function toSeatPayments(
  raw: { seat: string; value: number }[],
): Payment[] {
  return raw.map((p) => ({ seat: p.seat as Seat, value: p.value }));
}

export function scoreWithRiichiScore(input: HandInput): EngineResult {
  const { context } = input;

  const gameState = createGameState({
    roundWind: context.roundWind,
    seatWind: context.seatWind,
    doraIndicators: (context.doraIndicators ?? []) as never,
    uradoraIndicators: (context.uradoraIndicators ?? []) as never,
    isRiichi: context.isRiichi ?? false,
    isDoubleRiichi: context.isDoubleRiichi ?? false,
    isIppatsu: context.isIppatsu ?? false,
    isHaitei: context.isHaitei ?? false,
    isHoutei: context.isHoutei ?? false,
    isRinshan: context.isRinshan ?? false,
    isChankan: context.isChankan ?? false,
    isTenhou: context.isTenhou ?? false,
    isChiihou: context.isChiihou ?? false,
    // 引擎会存下这个字段但**不参与计算**，传 0 以免误导
    honbaCount: 0,
    ruleset: context.ruleset as never,
  });

  const winningTile =
    context.winType === "tsumo"
      ? { tile: input.winningTile as never, isTsumo: true as const }
      : {
          tile: input.winningTile as never,
          from: (context.from ?? "west") as never,
        };

  let analysis;
  try {
    analysis = engineCalculate({
      closedTiles: [...input.concealed] as never,
      openMelds: toEngineMelds(input.melds, context.seatWind) as never,
      winningTile: winningTile as never,
      gameState,
    });
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "engine-error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  if (!analysis.valid) {
    const message = analysis.errors.join("; ");
    // 区分「真的没役」和「手牌根本不成立」——UI 要给不同的提示
    const noYaku = analysis.errors.some((err) => err.includes("no yaku"));
    return {
      ok: false,
      error: noYaku
        ? { kind: "no-yaku", message }
        : { kind: "invalid-hand", message },
    };
  }

  // ⚠️ 引擎的高点法排序**不完整**：它只按 basicPoints 降序排，没有实现
  // 「基本点相同时比番数、再比符数」的二级比较（见 calculate.js 末尾的 sort）。
  // 实测案例：清一色 11223345678999m+9m 有两个合法解读，
  //   解读A 11番30符 / 解读B 12番20符 —— 基本点都是 6000（三倍满），
  // 引擎把 11 番排前（插入序），而正确的高点法应取 12 番。
  // 这不会改变实际支付（基本点相同则点数相同），但会让**显示的番符是错的**，
  // 而线下算钱时番符是要念出来服人的，所以这里补全排序。
  const ranked = [...analysis.handInterpretations].sort(
    (a, b) =>
      b.basicPoints - a.basicPoints ||
      b.han - a.han ||
      (b.fu as number) - (a.fu as number),
  );
  const best = ranked[0]!;

  const score: EngineScore = {
    yaku: best.yaku.map(
      (y): YakuEntry => ({
        name: y.name,
        han: y.han,
        ...(y.limit ? { limit: y.limit } : {}),
      }),
    ),
    han: best.han,
    fu: best.fu as number,
    basicPoints: best.basicPoints,
    ...(best.limit ? { limit: best.limit } : {}),
    fuItems: best.fuList.map(
      (f): FuItem => ({ value: f.value, reason: f.reason }),
    ),
    payments: toSeatPayments(best.seatPayments),
    totalWinnings: best.totalWinnings,
    dora: best.dora,
    uradora: best.uradora,
    akadora: best.akadora,
  };

  return { ok: true, score };
}

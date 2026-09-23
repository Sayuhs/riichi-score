/**
 * `@sacckey/mahjong` 适配器 —— 用作**交叉验证的第二意见**。
 *
 * 与 riichi-score 的关键差异（已实测）：
 *  - `concealedTiles` 要 **14 张（含和牌张）**，而不是 13 张
 *  - 牌名用 'white'/'green'/'red' 表示 5z/6z/7z；赤 5 用 `{kind:'5p', red:true}`
 *  - **自带 honba / riichiSticks 计算**，数值已验证正确
 *  - 同样是四人麻将，不支持「包」与双响
 *
 * 注意 honba 语义差异：这里传 0，让外层 honba.ts 统一处理，
 * 避免「引擎算一遍 + 外层再算一遍」的重复计入。
 */
import { createCalculator, API_VERSION } from "@sacckey/mahjong";
import type { Meld, Seat, TileStr } from "./types.ts";
import type {
  EngineResult,
  EngineScore,
  FuItem,
  HandInput,
  Payment,
  YakuEntry,
} from "./types.ts";

type SakTileKind =
  | `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}${"m" | "p" | "s"}`
  | "east"
  | "south"
  | "west"
  | "north"
  | "white"
  | "green"
  | "red";

const HONOR_MAP: Record<string, SakTileKind> = {
  "1z": "east",
  "2z": "south",
  "3z": "west",
  "4z": "north",
  "5z": "white",
  "6z": "green",
  "7z": "red",
};

/** 天凤记法 -> sacckey 的 {kind, red} */
function toSakTile(tile: TileStr): { kind: SakTileKind; red: boolean } {
  const rank = tile[0]!;
  const suit = tile[1]!;
  if (suit === "z") {
    const kind = HONOR_MAP[tile];
    if (!kind) throw new Error(`未知字牌: ${tile}`);
    return { kind, red: false };
  }
  // '0m'/'0p'/'0s' 是赤 5
  if (rank === "0") {
    return { kind: `5${suit}` as SakTileKind, red: true };
  }
  return { kind: tile as SakTileKind, red: false };
}

const MELD_KIND: Record<Meld["type"], "chi" | "pon" | "openKan" | "closedKan" | "addedKan"> = {
  run: "chi",
  triplet: "pon",
  daiminkan: "openKan",
  ankan: "closedKan",
  shouminkan: "addedKan",
};

/** 引擎的 FuReason 是英文标识符，翻成中文给 UI 用 */
const FU_REASON_ZH: Record<string, string> = {
  base: "底符",
  chiitoitsu: "七对子固定",
  menzenRon: "门清荣和",
  tsumo: "自摸",
  closedRon: "门清荣和",
  yakuhaiPair: "役牌雀头",
  doubleWindPair: "连风雀头",
  kanchan: "嵌张听",
  penchan: "边张听",
  tanki: "单骑听",
  "kanchan wait": "嵌张听",
  "penchan wait": "边张听",
  "tanki wait": "单骑听",
  "closed ron": "门清荣和",
  "open triplet of simples": "中张明刻",
  "closed triplet of simples": "中张暗刻",
  "open triplet of terminals/honors": "幺九明刻",
  "closed triplet of terminals/honors": "幺九暗刻",
  "open kan of simples": "中张明杠",
  "closed kan of simples": "中张暗杠",
  "open kan of terminals/honors": "幺九明杠",
  "closed kan of terminals/honors": "幺九暗杠",
};

let calculatorPromise: Promise<Awaited<ReturnType<typeof createCalculator>>> | null = null;

export function getCalculator() {
  // backend: "javascript" —— 完全绕开 Wasm 加载，浏览器与 Node 行为一致
  calculatorPromise ??= createCalculator({ backend: "javascript" });
  return calculatorPromise;
}

export async function scoreWithSacckey(input: HandInput): Promise<EngineResult> {
  const calc = await getCalculator();
  const { context } = input;

  let request;
  try {
    request = {
      apiVersion: API_VERSION,
      hand: {
        // 与 riichi-score 一致：concealedTiles 是**不含和牌张**的 13 张。
        // 引擎会把 concealedTiles 与 winningTile 一起计入总数，
        // 传 14 张会报 invalid_hand_size（details.size = 15）。
        concealedTiles: [...input.concealed].map(toSakTile),
        winningTile: toSakTile(input.winningTile),
        melds: (input.melds ?? []).map((m) => ({
          kind: MELD_KIND[m.type],
          tiles: m.tiles.map(toSakTile),
        })),
        doraIndicators: (context.doraIndicators ?? []).map(toSakTile),
        uraDoraIndicators: (context.uradoraIndicators ?? []).map(toSakTile),
      },
      context: {
        winMethod: context.winType,
        seatWind: context.seatWind,
        roundWind: context.roundWind,
        riichi: context.isDoubleRiichi
          ? ("doubleRiichi" as const)
          : context.isRiichi
            ? ("riichi" as const)
            : ("none" as const),
        ippatsu: context.isIppatsu ?? false,
        rinshan: context.isRinshan ?? false,
        chankan: context.isChankan ?? false,
        haitei: context.isHaitei ?? false,
        houtei: context.isHoutei ?? false,
        tenhou: context.isTenhou ?? false,
        chiihou: context.isChiihou ?? false,
        // 这两个引擎自带，但由外层统一补算，故传 0
        honba: 0,
        riichiSticks: 0,
      },
      rules: "standard" as const,
    };
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "invalid-hand",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  try {
    const r = calc.score(request as never);
    return { ok: true, score: toEngineScore(r) };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = err.code ?? "";
    const message = err.message ?? String(e);
    const kind: "no-yaku" | "invalid-hand" | "invalid-context" | "engine-error" =
      code === "no_yaku"
        ? "no-yaku"
        : code === "invalid_context"
          ? "invalid-context"
          : code.startsWith("invalid")
            ? "invalid-hand"
            : "engine-error";
    return { ok: false, error: { kind, message } };
  }
}

function toEngineScore(r: Record<string, any>): EngineScore {
  const payments: Payment[] = [];
  // 引擎的 payment 是判别联合：ron / dealerTsumo / nonDealerTsumo
  const p = r.payment;
  if (p?.kind === "ron") {
    payments.push({ seat: "west", value: p.discarder });
  } else if (p?.kind === "dealerTsumo") {
    for (const seat of ["south", "west", "north"] as Seat[]) {
      payments.push({ seat, value: p.each });
    }
  } else if (p?.kind === "nonDealerTsumo") {
    payments.push({ seat: "east", value: p.dealer });
    for (const seat of ["west", "north"] as Seat[]) {
      payments.push({ seat, value: p.nonDealerEach });
    }
  }

  const yaku: YakuEntry[] = (r.yaku ?? []).map((y: any) => ({
    name: y.id,
    han: y.han ?? 0,
    ...(y.yakumanMultiplier > 0 ? { limit: "yakuman" } : {}),
  }));

  const fuItems: FuItem[] = (r.fuItems ?? []).map((f: any) => ({
    value: f.value ?? 0,
    reason: FU_REASON_ZH[f.reason] ?? f.reason,
  }));

  return {
    yaku,
    han: r.han,
    fu: r.fu,
    basicPoints: r.basePoints,
    ...(r.limit?.yakumanMultiplier > 0 ? { limit: "yakuman" } : {}),
    fuItems,
    payments,
    totalWinnings: r.winnerGain ?? 0,
    dora: r.bonusHan?.dora ?? 0,
    uradora: r.bonusHan?.uraDora ?? 0,
    akadora: r.bonusHan?.akaDora ?? 0,
  };
}

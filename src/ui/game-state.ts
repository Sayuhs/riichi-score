/**
 * 局面的状态模型：场风、自风、和了方式、宝牌、本场、立直棒、各种役种开关。
 *
 * 这是 M2（手牌录入）与 M1（Scorer）之间的**另一半输入** ——
 * 光有手牌算不出番符，还得知道"这是什么场、谁在和、怎么和的"。
 *
 * 单独一层的原因：局面字段之间有关联约束（比如亲家才有天和、
 * 荣和才有河底、立直必须门清），这些约束校验不该塞进 UI 组件里。
 */
import type { Seat, WinType, RulesetOptions, TileStr } from "../score/types.ts";
import { isValidTile } from "./tiles.ts";

export interface GameState {
  roundWind: Seat;
  seatWind: Seat;
  winType: WinType;
  /** 放铳者，仅荣和需要 */
  from: Seat;
  /** 本场数（积棒） */
  honba: number;
  /** 供托的立直棒根数 */
  riichiSticks: number;

  isRiichi: boolean;
  isDoubleRiichi: boolean;
  isIppatsu: boolean;
  isHaitei: boolean;
  isHoutei: boolean;
  isRinshan: boolean;
  isChankan: boolean;
  isTenhou: boolean;
  isChiihou: boolean;

  doraIndicators: TileStr[];
  uradoraIndicators: TileStr[];

  /** 规则开关（天凤为默认，见 docs/RULES.md） */
  ruleset: RulesetOptions;
}

export const SEAT_LABELS: Record<Seat, string> = {
  east: "东",
  south: "南",
  west: "西",
  north: "北",
};

export const ALL_SEATS: Seat[] = ["east", "south", "west", "north"];

export function createDefaultGameState(): GameState {
  return {
    roundWind: "east",
    seatWind: "south",
    winType: "ron",
    from: "west",
    honba: 0,
    riichiSticks: 0,
    isRiichi: false,
    isDoubleRiichi: false,
    isIppatsu: false,
    isHaitei: false,
    isHoutei: false,
    isRinshan: false,
    isChankan: false,
    isTenhou: false,
    isChiihou: false,
    doraIndicators: [],
    uradoraIndicators: [],
    // 天凤默认值（实测自 riichi-score 的 TENHOU_RULESET，见 docs/RULES.md）
    ruleset: {
      openTanyao: true,
      doubleWindPairFu: 4,
      openPinfuMinimumFu: 30,
      kiriageMangan: false,
      kazoeYakuman: true,
      kansaiChiitoitsu: false,
      doubleYakuman: {
        daisuushii: false,
        kokushi13Wait: false,
        suuankouTanki: false,
        junseiChuuren: false,
      },
      akaDora: { manzu: 1, pinzu: 1, souzu: 1 },
    },
  };
}

/** 自风是否为亲家 */
export function isDealer(state: Pick<GameState, "seatWind">): boolean {
  return state.seatWind === "east";
}

/** 和牌者的下家（决定 chi 只能来自谁） */
export const KAMICHA: Record<Seat, Seat> = {
  east: "north",
  south: "east",
  west: "south",
  north: "west",
};

/**
 * 校验局面字段之间的一致性。
 *
 * 为什么需要：这些组合在真实牌局里不可能出现，但 UI 的勾选框可以随便点。
 * 与其让引擎报一句英文错，不如在界面层就给出中文提示并禁用不可能的选项。
 */
export interface ContextIssue {
  field: string;
  message: string;
}

export function validateGameState(
  state: GameState,
  opts: { isMenzen: boolean; meldCount: number },
): ContextIssue[] {
  const issues: ContextIssue[] = [];

  if (state.winType === "ron" && state.from === state.seatWind) {
    issues.push({ field: "from", message: "荣和时放铳者不能是自己" });
  }

  // 立直必须门清
  if ((state.isRiichi || state.isDoubleRiichi) && !opts.isMenzen) {
    issues.push({ field: "isRiichi", message: "立直必须是门清（不能有副露）" });
  }
  if (state.isIppatsu && !state.isRiichi && !state.isDoubleRiichi) {
    issues.push({ field: "isIppatsu", message: "一发必须建立在立直之上" });
  }
  // 一发会被杠打断
  if (state.isIppatsu && state.isRinshan) {
    issues.push({ field: "isIppatsu", message: "一发不能被岭上开花共存（中间的杠会打断一发）" });
  }
  if (state.isRinshan && state.winType !== "tsumo") {
    issues.push({ field: "isRinshan", message: "岭上开花必须是自摸" });
  }
  if (state.isChankan && state.winType !== "ron") {
    issues.push({ field: "isChankan", message: "抢杠必须是荣和" });
  }
  // 抢杠的牌不是打出的牌，所以不是河底
  if (state.isChankan && state.isHoutei) {
    issues.push({ field: "isHoutei", message: "抢杠的牌不是打出的牌，不能算河底捞鱼" });
  }
  if (state.isHaitei && state.winType !== "tsumo") {
    issues.push({ field: "isHaitei", message: "海底摸月必须是自摸" });
  }
  if (state.isHoutei && state.winType !== "ron") {
    issues.push({ field: "isHoutei", message: "河底捞鱼必须是荣和" });
  }

  // 天和 / 地和
  if (state.isTenhou && state.isChiihou) {
    issues.push({ field: "isTenhou", message: "天和与地和互斥" });
  }
  for (const [flag, name, field] of [
    [state.isTenhou, "天和", "isTenhou"],
    [state.isChiihou, "地和", "isChiihou"],
  ] as const) {
    if (!flag) continue;
    if (state.winType !== "tsumo") issues.push({ field, message: `${name}必须是自摸` });
    if (opts.meldCount > 0) issues.push({ field, message: `${name}不能有副露` });
    if (state.isRiichi || state.isDoubleRiichi || state.isRinshan || state.isHaitei) {
      issues.push({ field, message: `${name}不能与立直 / 岭上 / 海底共存` });
    }
  }
  if (state.isTenhou && state.seatWind !== "east") {
    issues.push({ field: "isTenhou", message: "天和必须是亲家" });
  }
  if (state.isChiihou && state.seatWind === "east") {
    issues.push({ field: "isChiihou", message: "地和必须是闲家" });
  }

  // 双立直和普通立直同时勾选没意义
  if (state.isRiichi && state.isDoubleRiichi) {
    issues.push({ field: "isDoubleRiichi", message: "双立直与立直只能选一个" });
  }

  // 里宝牌只在立直时才有
  if (state.uradoraIndicators.length > 0 && !state.isRiichi && !state.isDoubleRiichi) {
    issues.push({ field: "uradoraIndicators", message: "里宝牌只在立直时翻开" });
  }

  // 宝牌指示牌数量不能超过 5（初始1 + 最多4次杠）
  if (state.doraIndicators.length > 5) {
    issues.push({ field: "doraIndicators", message: "宝牌指示牌最多 5 张" });
  }
  if (state.uradoraIndicators.length > 5) {
    issues.push({ field: "uradoraIndicators", message: "里宝牌指示牌最多 5 张" });
  }

  return issues;
}

/** 宝牌指示牌输入的校验（只检查牌本身合法） */
export function parseIndicatorInput(text: string): { tiles: TileStr[]; error: string | null } {
  const trimmed = text.replace(/[\s,，]/g, "");
  if (!trimmed) return { tiles: [], error: null };

  const tiles: TileStr[] = [];
  let pending: string[] = [];

  for (const ch of trimmed) {
    if (ch >= "0" && ch <= "9") {
      pending.push(ch);
      continue;
    }
    if (!["m", "p", "s", "z"].includes(ch)) {
      return { tiles: [], error: `无法识别的字符 '${ch}'` };
    }
    for (const r of pending) {
      const tile = `${r}${ch}`;
      if (!isValidTile(tile)) return { tiles: [], error: `'${tile}' 不是合法的牌` };
      tiles.push(tile);
    }
    pending = [];
  }
  if (pending.length) return { tiles: [], error: "数字后面缺少花色字母" };
  return { tiles, error: null };
}

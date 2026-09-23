/**
 * 领域类型 —— 与「用哪个引擎」完全无关。
 *
 * UI、状态管理、测试都只依赖这里的类型；引擎的怪癖（张数约定、牌名、
 * 是否自带本场计算）全部被关在 engine-*.ts 适配器里。
 */

/** 天凤记法的牌：'1m' '0p'(赤5) '5z'(白) '6z'(发) '7z'(中) */
export type TileStr = string;

export type Seat = "east" | "south" | "west" | "north";

/** 副露的四种形态，与 riichi-score 的 GroupType 对齐 */
export type MeldType = "run" | "triplet" | "daiminkan" | "shouminkan" | "ankan";

export interface Meld {
  type: MeldType;
  tiles: TileStr[];
  /** 鸣牌来源。荣和/自摸无关，但荣和的 run 必须来自上家 */
  from?: Seat;
  /** tiles 中被鸣的那张的下标（影响横置牌的显示，不影响算分） */
  calledIndex?: number;
}

export type WinType = "ron" | "tsumo";

/** 规则开关。默认值对应天凤（见 docs/RULES.md） */
export interface RulesetOptions {
  /** 食断（开门断幺）是否成立 */
  openTanyao?: boolean;
  /** 连风雀头的符：2 或 4 */
  doubleWindPairFu?: 2 | 4;
  /** 食い平和（无役听牌形）的符底：20 或 30 */
  openPinfuMinimumFu?: 20 | 30;
  /** 切上满贯：4番30符 / 3番60符 提升为满贯 */
  kiriageMangan?: boolean;
  /** 数え役満：13番以上按役满 */
  kazoeYakuman?: boolean;
  /** 关西七对子：允许同种4枚算两对 */
  kansaiChiitoitsu?: boolean;
  /** 双倍役满的四种地方变体 */
  doubleYakuman?: {
    daisuushii?: boolean;
    kokushi13Wait?: boolean;
    suuankouTanki?: boolean;
    junseiChuuren?: boolean;
  };
  /** 赤牌供给量 */
  akaDora?: { manzu?: number; pinzu?: number; souzu?: number };
}

export interface WinContext {
  roundWind: Seat;
  /** 自风。east 即为亲家 */
  seatWind: Seat;
  winType: WinType;
  /** 放铳者，仅荣和需要 */
  from?: Seat;

  isRiichi?: boolean;
  isDoubleRiichi?: boolean;
  isIppatsu?: boolean;
  isHaitei?: boolean;
  isHoutei?: boolean;
  isRinshan?: boolean;
  isChankan?: boolean;
  isTenhou?: boolean;
  isChiihou?: boolean;

  doraIndicators?: TileStr[];
  uradoraIndicators?: TileStr[];

  /** 本场数（积棒数）。库通常不管，由本层的 honba 逻辑计算 */
  honba?: number;
  /** 供托的立直棒根数，每根 1000 点归和牌者 */
  riichiSticks?: number;

  ruleset?: RulesetOptions;
}

/** 引擎的原始输入 */
export interface HandInput {
  /** 手牌（暗牌部分）。**不含和牌张** —— 由适配器按各引擎约定转换 */
  concealed: TileStr[];
  melds?: Meld[];
  /** 和牌张 */
  winningTile: TileStr;
  context: WinContext;
}

export interface YakuEntry {
  name: string;
  han: number;
  limit?: string;
}

export interface FuItem {
  value: number;
  reason: string;
}

export interface Payment {
  seat: Seat;
  value: number;
}

export type ScoreError =
  | { kind: "no-yaku"; message: string }
  | { kind: "invalid-hand"; message: string }
  | { kind: "invalid-context"; message: string }
  | { kind: "engine-error"; message: string };

/** 引擎的裸结果（不含本场/立直棒） */
export interface EngineScore {
  yaku: YakuEntry[];
  han: number;
  fu: number;
  basicPoints: number;
  limit?: string;
  fuItems: FuItem[];
  /** 各引擎自报的支付明细（可能不含本场） */
  payments: Payment[];
  /** 引擎自报的和牌者总收入 */
  totalWinnings: number;
  dora: number;
  uradora: number;
  akadora: number;
}

export type EngineResult =
  | { ok: true; score: EngineScore }
  | { ok: false; error: ScoreError };

/** 最终结果：引擎裸结果 + 本层补上的本场/立直棒 */
export interface ScoreResult {
  yaku: YakuEntry[];
  han: number;
  fu: number;
  basicPoints: number;
  limit?: string;
  fuItems: FuItem[];
  /** 本场带来的额外支付 */
  honbaPayments: Payment[];
  /** 立直棒收入（1000 × 根数） */
  riichiBonus: number;
  /** 不含本场与立直棒的支付 */
  basePayments: Payment[];
  /** 含本场与立直棒的最终支付 */
  finalPayments: Payment[];
  /** 和牌者最终总收入 */
  total: number;
  dora: number;
  uradora: number;
  akadora: number;
  /** 使用了手动覆盖时为 true */
  overridden?: boolean;
}

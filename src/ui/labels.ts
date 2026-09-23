/**
 * 役种 / 符理由 / 点数档次 的中文名映射。
 *
 * 引擎吐的是英文标识符（`pinfu` / `menzen-tsumo` / `yakuhai`...），
 * 而线下算钱时要把役种**念出来给朋友听**，所以必须有中文名。
 *
 * 命名依据：`docs/tenhou-mjlog.md` 里的天凤役种表（含日文原称），
 * 以及中文日麻圈的通行译名。括号里保留日文，方便核对。
 */
import type { Seat } from "../score/types.ts";

/** 役种名 → 中文 */
const YAKU_ZH: Record<string, string> = {
  // ---- 1 番 ----
  riichi: "立直",
  ippatsu: "一发",
  "menzen-tsumo": "门前清自摸和",
  pinfu: "平和",
  tanyao: "断幺九",
  iipeiko: "一盃口",
  "yakuhai-haku": "役牌 白",
  "yakuhai-hatsu": "役牌 发",
  "yakuhai-chun": "役牌 中",
  haku: "役牌 白",
  hatsu: "役牌 发",
  chun: "役牌 中",
  "round-wind": "场风牌",
  "seat-wind": "自风牌",
  yakuhai: "役牌",
  "rinshan-kaihou": "岭上开花",
  chankan: "抢杠",
  haitei: "海底摸月",
  houtei: "河底捞鱼",

  // ---- 2 番 ----
  "double-riichi": "两立直（双立直）",
  chiitoitsu: "七对子",
  chanta: "混全带幺九",
  ittsuu: "一气通贯",
  sanshoku: "三色同顺",
  "sanshoku-doukou": "三色同刻",
  sankantsu: "三杠子",
  toitoi: "对对和",
  sanankou: "三暗刻",
  shousangen: "小三元",
  honroutou: "混老头",

  // ---- 3 番 ----
  ryanpeikou: "二盃口",
  junchan: "纯全带幺九",
  honitsu: "混一色",

  // ---- 6 番 ----
  chinitsu: "清一色",

  // ---- 役满 ----
  kokushi: "国士无双",
  "kokushi-musou": "国士无双",
  suuankou: "四暗刻",
  daisangen: "大三元",
  shousuushii: "小四喜",
  daisuushii: "大四喜",
  tsuuiisou: "字一色",
  chinroutou: "清老头",
  ryuuiisou: "绿一色",
  "chuuren-poutou": "九莲宝灯",
  suukantsu: "四杠子",
  tenhou: "天和",
  chiihou: "地和",

  // ---- 宝牌类（引擎可能用别的字段报，这里兜底） ----
  dora: "宝牌",
  uradora: "里宝牌",
  akadora: "赤宝牌",
};

/** 取役种中文名。查不到时原样返回，不隐藏信息 */
export function yakuLabel(name: string): string {
  return YAKU_ZH[name] ?? name;
}

/** 符的理由 → 中文 */
const FU_REASON_ZH: Record<string, string> = {
  base: "底符",
  chiitoitsu: "七对子固定",
  tsumo: "自摸",
  "closed ron": "门清荣和",
  closedRon: "门清荣和",
  menzenRon: "门清荣和",
  yakuhaiPair: "役牌雀头",
  doubleWindPair: "连风雀头",
  "open triplet of simples": "中张明刻",
  "closed triplet of simples": "中张暗刻",
  "open triplet of terminals/honors": "幺九明刻",
  "closed triplet of terminals/honors": "幺九暗刻",
  "open kan of simples": "中张明杠",
  "closed kan of simples": "中张暗杠",
  "open kan of terminals/honors": "幺九明杠",
  "closed kan of terminals/honors": "幺九暗杠",
  kanchan: "嵌张听",
  penchan: "边张听",
  tanki: "单骑听",
  "kanchan wait": "嵌张听",
  "penchan wait": "边张听",
  "tanki wait": "单骑听",
};

export function fuReasonLabel(reason: string): string {
  return FU_REASON_ZH[reason] ?? reason;
}

/** 点数档次 → 中文 */
const LIMIT_ZH: Record<string, string> = {
  mangan: "满贯",
  haneman: "跳满",
  baiman: "倍满",
  sanbaiman: "三倍满",
  yakuman: "役满",
  "double-yakuman": "双倍役满",
  "triple-yakuman": "三倍役满",
  "quadruple-yakuman": "四倍役满",
  belowMangan: "满贯未满",
};

export function limitLabel(limit: string | undefined): string {
  if (!limit) return "";
  return LIMIT_ZH[limit] ?? limit;
}

/** 座位 → 中文（用于支付明细） */
const SEAT_ZH: Record<Seat, string> = {
  east: "东家",
  south: "南家",
  west: "西家",
  north: "北家",
};

export function seatLabel(seat: Seat): string {
  return SEAT_ZH[seat] ?? seat;
}

/**
 * 根据番数和基本点推算点数档次的显示名。
 *
 * 引擎在 `limit` 字段里已经给了档次，但有时缺省（比如 4番30符 就是满贯未满）。
 * 这里做一层兜底，保证界面上永远有个可读的档次。
 */
export function tierLabel(han: number, fu: number, limit?: string): string {
  if (limit) return limitLabel(limit);
  if (han >= 13) return "数え役满";
  if (han >= 11) return "三倍满";
  if (han >= 8) return "倍满";
  if (han >= 6) return "跳满";
  if (han >= 5) return "满贯";
  // 4番40符以上 / 3番70符以上 也是满贯
  if (han === 4 && fu >= 40) return "满贯";
  if (han === 3 && fu >= 70) return "满贯";
  return "";
}

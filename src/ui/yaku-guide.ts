/**
 * 役种速查数据 —— 供「役种提示」弹窗使用。
 *
 * ## 数据来源
 *
 * 番数**严格取自 `docs/tenhou-mjlog.md`**（从 `ext/mahjong-cpp` 抄录的天凤牌谱格式文档），
 * 那是天凤官方的役种定义。门清番与副露番分列，`null` 表示副露后不成立 ——
 * 这一点很关键，因为「为什么我这手没役」最常见的答案就是
 * 「你副露了，那个役门清才有」。
 *
 * ## 为什么要有「怎么认」这一列
 *
 * 用户要的是**提示**，不是规则文档。所以每个役都配一句
 * 「怎么看出来的」——线下一手牌摆在面前时，需要的是能立刻对照的判据。
 */
import type { Seat } from "../score/types.ts";

export interface YakuInfo {
  /** 与引擎输出一致的名字（用于和实际结果对照） */
  engineNames: string[];
  /** 中文名 */
  name: string;
  /** 日文名（方便和对局界面核对） */
  ja: string;
  /** 门清时的番数；null 表示副露后不成立 */
  closedHan: number | null;
  /** 副露时的番数；null 表示不成立 */
  openHan: number | null;
  /** 怎么认——一句话判据 */
  how: string;
  /**
   * 示例牌型（可渲染成麻将图）。
   *
   * ⚠️ 这些牌型**由测试用引擎验证过**（见 __tests__/yaku-guide.test.ts 的【8】），
   *    确认：① 是合法的和牌形 ② 确实成立该役。
   *    手写牌型极易出错 —— 我自己就栽过四次（顺手凑出三色、一气等）。
   *
   * 张数约定与 Scorer 一致：
   *   concealed（门前）张数 + melds 组数 × 3 + 1（和牌张） = 14
   *   即无副露时门前 13 张，一组副露时门前 10 张。
   */
  exampleTiles?: {
    /** 门前牌，**不含和牌张** */
    concealed: string[];
    /** 和牌张 */
    winning: string;
    /** 副露组（每组 3 或 4 张）。有副露时 concealed 会相应变少 */
    melds?: { tiles: string[]; kind?: "run" | "triplet" | "ankan" | "daiminkan" }[];
  };
  /** 一句话补充说明（如「其中一组是碰出来的」） */
  exampleNote?: string;
  /** 分类 */
  group: "1番" | "2番" | "3番" | "6番" | "役满";
}

/**
 * 常用役速查表。
 *
 * 按「线下最常撞上」的顺序排，而不是按番数 —— 用户点开这个弹窗
 * 通常是因为「这手到底有没有役」，所以先给最常见的。
 */
export const YAKU_LIST: YakuInfo[] = [
  // ==================== 1 番 ====================
  {
    engineNames: ["riichi"],
    name: "立直",
    ja: "リーチ",
    closedHan: 1,
    openHan: null,
    how: "门清听牌时宣言，并供出 1000 点",
    exampleTiles: {
      concealed: ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"],
      winning: "5m",
    },
    exampleNote: "门清听 3m/6m，宣言立直",
    group: "1番",
  },
  {
    engineNames: ["menzen-tsumo", "menzenTsumo"],
    name: "门前清自摸和",
    ja: "門前清自摸和",
    closedHan: 1,
    openHan: null,
    how: "门清（无副露）状态下自己摸到和牌张",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "没有副露，自己摸到 6m",
    group: "1番",
  },
  {
    engineNames: ["tanyao"],
    name: "断幺九",
    ja: "断幺九",
    closedHan: 1,
    openHan: 1,
    how: "整手牌只有 2~8，没有 1、9 和字牌",
    exampleTiles: {
      concealed: ["2m","3m","4m","5m","6m","7m","2p","3p","4p","5s","6s","7s","8s"],
      winning: "8s",
    },
    exampleNote: "全是 2~8，副露也成立（食断）",
    group: "1番",
  },
  {
    engineNames: ["pinfu"],
    name: "平和",
    ja: "平和",
    closedHan: 1,
    openHan: null,
    how: "门清 + 四组顺子 + 非役牌雀头 + 两面听",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "雀头是西（非役牌），两面听 3m/6m",
    group: "1番",
  },
  {
    engineNames: ["haku", "yakuhai-haku"],
    name: "役牌 白",
    ja: "役牌 白",
    closedHan: 1,
    openHan: 1,
    how: "有「白」的刻子或杠（碰出来也算）",
    exampleTiles: {
      concealed: ["5z","5z","5z","1m","2m","3m","4p","5p","6p","7s","8s","9s","2z"],
      winning: "2z",
    },
    exampleNote: "白的刻子就是役，副露也成立",
    group: "1番",
  },
  {
    engineNames: ["hatsu", "yakuhai-hatsu"],
    name: "役牌 发",
    ja: "役牌 發",
    closedHan: 1,
    openHan: 1,
    how: "有「发」的刻子或杠（碰出来也算）",
    exampleTiles: {
      concealed: ["6z","6z","6z","1m","2m","3m","4p","5p","6p","7s","8s","9s","2z"],
      winning: "2z",
    },
    exampleNote: "发的刻子就是役",
    group: "1番",
  },
  {
    engineNames: ["chun", "yakuhai-chun"],
    name: "役牌 中",
    ja: "役牌 中",
    closedHan: 1,
    openHan: 1,
    how: "有「中」的刻子或杠（碰出来也算）",
    exampleTiles: {
      concealed: ["7z","7z","7z","1m","2m","3m","4p","5p","6p","7s","8s","9s","2z"],
      winning: "2z",
    },
    exampleNote: "中的刻子就是役",
    group: "1番",
  },
  {
    engineNames: ["round-wind"],
    name: "场风牌",
    ja: "場風牌",
    closedHan: 1,
    openHan: 1,
    how: "有当前场风（东场就是东）的刻子或杠",
    exampleTiles: {
      concealed: ["1z","1z","1z","2m","3m","4m","4p","5p","6p","7s","8s","9s","2z"],
      winning: "2z",
    },
    exampleNote: "东场的东刻子算 1 番",
    group: "1番",
  },
  {
    engineNames: ["seat-wind"],
    name: "自风牌",
    ja: "自風牌",
    closedHan: 1,
    openHan: 1,
    how: "有自己座位风向的刻子或杠（连风算 2 番）",
    exampleTiles: {
      concealed: ["2z","2z","2z","2m","3m","4m","4p","5p","6p","7s","8s","9s","1z"],
      winning: "1z",
    },
    exampleNote: "南家的南刻子算 1 番；若同时是场风则算 2 番",
    group: "1番",
  },
  {
    engineNames: ["iipeiko"],
    name: "一盃口",
    ja: "一盃口",
    closedHan: 1,
    openHan: null,
    how: "门清，有两组完全相同的顺子",
    exampleTiles: {
      concealed: ["1m","1m","2m","2m","3m","3m","4p","5p","6p","7s","8s","9s","5z"],
      winning: "5z",
    },
    exampleNote: "123m 出现了两次",
    group: "1番",
  },
  {
    engineNames: ["ippatsu"],
    name: "一发",
    ja: "一発",
    closedHan: 1,
    openHan: null,
    how: "立直后一巡之内和牌，中间没人鸣牌",
    exampleTiles: {
      concealed: ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"],
      winning: "5m",
    },
    exampleNote: "与立直同一手牌，只是赶在一巡内和了",
    group: "1番",
  },
  {
    engineNames: ["haitei"],
    name: "海底摸月",
    ja: "海底摸月",
    closedHan: 1,
    openHan: 1,
    how: "摸最后一张牌自摸和",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "牌形任意，关键是摸的是最后一张",
    group: "1番",
  },
  {
    engineNames: ["houtei"],
    name: "河底捞鱼",
    ja: "河底撈魚",
    closedHan: 1,
    openHan: 1,
    how: "荣和最后一张打出的牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "牌形任意，关键是荣和最后一张",
    group: "1番",
  },
  {
    engineNames: ["rinshan-kaihou"],
    name: "岭上开花",
    ja: "嶺上開花",
    closedHan: 1,
    openHan: 1,
    how: "杠之后从岭上摸到和牌张",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "要有杠，且和的是杠后摸的那张",
    group: "1番",
  },
  {
    engineNames: ["chankan"],
    name: "抢杠",
    ja: "槍槓",
    closedHan: 1,
    openHan: 1,
    how: "别人加杠时，荣和那张牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "别人加杠的那张恰好是你和的牌",
    group: "1番",
  },

  // ==================== 2 番 ====================
  {
    engineNames: ["double-riichi"],
    name: "两立直",
    ja: "ダブル立直",
    closedHan: 2,
    openHan: null,
    how: "第一巡、无人鸣牌时立直",
    exampleTiles: {
      concealed: ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"],
      winning: "5m",
    },
    exampleNote: "与立直同形，区别是「第一巡就宣言」",
    group: "2番",
  },
  {
    engineNames: ["chiitoitsu"],
    name: "七对子",
    ja: "七対子",
    closedHan: 2,
    openHan: null,
    how: "门清，七组不同的对子（不能有副露）",
    exampleTiles: {
      concealed: ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z"],
      winning: "7z",
    },
    exampleNote: "七组对子要各不相同（同种 4 张不能算两对）",
    group: "2番",
  },
  {
    engineNames: ["sanshoku", "sanshoku-doujun"],
    name: "三色同顺",
    ja: "三色同順",
    closedHan: 2,
    openHan: 1,
    how: "万筒索各有一组数字相同的顺子",
    exampleTiles: {
      concealed: ["2m","3m","4m","2p","3p","4p","2s","3s","4s","7m","7m","9m","9m"],
      winning: "7m",
    },
    exampleNote: "234m + 234p + 234s",
    group: "2番",
  },
  {
    engineNames: ["ittsuu"],
    name: "一气通贯",
    ja: "一気通貫",
    closedHan: 2,
    openHan: 1,
    how: "同一花色里有 123 + 456 + 789",
    exampleTiles: {
      concealed: ["1m","2m","3m","4m","5m","6m","7m","8m","9m","5z","5z","1p","1p"],
      winning: "1p",
    },
    exampleNote: "万子的 123 + 456 + 789",
    group: "2番",
  },
  {
    engineNames: ["chanta"],
    name: "混全带幺九",
    ja: "混全帯幺九",
    closedHan: 2,
    openHan: 1,
    how: "每组面子都含 1/9/字牌，且有字牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","5z","5z"],
      winning: "9s",
    },
    exampleNote: "每组都带幺九，且含字牌（这里是白）",
    group: "2番",
  },
  {
    engineNames: ["toitoi"],
    name: "对对和",
    ja: "対々和",
    closedHan: 2,
    openHan: 2,
    how: "四组面子全是刻子或杠（没有顺子）",
    exampleTiles: {
      concealed: ["5p","5p","5p","7s","7s","7s","9m","9m","9m","3z"],
      winning: "3z",
      melds: [{ tiles: ["1m","1m","1m"], kind: "triplet" }],
    },
    exampleNote: "111m 是碰出来的，其余三组是暗刻",
    group: "2番",
  },
  {
    engineNames: ["sanankou"],
    name: "三暗刻",
    ja: "三暗刻",
    closedHan: 2,
    openHan: 2,
    how: "有三组暗刻（自己摸成的刻子，没碰）",
    exampleTiles: {
      concealed: ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z"],
      winning: "3z",
      melds: [{ tiles: ["2m","2m","2m"], kind: "triplet" }],
    },
    exampleNote: "222m 是碰的（明刻），其余三组是暗刻",
    group: "2番",
  },
  {
    engineNames: ["shousangen"],
    name: "小三元",
    ja: "小三元",
    closedHan: 2,
    openHan: 2,
    how: "白/发/中里有两组刻子 + 一组对子",
    exampleTiles: {
      concealed: ["5z","5z","5z","6z","6z","6z","7z","7z","1m","2m","3m","4p","4p"],
      winning: "4p",
    },
    exampleNote: "白和发是刻子，中是雀头",
    group: "2番",
  },
  {
    engineNames: ["honroutou"],
    name: "混老头",
    ja: "混老頭",
    closedHan: 2,
    openHan: 2,
    how: "整手牌只有 1/9/字牌（必然是对对和或七对子）",
    exampleTiles: {
      concealed: ["1m","1m","1m","9m","9m","9m","1p","1p","1p","9s"],
      winning: "9s",
      melds: [{ tiles: ["1z","1z","1z"], kind: "triplet" }],
    },
    exampleNote: "只有 1/9/字牌；111z 是碰的",
    group: "2番",
  },
  {
    engineNames: ["sankantsu"],
    name: "三杠子",
    ja: "三槓子",
    closedHan: 2,
    openHan: 2,
    how: "有三个杠子",
    exampleTiles: {
      concealed: ["3z"],
      winning: "3z",
      melds: [
        { tiles: ["1m","1m","1m","1m"], kind: "ankan" },
        { tiles: ["5p","5p","5p","5p"], kind: "ankan" },
        { tiles: ["7z","7z","7z","7z"], kind: "ankan" },
        { tiles: ["9s","9s","9s"], kind: "triplet" },
      ],
    },
    exampleNote:
      "三个暗杠 + 碰出来的 999s + 3z 雀头。最后那组必须是**明刻** —— 若也摸成暗刻就成四暗刻了",
    group: "2番",
  },
  {
    engineNames: ["sanshoku-doukou"],
    name: "三色同刻",
    ja: "三色同刻",
    closedHan: 2,
    openHan: 2,
    how: "万筒索各有一组数字相同的刻子",
    exampleTiles: {
      concealed: ["2p","2p","2p","2s","2s","2s","5z","5z","5z","7z"],
      winning: "7z",
      melds: [{ tiles: ["2m","2m","2m"], kind: "triplet" }],
    },
    exampleNote: "222m 是碰的；三色同刻要**数字相同**：222m + 222p + 222s",
    group: "2番",
  },

  // ==================== 3 番 ====================
  {
    engineNames: ["ryanpeikou"],
    name: "二盃口",
    ja: "二盃口",
    closedHan: 3,
    openHan: null,
    how: "门清，有两组「两组相同顺子」",
    exampleTiles: {
      concealed: ["1m","1m","2m","2m","3m","3m","4p","4p","5p","5p","6p","6p","5z"],
      winning: "5z",
    },
    exampleNote: "123m 两组 + 456p 两组",
    group: "3番",
  },
  {
    engineNames: ["junchan"],
    name: "纯全带幺九",
    ja: "純全帯幺九",
    closedHan: 3,
    openHan: 2,
    how: "每组面子都含 1 或 9，且没有字牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","1p","1p"],
      winning: "1p",
    },
    exampleNote: "每组都带 1/9，且完全没有字牌",
    group: "3番",
  },
  {
    engineNames: ["honitsu"],
    name: "混一色",
    ja: "混一色",
    closedHan: 3,
    openHan: 2,
    how: "只有一种花色 + 字牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1m","1m","5z","5z"],
      winning: "5z",
    },
    exampleNote: "只有万子 + 字牌",
    group: "3番",
  },

  // ==================== 6 番 ====================
  {
    engineNames: ["chinitsu"],
    name: "清一色",
    ja: "清一色",
    closedHan: 6,
    openHan: 5,
    how: "整手牌只有一种花色，没有字牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","1m","2m","3m","4m","5m","6m","7m","8m","9m","9m"],
      winning: "9m",
    },
    exampleNote: "只有万子，一个字的牌都没有",
    group: "6番",
  },

  // ==================== 役满 ====================
  {
    engineNames: ["kokushi-musou", "kokushi", "kokushiMusou"],
    name: "国士无双",
    ja: "国士無双",
    closedHan: null,
    openHan: null,
    how: "13 种幺九牌各一张 + 其中一种再来一张",
    exampleTiles: {
      concealed: ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"],
      winning: "1m",
    },
    exampleNote: "13 种幺九牌齐全，再来一张 1m",
    group: "役满",
  },
  {
    engineNames: ["suuankou"],
    name: "四暗刻",
    ja: "四暗刻",
    closedHan: null,
    openHan: null,
    how: "四组面子全是暗刻（不能碰，只能自摸刻子）",
    exampleTiles: {
      concealed: ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9m"],
      winning: "9m",
    },
    exampleNote: "四组暗刻 + 单骑 9m（注意：不能有任何碰）",
    group: "役满",
  },
  {
    engineNames: ["daisangen"],
    name: "大三元",
    ja: "大三元",
    closedHan: null,
    openHan: null,
    how: "白/发/中都是刻子",
    exampleTiles: {
      concealed: ["5z","5z","5z","6z","6z","6z","7z","7z","7z","1m","2m","3m","4p"],
      winning: "4p",
    },
    exampleNote: "白、发、中三组刻子",
    group: "役满",
  },
  {
    engineNames: ["daisuushii"],
    name: "大四喜",
    ja: "大四喜",
    closedHan: null,
    openHan: null,
    how: "东南西北都是刻子",
    exampleTiles: {
      concealed: ["1z","1z","1z","2z","2z","2z","3z","3z","3z","4z","4z","4z","1m"],
      winning: "1m",
    },
    exampleNote: "东南西北全是刻子",
    group: "役满",
  },
  {
    engineNames: ["shousuushii"],
    name: "小四喜",
    ja: "小四喜",
    closedHan: null,
    openHan: null,
    how: "东南西北里有三组刻子 + 一组对子",
    exampleTiles: {
      concealed: ["1z","1z","1z","2z","2z","2z","3z","3z","3z","4z","4z","1m","2m"],
      winning: "3m",
    },
    exampleNote: "东南西是刻子，北是雀头",
    group: "役满",
  },
  {
    engineNames: ["tsuuiisou"],
    name: "字一色",
    ja: "字一色",
    closedHan: null,
    openHan: null,
    how: "整手牌只有字牌",
    exampleTiles: {
      concealed: ["1z","1z","1z","2z","2z","2z","5z","5z","5z","6z","6z","6z","7z"],
      winning: "7z",
    },
    exampleNote: "一个数牌都没有",
    group: "役满",
  },
  {
    engineNames: ["chinroutou"],
    name: "清老头",
    ja: "清老頭",
    closedHan: null,
    openHan: null,
    how: "整手牌只有 1 和 9",
    exampleTiles: {
      concealed: ["1m","1m","1m","9m","9m","9m","1p","1p","1p","9p"],
      winning: "9p",
      melds: [{ tiles: ["9s","9s","9s"], kind: "triplet" }],
    },
    exampleNote: "只有 1 和 9，连字牌都没有（999s 是碰的）",
    group: "役满",
  },
  {
    engineNames: ["ryuuiisou"],
    name: "绿一色",
    ja: "緑一色",
    closedHan: null,
    openHan: null,
    how: "整手牌只有 2/3/4/6/8 索和「发」",
    exampleTiles: {
      concealed: ["2s","2s","2s","3s","3s","3s","4s","4s","4s","6s","6s","6s","8s"],
      winning: "8s",
    },
    exampleNote: "只有绿色的索子（23468索）与「发」",
    group: "役满",
  },
  {
    engineNames: ["chuuren-poutou"],
    name: "九莲宝灯",
    ja: "九蓮宝燈",
    closedHan: null,
    openHan: null,
    how: "门清清一色，形如 1112345678999 + 同花色任一张",
    exampleTiles: {
      concealed: ["1m","1m","1m","2m","3m","4m","5m","6m","7m","8m","9m","9m","9m"],
      winning: "5m",
    },
    exampleNote: "1112345678999m 的形，听同花色任意一张",
    group: "役满",
  },
  {
    engineNames: ["suukantsu"],
    name: "四杠子",
    ja: "四槓子",
    closedHan: null,
    openHan: null,
    how: "有四个杠子",
    exampleTiles: {
      concealed: ["3z"],
      winning: "3z",
      melds: [
        { tiles: ["1m","1m","1m","1m"], kind: "ankan" },
        { tiles: ["5p","5p","5p","5p"], kind: "ankan" },
        { tiles: ["9s","9s","9s","9s"], kind: "ankan" },
        { tiles: ["7z","7z","7z","7z"], kind: "ankan" },
      ],
    },
    exampleNote: "四个杠 + 3z 单骑（雀头就靠和牌张凑）",
    group: "役满",
  },
  {
    engineNames: ["tenhou"],
    name: "天和",
    ja: "天和",
    closedHan: null,
    openHan: null,
    how: "亲家配牌即和（自己摸第一张就成和牌形）",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "牌形任意，关键是亲家开局第一张就自摸和",
    group: "役满",
  },
  {
    engineNames: ["chiihou"],
    name: "地和",
    ja: "地和",
    closedHan: null,
    openHan: null,
    how: "闲家第一巡自摸和，且中间无人鸣牌",
    exampleTiles: {
      concealed: ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"],
      winning: "6m",
    },
    exampleNote: "牌形任意，关键是闲家第一巡自摸和",
    group: "役满",
  },
];

/** 按分组取出役种，供弹窗分节显示 */
export const YAKU_GROUPS = ["1番", "2番", "3番", "6番", "役满"] as const;

export function yakuByGroup(group: string): YakuInfo[] {
  return YAKU_LIST.filter((y) => y.group === group);
}

/**
 * 无役时最该检查的几条 —— 放在弹窗最前面。
 *
 * 这些是「为什么没役」的高频答案，按实际撞上的频率排。
 */
export const NO_YAKU_HINTS: { title: string; body: string }[] = [
  {
    title: "先看有没有副露",
    body: "副露（吃/碰/杠）之后，平和、一盃口、七对子、立直都不成立。这是最常见的原因。",
  },
  {
    title: "门清的话，立直几乎必有役",
    body: "门清听牌就宣言立直，是最省事的凑役方式。别忘了在现场勾上「立直」。",
  },
  {
    title: "断幺九最容易凑",
    body: "只要全是 2~8 就有断幺，副露也成立。手里有字牌或 1/9 就不行。",
  },
  {
    title: "字牌刻子是保底",
    body: "白发中任意一组刻子、或者当前场风/自风刻子，都各算 1 番，副露也成立。",
  },
  {
    title: "宝牌不算役！",
    body: "日麻规则下，光有宝牌不能和牌，必须先有个役。这是新手最常踩的坑。",
  },
];

/** 自风/场风的说明文字（弹窗里动态显示） */
export function windHint(roundWind: Seat, seatWind: Seat, isDealer: boolean): string {
  const names: Record<Seat, string> = { east: "东", south: "南", west: "西", north: "北" };
  const r = names[roundWind];
  const s = names[seatWind];
  if (roundWind === seatWind) {
    return `本局是${r}场、你是${s}家（${isDealer ? "亲家" : "闲家"}）。勾了「场风牌」和「自风牌」时，${r} 的刻子是连风，算 2 番。`;
  }
  return `本局是${r}场、你是${s}家（${isDealer ? "亲家" : "闲家"}）。${r} 刻子算场风牌 1 番，${s} 刻子算自风牌 1 番。`;
}

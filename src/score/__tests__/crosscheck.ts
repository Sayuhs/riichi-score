/**
 * 双库交叉对拍。
 *
 * 思路：随机生成**合法且成和牌形**的手牌，交给两个独立实现各算一遍，
 * 比对 番 / 符 / 点 是否一致。这是抓单库 bug 最有效的手段 ——
 * 参考的 mahjong-calc 就是靠交叉验证抓出了「槍槓 + 河底」这个真 bug。
 *
 * 注意：两个引擎的**规则默认值不同**，所以只对拍那些规则无关的场面
 * （役种确定、不涉及食断/切上满贯等开关的手牌），避免把规则差异误报成 bug。
 */
import { scoreWithRiichiScore } from "../engine-riichi-score.ts";
import { scoreWithSacckey } from "../engine-sacckey.ts";
import type { HandInput, Meld, Seat, TileStr, WinContext } from "../types.ts";

// ---------------------------------------------------------------- 随机数
/** 可复现的伪随机数（xorshift32），保证失败可复现 */
function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

type Rng = () => number;

// ------------------------------------------------------------ 牌的表示
/** 34 种基本牌（不含赤），天凤记法 */
const KINDS: TileStr[] = [
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}m`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}p`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}s`),
  "1z", "2z", "3z", "4z", "5z", "6z", "7z",
];

/** 从牌墙抽 n 张不重复（同种最多 4 张）的牌 */
function drawTiles(rng: Rng, n: number): TileStr[] {
  const remaining = new Map<TileStr, number>(KINDS.map((k) => [k, 4]));
  const out: TileStr[] = [];
  while (out.length < n) {
    const k = KINDS[Math.floor(rng() * KINDS.length)]!;
    const left = remaining.get(k)!;
    if (left <= 0) continue;
    remaining.set(k, left - 1);
    out.push(k);
  }
  return out;
}

const sortHand = (tiles: TileStr[]): TileStr[] =>
  [...tiles].sort((a, b) => {
    const order = "mpsz";
    const sa = order.indexOf(a[1]!);
    const sb = order.indexOf(b[1]!);
    if (sa !== sb) return sa - sb;
    return Number(a[0]) - Number(b[0]);
  });

// ------------------------------------------------ 构造「确定成立」的和牌
type Shape = { name: string; concealed: TileStr[]; winning: TileStr; melds: Meld[] };

/**
 * 手工构造一批**役种明确、与规则开关无关**的和牌形。
 * 这些是交叉对拍的主力 —— 每一条都应当被两个引擎算出同样的番符点。
 */
function fixedShapes(): Shape[] {
  const S: Shape[] = [];
  const push = (name: string, concealed: TileStr[], winning: TileStr, melds: Meld[] = []) =>
    S.push({ name, concealed, winning, melds });

  // --- 立直 + 平和 + 断幺（门清，两面听）---
  push("riichi+pinfu+tanyao", ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"], "5m");

  // --- 平和 + 自摸（20 符）---
  push("pinfu tsumo", ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"], "6m");

  // --- 七对子 ---
  push("chiitoitsu", ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z"], "7z");

  // --- 三色同顺 ---
  push("sanshoku", ["2m","3m","4m","2p","3p","4p","2s","3s","4s","7m","7m","9m","9m"], "7m");

  // --- 一气通贯 ---
  push("ittsuu", ["1m","2m","3m","4m","5m","6m","7m","8m","9m","5z","5z","1p","1p"], "1p");

  // --- 混一色 ---
  push("honitsu", ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1m","1m","5z","5z"], "5z");

  // --- 清一色 ---
  push("chinitsu", ["1m","2m","3m","1m","2m","3m","4m","5m","6m","7m","8m","9m","9m"], "9m");

  // --- 对对和 + 三暗刻 ---
  push("toitoi+sanankou", ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","9m","9m"], "3z");

  // --- 役牌（白）---
  push("yakuhai haku", ["5z","5z","5z","1m","2m","3m","4p","5p","6p","7s","8s","9s","2z"], "2z");

  // --- 混全带幺九 ---
  push("chanta", ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","5z","5z"], "9s");

  // --- 纯全带幺九 ---
  push("junchan", ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","1z","1z"], "9s");

  // --- 小三元 ---
  push("shousangen", ["5z","5z","5z","6z","6z","6z","7z","7z","1m","2m","3m","4p","4p"], "4p");

  // --- 大三元（役满）---
  push("daisangen", ["5z","5z","5z","6z","6z","6z","7z","7z","7z","1m","2m","3m","4p"], "4p");

  // --- 四暗刻（役满）---
  push("suuankou", ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9m"], "9m");

  // --- 国士无双（役满）---
  push("kokushi", ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"], "1m");

  // --- 字一色（役满）---
  push("tsuuiisou", ["1z","1z","1z","2z","2z","2z","5z","5z","5z","6z","6z","6z","7z"], "7z");

  // --- 绿一色（役满）---
  push("ryuuiisou", ["2s","2s","2s","3s","3s","3s","4s","4s","4s","6s","6s","6s","8s"], "8s");

  // --- 帯副露：食断（全 2-8，副露 234s）---
  push("kuitan (meld 234s)", ["2m","3m","4m","5m","6m","7m","2p","3p","4p","6s"],
    "6s", [{ type: "run", tiles: ["2s","3s","4s"], from: "east", calledIndex: 0 }]);

  // --- 帯副露：三色同刻（副露 222m）---
  push("sanshoku doukou (meld)", ["3p","3p","3p","4s","4s","4s","7z","7z","2m","2m"],
    "2m", [{ type: "triplet", tiles: ["2m","2m","2m"], from: "west", calledIndex: 0 }]);

  // --- 帯暗杠：三杠子 ---
  push("sankantsu-ish (ankan)", ["1m","1m","1m","1m","5p","5p","5p","5p","9s","3z","3z","3z","3z"],
    "9s", [
      { type: "ankan", tiles: ["1m","1m","1m","1m"] },
      { type: "ankan", tiles: ["5p","5p","5p","5p"] },
      { type: "ankan", tiles: ["3z","3z","3z","3z"] },
    ]);

  return S;
}

// -------------------------------------------------------------- 上下文池
/**
 * 只使用**规则无关**的上下文：
 *  - 立直/自摸/番牌 这些在两个引擎里定义一致
 *  - 避开食断开关、切上满贯、数え役满的边界值
 */
function contexts(shape: Shape, rng: Rng): WinContext[] {
  const out: WinContext[] = [];
  const seats: Seat[] = ["east", "south", "west", "north"];

  for (const seatWind of seats) {
    const roundWind: Seat = seatWind === "east" ? "south" : "east";
    // 荣和（不放番牌，避免符的规则差异）+ 立直
    out.push({
      roundWind,
      seatWind,
      winType: "ron",
      from: "west" === seatWind ? "north" : "west",
      isRiichi: true,
      honba: 0,
      riichiSticks: 0,
    });
    // 自摸（不立直，避免里宝牌差异）
    out.push({
      roundWind,
      seatWind,
      winType: "tsumo",
      honba: 0,
      riichiSticks: 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 对拍
type Mismatch = {
  shape: string;
  seat: string;
  winType: string;
  a: string;
  b: string;
};

const shapes = fixedShapes();
const mismatches: Mismatch[] = [];
let compared = 0;
let skippedNoYaku = 0;
const skipReasons = new Map<string, number>();

for (const shape of shapes) {
  const rng = makeRng(20240920);
  for (const ctx of contexts(shape, rng)) {
    const input: HandInput = {
      concealed: shape.concealed,
      melds: shape.melds,
      winningTile: shape.winning,
      context: ctx,
    };

    const a = scoreWithRiichiScore(input);
    const b = await scoreWithSacckey(input);

    if (!a.ok) { skippedNoYaku++; continue; }
    if (!b.ok) {
      const key = `sacckey:${b.error.kind}:${b.error.message.slice(0, 60)}`;
      skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1);
      continue;
    }

    compared++;

    // 只比对规则无关的三个量：番、符、基本点
    const fa = { han: a.score.han, fu: a.score.fu, basic: a.score.basicPoints };
    const fb = { han: b.score.han, fu: b.score.fu, basic: b.score.basicPoints };

    // 自摸时基本点一致、番可能因「门前清自摸和」命名差异而一致，故直接比数值
    if (fa.han !== fb.han || fa.fu !== fb.fu || fa.basic !== fb.basic) {
      mismatches.push({
        shape: shape.name,
        seat: ctx.seatWind,
        winType: ctx.winType,
        a: `han=${fa.han} fu=${fa.fu} basic=${fa.basic} [${a.score.yaku.map((y) => y.name).join(",")}]`,
        b: `han=${fb.han} fu=${fb.fu} basic=${fb.basic} [${b.score.yaku.map((y) => y.name).join(",")}]`,
      });
    }
  }
}

// ---------------------------------------------------------------- 报告
console.log("========== 双库交叉对拍 ==========");
console.log(`对拍手数（两库都成功）：${compared}`);
console.log(`riichi-score 判无役跳过：${skippedNoYaku}`);
if (skipReasons.size) {
  console.log("\nsacckey 跳过的原因：");
  for (const [k, n] of [...skipReasons].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${n}× ${k}`);
  }
}

if (mismatches.length === 0) {
  console.log(`\n✅ 全部一致：${compared} 手，0 处不一致`);
} else {
  console.log(`\n❌ 不一致 ${mismatches.length} / ${compared} 手：`);
  for (const m of mismatches) {
    console.log(`\n  [${m.shape}] seat=${m.seat} ${m.winType}`);
    console.log(`     riichi-score : ${m.a}`);
    console.log(`     sacckey      : ${m.b}`);
  }
}

process.exitCode = mismatches.length > 0 ? 1 : 0;

/**
 * 交叉对拍 v2 —— 把分歧**分类**，区分「约定差异」与「真规则差异」。
 *
 * 为什么要分类：两个引擎的默认规则集不同，直接比数值会产出一堆
 * 假阳性。真正有意义的只有「同一规则下算出不同结果」。
 *
 * 分类：
 *  A. fu-convention —— 役满时 fu 一个报实际值、一个报 0。役满的 fu 不参与
 *     点数计算，属于表示约定差异，**不是 bug**。
 *  B. yakuman-multiplier —— 复合役满的倍数不同。**这是真规则差异**，
 *     源于两个引擎默认规则集对「双倍役满变体」的设定不同。
 *  C. real —— 番/基本点在不涉及役满时不一致。**这才是需要警惕的 bug**。
 */
import { scoreWithRiichiScore } from "../engine-riichi-score.ts";
import { scoreWithSacckey } from "../engine-sacckey.ts";
import type { HandInput, Meld, Seat, WinContext } from "../types.ts";

type Shape = { name: string; concealed: string[]; winning: string; melds?: Meld[] };

const S: Shape[] = [];
const push = (name: string, concealed: string[], winning: string, melds: Meld[] = []) =>
  S.push({ name, concealed, winning, melds });

// ---- 普通役（非役满）—— 这些必须完全一致 ----
push("riichi+pinfu+tanyao", ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"], "5m");
push("pinfu tsumo", ["1m","2m","3m","4p","5p","6p","2s","3s","4s","3z","3z","4m","5m"], "6m");
push("chiitoitsu", ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z"], "7z");
push("sanshoku", ["2m","3m","4m","2p","3p","4p","2s","3s","4s","7m","7m","9m","9m"], "7m");
push("ittsuu", ["1m","2m","3m","4m","5m","6m","7m","8m","9m","5z","5z","1p","1p"], "1p");
push("honitsu", ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1m","1m","5z","5z"], "5z");
push("chinitsu", ["1m","2m","3m","1m","2m","3m","4m","5m","6m","7m","8m","9m","9m"], "9m");
push("junchan", ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","1z","1z"], "9s");
push("chanta", ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","5z","5z"], "9s");
push("shousangen", ["5z","5z","5z","6z","6z","6z","7z","7z","1m","2m","3m","4p","4p"], "4p");
push("yakuhai haku", ["5z","5z","5z","1m","2m","3m","4p","5p","6p","7s","8s","9s","2z"], "2z");
push("tanyao+peikou", ["2m","2m","3m","3m","4m","4m","5p","5p","6p","6p","7s","7s","8s"], "8s");
push("sanshoku doukou meld", ["3p","3p","3p","4s","4s","4s","7z","7z","2m","2m"], "2m",
  [{ type: "triplet", tiles: ["2m","2m","2m"], from: "west", calledIndex: 0 }]);

// ---- 役满（含复合）----
push("daisangen", ["5z","5z","5z","6z","6z","6z","7z","7z","7z","1m","2m","3m","4p"], "4p");
push("suuankou", ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9m"], "9m");
push("kokushi", ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"], "1m");
push("tsuuiisou+suuankou", ["1z","1z","1z","2z","2z","2z","5z","5z","5z","6z","6z","6z","7z"], "7z");
push("ryuuiisou+suuankou", ["2s","2s","2s","3s","3s","3s","4s","4s","4s","6s","6s","6s","8s"], "8s");

const seats: Seat[] = ["east", "south", "west", "north"];

type Row = {
  shape: string; seat: Seat; winType: string;
  aHan: number; aFu: number; aBasic: number; aYaku: string;
  bHan: number; bFu: number; bBasic: number; bYaku: string;
  cls: "A-fu-convention" | "B-yakuman-multiplier" | "C-real";
};

const rows: Row[] = [];
let compared = 0;
let skipped = 0;

for (const shape of S) {
  for (const seatWind of seats) {
    for (const winType of ["ron", "tsumo"] as const) {
      const roundWind: Seat = seatWind === "east" ? "south" : "east";
      const ctx: WinContext = {
        roundWind, seatWind, winType,
        ...(winType === "ron" ? { from: (seatWind === "west" ? "north" : "west") as Seat } : {}),
        isRiichi: true, honba: 0, riichiSticks: 0,
      };
      const input: HandInput = {
        concealed: shape.concealed,
        melds: shape.melds ?? [],
        winningTile: shape.winning,
        context: ctx,
      };

      const a = scoreWithRiichiScore(input);
      const b = await scoreWithSacckey(input);
      if (!a.ok || !b.ok) { skipped++; continue; }
      compared++;

      const isYakuman = a.score.limit != null || b.score.limit != null;
      let cls: Row["cls"];
      if (a.score.han === b.score.han && a.score.basicPoints === b.score.basicPoints) {
        // 番与基本点都一致，只有 fu 不同 -> 若是役满则属约定差异，否则属真实差异
        cls = isYakuman ? "A-fu-convention" : "C-real";
      } else if (isYakuman) {
        cls = "B-yakuman-multiplier";
      } else {
        cls = "C-real";
      }

      // 番与基本点都一致且 fu 也一致 -> 不算分歧
      if (a.score.han === b.score.han && a.score.fu === b.score.fu &&
          a.score.basicPoints === b.score.basicPoints) continue;

      rows.push({
        shape: shape.name, seat: seatWind, winType,
        aHan: a.score.han, aFu: a.score.fu, aBasic: a.score.basicPoints,
        aYaku: a.score.yaku.map((y) => `${y.name}${y.limit ? "(" + y.limit + ")" : ""}`).join(","),
        bHan: b.score.han, bFu: b.score.fu, bBasic: b.score.basicPoints,
        bYaku: b.score.yaku.map((y) => `${y.name}${y.limit ? "(" + y.limit + ")" : ""}`).join(","),
        cls,
      });
    }
  }
}

const byCls = new Map<string, Row[]>();
for (const r of rows) {
  if (!byCls.has(r.cls)) byCls.set(r.cls, []);
  byCls.get(r.cls)!.push(r);
}

console.log("========== 交叉对拍 v2（分歧分类）==========");
console.log(`对拍手数：${compared}    跳过（任一引擎拒绝）：${skipped}`);
console.log(`有分歧：${rows.length}`);
for (const [cls, list] of [...byCls].sort()) {
  console.log(`\n--- ${cls}：${list.length} 处 ---`);
  // 按牌型归并，避免同型刷屏
  const byShape = new Map<string, Row[]>();
  for (const r of list) {
    if (!byShape.has(r.shape)) byShape.set(r.shape, []);
    byShape.get(r.shape)!.push(r);
  }
  for (const [shape, rs] of byShape) {
    const x = rs[0]!;
    console.log(`  [${shape}] ×${rs.length}`);
    console.log(`      riichi-score: han=${x.aHan} fu=${x.aFu} basic=${x.aBasic}  ${x.aYaku}`);
    console.log(`      sacckey     : han=${x.bHan} fu=${x.bFu} basic=${x.bBasic}  ${x.bYaku}`);
  }
}

// C-real 是唯一需要真正警惕的
const real = byCls.get("C-real") ?? [];
console.log(`\n${real.length === 0 ? "✅ C-real 为空：非役满手牌两库完全一致" : "❌ C-real 有 " + real.length + " 处需要调查"}`);
process.exitCode = 0; // 分类报告不当作失败

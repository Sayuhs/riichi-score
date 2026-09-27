/**
 * 无役诊断的测试。
 *
 * ## 这一组在防什么
 *
 * 「无役」是线下最容易撞上的情况，而**绝大多数其实不是牌型问题** ——
 * 是场况没设对（门清忘了勾立直、其实是自摸、自风填错）。
 * 诊断模块要能确定性地指出这一点。
 *
 * ## 为什么不用默认场况判断
 *
 * 实测过：默认场况（东场・南家・荣和・无立直）会**双向撒谎** ——
 *   · 默认 `winType: "ron"` → 门清自摸的手牌被误判无役（假阴性）
 *   · 默认 `seatWind: "south"` → 手里有南刻子就白送「自风牌」（假阳性）
 *
 * 所以诊断**不猜**：拿用户当前的场况当基准，试「改一处会怎样」，
 * 把结果原样报出来让用户核对。
 */
import {
  addMeld,
  addTile,
  createEmptyHand,
  type HandState,
} from "../hand-state.ts";
import { createDefaultGameState, type GameState } from "../game-state.ts";
import { buildHandInput } from "../build-input.ts";
import { score } from "../../score/index.ts";
import { diagnoseNoYaku, shapeHints } from "../no-yaku-advice.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

function eq(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

function feed(state: HandState, tiles: string[]): HandState {
  let s = state;
  for (const t of tiles) s = addTile(s, t);
  return s;
}

/** 基准场况：东场、南家、荣和、什么都没勾（= 最容易出现「无役」的状态） */
function baseGame(part: Partial<GameState> = {}): GameState {
  return { ...createDefaultGameState(), ...part };
}

/** 先确认这手牌在给定场况下**确实**是无役 —— 让测试自证，而不是靠我手算 */
async function assertNoYaku(hand: HandState, game: GameState): Promise<void> {
  const built = buildHandInput(hand, game);
  ok(built.ok, `输入应能构造：${built.ok ? "" : built.reason}`);
  if (!built.ok) return;
  const r = await score(built.input);
  ok(
    "error" in r && r.error.kind === "no-yaku",
    `这手牌在基准场况下应当是「无役」，实际：${
      "error" in r ? r.error.kind + " " + r.error.message : "算出来了（有役）"
    }`,
  );
}

// ============================================================
console.log("\n【1】门清忘了勾立直（最高频的原因）");
// ============================================================

// 手牌：123m + 456m + 789p + 234s + 99s，和牌张 9s（单骑）
//
// 为什么它无役：
//   · 有 1m/9p/9s → 不是断幺九
//   · 和牌张是 9s 单骑 → 不满足平和的「两面听」
//   · 123m + 456m 但 789 在筒子 → 不是一气通贯
//   · 没有重复顺子、没有役牌 → 一盃口、役牌都不成立
//
// 门清 + 荣和 + 不勾立直 → 无役。这正是最常见的「其实勾个立直就有」的情况。
const MENZEN_NO_YAKU = [
  "1m","2m","3m","4m","5m","6m","7p","8p","9p","2s","3s","4s","9s",
];

await test("基准场况下确实是「无役」（前置确认）", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  await assertNoYaku(hand, baseGame());
});

await test("诊断出「勾上立直就有役」", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const d = await diagnoseNoYaku(hand, baseGame(), { isMenzen: true });

  eq(d.verdictKind, "context", "结论应是「场况问题」");
  const riichi = d.contextFixes.find((f) => f.patch.isRiichi);
  ok(riichi !== undefined, "应给出「勾立直」的建议");
  ok(riichi!.confidence === "likely", "这属于「很可能漏设了」");
  ok(riichi!.yaku.length > 0, "应列出成立的役");
  console.log(`        （建议：${riichi!.text} → 役：${riichi!.yaku.join("、")}）`);
});

await test("结论文案说清「不是牌型的问题」", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const d = await diagnoseNoYaku(hand, baseGame(), { isMenzen: true });
  ok(d.verdict.includes("不是牌型"), `文案应指向场况，实际：${d.verdict}`);
});

// ============================================================
console.log("\n【2】其实是自摸");
// ============================================================

await test("诊断出「自摸就有役」", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const d = await diagnoseNoYaku(hand, baseGame(), { isMenzen: true });
  const tsumo = d.contextFixes.find((f) => f.patch.winType === "tsumo");
  ok(tsumo !== undefined, "应给出「自摸」的建议");
  ok(
    tsumo!.yaku.some((y) => y.includes("自摸")),
    `役里应含门前清自摸和，实际：${tsumo!.yaku.join("、")}`,
  );
});

// ============================================================
console.log("\n【3】已经勾了立直时不该重复建议");
// ============================================================

await test("已经立直 → 不再建议「勾立直」", async () => {
  // 构造一手：立直也救不了的牌（有副露 → 立直不成立）
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  hand = feed(hand, ["3p","4p","5p","6p","7p","8p","2s","3s","4s","9s"]);
  hand = addTile(hand, "9s"); // 和牌张

  const game = baseGame({ isRiichi: false });
  const d = await diagnoseNoYaku(hand, game, { isMenzen: false });
  const riichi = d.contextFixes.find((f) => f.patch.isRiichi);
  eq(riichi, undefined, "有副露时不该建议立直");
});

// ============================================================
console.log("\n【4】真的没役（保守判断）");
// ============================================================

await test("有副露、无役牌、有幺九 → 判为「牌型确实没役」", async () => {
  // 111m(碰) + 345p + 678p + 234s + 99s
  // 有幺九（1m）→ 不是断幺九；没有役牌；非门清 → 立直/平和/一盃口全不成立
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  hand = feed(hand, ["3p","4p","5p","6p","7p","8p","2s","3s","4s","9s"]);
  hand = addTile(hand, "9s");

  const game = baseGame();
  await assertNoYaku(hand, game);

  const d = await diagnoseNoYaku(hand, game, { isMenzen: false });
  eq(d.verdictKind, "shape", "所有变体都无役时才敢判「牌型」");
  ok(d.contextFixes.length === 0, "不该给出场况建议");
});

await test("「真的没役」的文案会引导去役种速查", async () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  hand = feed(hand, ["3p","4p","5p","6p","7p","8p","2s","3s","4s","9s"]);
  hand = addTile(hand, "9s");

  const d = await diagnoseNoYaku(hand, baseGame(), { isMenzen: false });
  ok(d.verdict.includes("确实没有役") || d.verdict.includes("速查"), `实际：${d.verdict}`);
});

// ============================================================
console.log("\n【5】形状提示（只说「缺什么」，不说「换哪张」）");
// ============================================================

await test("有幺九时提示断幺九缺什么", () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const hints = shapeHints(hand, baseGame(), { isMenzen: true, meldCount: 0 });
  ok(hints.some((h) => h.includes("断幺九")), `应提到断幺九，实际：${hints.join(" | ")}`);
});

await test("门清时提示可用的役", () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const hints = shapeHints(hand, baseGame(), { isMenzen: true, meldCount: 0 });
  ok(hints.some((h) => h.includes("门清")), `应提到门清，实际：${hints.join(" | ")}`);
});

await test("有副露时明确指出哪些役被挡住", () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  const hints = shapeHints(hand, baseGame(), { isMenzen: false, meldCount: 1 });
  const blocked = hints.find((h) => h.includes("副露"));
  ok(blocked !== undefined, "应提到副露的影响");
  ok(blocked!.includes("立直"), "应点名立直被挡住");
  ok(blocked!.includes("七对子"), "应点名七对子被挡住");
});

await test("有指示牌时强调「宝牌不算役」", () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const game = baseGame({ doraIndicators: ["1z"] });
  const hints = shapeHints(hand, game, { isMenzen: true, meldCount: 0 });
  ok(
    hints.some((h) => h.includes("不算役")),
    `应提到宝牌不算役，实际：${hints.join(" | ")}`,
  );
});

await test("暗杠不破门清 —— 提示里不能说「有副露所以役被挡」", () => {
  let hand = feed(createEmptyHand(), ["1m","1m","1m","1m"]);
  hand = { ...hand, melds: [{ id: 1, kind: "ankan", tiles: ["1m","1m","1m","1m"] }], concealed: [] };
  const hints = shapeHints(hand, baseGame(), { isMenzen: true, meldCount: 1 });
  ok(
    hints.some((h) => h.includes("暗杠")),
    `应说明暗杠仍算门清，实际：${hints.join(" | ")}`,
  );
  ok(
    !hints.some((h) => h.includes("全部不成立")),
    "不该说门清限定的役全被挡住",
  );
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

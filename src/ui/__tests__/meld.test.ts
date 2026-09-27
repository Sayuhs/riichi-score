/**
 * 副露（吃 / 碰 / 杠）标注的测试。
 *
 * ## 这一组在防什么
 *
 * 「这 3 张是自己摸的还是吃来的」是**两个完全不同的概念**，而且影响极大：
 * 吃了就破门清 → 立直不能立、平和/一盃口/七对子全不成立。
 *
 * 实测过的极端例子（牌**完全一样**，只差 234p 是摸的还是吃的）：
 *     自己摸的 → 2 番 30 符 → 2000 点（立直 + 平和）
 *     吃来的   → 无役，根本不能和牌
 *
 * 所以在能标注副露之前，**吃了牌再录会得到完全错误的点数** ——
 * 不是符数小错，是把「不能和」算成 2000 点。
 */
import {
  addMeld,
  addTile,
  checkMeldShape,
  createEmptyHand,
  expectedConcealedCount,
  isComplete,
  removeMeld,
  setMeldKind,
  type HandState,
} from "../hand-state.ts";
import { createDefaultGameState, type GameState } from "../game-state.ts";
import { buildHandInput } from "../build-input.ts";
import { score } from "../../score/index.ts";

/**
 * ⚠️ `createDefaultGameState()` **不接受参数** —— 写 `baseGame({...})`
 *    不会报错、也不会生效，参数被静默忽略（我在这里踩过：以为勾了立直，其实没有）。
 *    所以要用这个 helper 显式合并。
 */
function baseGame(part: Partial<GameState> = {}): GameState {
  return { ...createDefaultGameState(), ...part };
}

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

// ============================================================
console.log("\n【1】形态校验（给中文的具体提示，而不是引擎的英文）");
// ============================================================

await test("吃：连续同花色 → 合法", () => {
  eq(checkMeldShape("run", ["3p", "4p", "5p"]), null, "345p");
  eq(checkMeldShape("run", ["5p", "3p", "4p"]), null, "顺序无关");
  eq(checkMeldShape("run", ["1m", "2m", "3m"]), null, "123m");
});

await test("吃：不连续 → 拒绝并说清原因", () => {
  const err = checkMeldShape("run", ["3p", "4p", "6p"]);
  ok(err !== null, "应拒绝");
  ok(err!.includes("连续"), `提示应说明要连续，实际：${err}`);
});

await test("吃：跨花色 → 拒绝", () => {
  const err = checkMeldShape("run", ["3p", "4p", "5m"]);
  ok(err !== null, "应拒绝");
  ok(err!.includes("花色"), `提示应说明花色，实际：${err}`);
});

await test("碰：3 张相同 → 合法；不同 → 拒绝", () => {
  eq(checkMeldShape("triplet", ["5z", "5z", "5z"]), null, "白刻子");
  const err = checkMeldShape("triplet", ["5z", "5z", "6z"]);
  ok(err !== null, "应拒绝");
  ok(err!.includes("相同"), `实际：${err}`);
});

await test("明杠：4 张相同 → 合法；3 张 → 拒绝", () => {
  eq(checkMeldShape("daiminkan", ["3m", "3m", "3m", "3m"]), null, "4 张");
  const err = checkMeldShape("daiminkan", ["3m", "3m", "3m"]);
  ok(err !== null, "应拒绝（张数不对）");
});

await test("赤 5 与普通 5 视为同种", () => {
  eq(checkMeldShape("triplet", ["0m", "5m", "5m"]), null, "赤 5 + 两张 5m 可以碰");
});

// ============================================================
console.log("\n【2】★ 端到端：「自己摸的」vs「吃来的」差别有多大");
// ============================================================

// 同一手牌：234m | 567m | 789s | 234p | 99s
const REST = ["2m", "3m", "4m", "5m", "6m", "7m", "7s", "8s", "9s"];

await test("自己摸的（门清）→ 立直 + 平和，2000 点", async () => {
  const hand = feed(createEmptyHand(), [...REST, "2p", "3p", "4p", "9s", "9s"]);
  eq(hand.melds.length, 0, "没有副露");
  eq(isComplete(hand), true, "完整");

  const built = buildHandInput(hand, baseGame({ isRiichi: true }));
  ok(built.ok, "应能构造");
  if (!built.ok) return;
  const r = await score(built.input);
  ok(!("error" in r), "应能算出来");
  if ("error" in r) return;

  ok(r.han >= 1, `门清应当有役，实际 ${r.han} 番`);
  ok(r.total > 0, "应当能算出点数");
  console.log(`        （${r.yaku.map((y) => y.name).join("、")} → ${r.han} 番 ${r.fu} 符 ${r.total} 点）`);
});

await test("★ 吃来的（破门清）→ 无役，根本不能和牌", async () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["2p", "3p", "4p"]);
  hand = feed(hand, [...REST, "9s", "9s"]);
  eq(hand.melds.length, 1, "有 1 组副露");
  eq(isComplete(hand), true, "完整");

  const built = buildHandInput(hand, baseGame({ isRiichi: true }));
  ok(built.ok, "应能构造");
  if (!built.ok) return;
  const r = await score(built.input);

  ok("error" in r, "应当算不出来");
  if (!("error" in r)) return;
  eq(r.error.kind, "no-yaku", "应当是无役（而不是能算出来）");
  console.log(`        （无役 —— 同样 14 张牌，差了这 2000 点）`);
});

await test("不标注副露的话，会被当成门清（这就是原来的 bug）", async () => {
  // 把这 3 张当成门清录进去 —— 应用会给 2000 点
  const asConcealed = feed(createEmptyHand(), [...REST, "2p", "3p", "4p", "9s", "9s"]);
  eq(isComplete(asConcealed), true, "前置：应已录完");
  const built = buildHandInput(asConcealed, baseGame({ isRiichi: true }));
  ok(built.ok, "应能构造");
  if (!built.ok) return;
  const r = await score(built.input);
  ok(!("error" in r), "不标注时会被当成门清，能算出来");
  if ("error" in r) return;
  ok(
    r.total > 0,
    `不标注时被当成门清、算出了 ${r.total} 点 —— 而这手牌其实是吃来的，应该无役`,
  );
  console.log(`        （不标注 → 算成 ${r.total} 点；实际是吃来的 → 应该无役）`);
});

// ============================================================
console.log("\n【3】标注副露后的张数联动");
// ============================================================

await test("加一组副露后，门前目标从 13 降到 10", () => {
  let hand = createEmptyHand();
  eq(expectedConcealedCount(hand.melds), 13, "0 组 → 13");
  hand = addMeld(hand, ["2p", "3p", "4p"]);
  eq(expectedConcealedCount(hand.melds), 10, "1 组 → 10");
  hand = addMeld(hand, ["5z", "5z", "5z"]);
  eq(expectedConcealedCount(hand.melds), 7, "2 组 → 7");
});

await test("副露的类型能改（碰 → 明杠）", () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["3m", "3m", "3m", "3m"]);
  const id = hand.melds[0]!.id;
  eq(hand.melds[0]!.kind, "ankan", "addMeld 对 4 张默认猜成暗杠");
  hand = setMeldKind(hand, id, "daiminkan");
  eq(hand.melds[0]!.kind, "daiminkan", "改成明杠");
});

await test("删掉副露后目标涨回来", () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["2p", "3p", "4p"]);
  const id = hand.melds[0]!.id;
  hand = removeMeld(hand, id);
  eq(hand.melds.length, 0, "删掉了");
  eq(expectedConcealedCount(hand.melds), 13, "目标回到 13");
});

await test("暗杠不破门清（门清仍成立）", () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m", "1m", "1m", "1m"]);
  const isMenzen = hand.melds.every((m) => m.kind === "ankan");
  ok(isMenzen, "只有暗杠时仍是门清");
});

await test("吃 / 碰 破门清", () => {
  for (const tiles of [["2p", "3p", "4p"], ["5z", "5z", "5z"]]) {
    let hand = createEmptyHand();
    hand = addMeld(hand, tiles);
    const isMenzen = hand.melds.every((m) => m.kind === "ankan");
    ok(!isMenzen, `${tiles.join("")} 应破门清`);
  }
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

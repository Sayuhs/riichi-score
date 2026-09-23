/**
 * 手牌录入的核心交互测试（自动和牌张）。
 *
 * ## 这一版删掉了什么
 *
 * 原来还有「撤销栈」的测试（`hand-store.ts`）。
 * 但**撤销按钮已按用户要求从界面移除**，`hand-store.ts` 成了只有测试在用的死代码，
 * 所以文件和对应测试一起删了 —— 不留「看起来有用、其实没人用」的东西。
 *
 * ## 保留的核心：自动和牌张（Q9 A）
 *
 * 这是录入流程的关键设计：点满 13 张后，**再点的那张自动成为和牌张**。
 * 这样录一手牌就是「把 14 张按顺序点完」，不需要额外指定哪张是和牌张 ——
 * 线下念牌本来就是「手里这 13 张……最后摸到这张」。
 *
 * 边界最容易出错：满了之后的行为、有副露时的门槛、删掉后能否重录。
 */
import {
  addTile,
  addMeld,
  createEmptyHand,
  expectedConcealedCount,
  isComplete,
  removeConcealedAt,
  remainingSlots,
  setWinningTile,
  type HandState,
} from "../hand-state.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

function eq(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

/** 门清 13 张（不含和牌张）的标准测试手牌 */
const THIRTEEN = [
  "1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p",
];

function feed(state: HandState, tiles: string[]): HandState {
  let s = state;
  for (const t of tiles) s = addTile(s, t);
  return s;
}

// ============================================================
console.log("\n【1】自动和牌张");
// ============================================================

test("点满 13 张时还不会自动设和牌张", () => {
  const s = feed(createEmptyHand(), THIRTEEN);
  eq(s.concealed.length, 13, "门前 13 张");
  eq(s.winningTile, null, "和牌张仍为空");
  eq(isComplete(s), false, "还不完整");
});

test("第 14 张自动成为和牌张", () => {
  const s = feed(createEmptyHand(), [...THIRTEEN, "9s"]);
  eq(s.concealed.length, 13, "门前仍 13 张");
  eq(s.winningTile, "9s", "第 14 张自动成为和牌张");
  eq(s.concealed.includes("9s"), false, "和牌张不占门前");
  eq(isComplete(s), true, "完整");
});

test("录满第 15 张被拒绝，并保住已有的 14 张", () => {
  let s = feed(createEmptyHand(), [...THIRTEEN, "9s"]);
  const before = s.concealed.length;
  s = addTile(s, "8s");
  eq(s.concealed.length, before, "门前不变");
  eq(s.winningTile, "9s", "和牌张不变");
  ok(s.notice !== null, "应给出提示 ");
  ok(s.notice!.includes("录满"), "提示应说明已录满 ");
});

test("录满后拒绝时不会静默丢牌（设计要点）", () => {
  let s = feed(createEmptyHand(), [...THIRTEEN, "9s"]);
  s = addTile(s, "8s");
  // 总数必须仍是 14 —— 静默留着多余的牌会让"看着 14 张、实际 15 张"很难发现
  eq(s.concealed.length + 1, 14, "总数仍是 14");
});

// ============================================================
console.log("\n【2】换牌流程（撤销已移除，靠「点掉再点新的」）");
// ============================================================

test("换和牌张：清掉和牌张 → 门前不满 → 再点一张自动成为新和牌张", () => {
  let s = feed(createEmptyHand(), [...THIRTEEN, "9s"]);
  eq(s.winningTile, "9s", "初始和牌张 9s");

  // 清掉和牌张（setWinningTile 传空字符串不是合法牌，所以用状态替换模拟"清除"）
  s = { ...s, winningTile: null };
  eq(s.concealed.length, 13, "门前仍 13 张");
  eq(isComplete(s), false, "不完整了");

  // 再点一张新的 —— 门前已满，所以它成为新和牌张
  s = addTile(s, "1s");
  eq(s.winningTile, "1s", "新和牌张");
  eq(s.concealed.includes("1s"), false, "新和牌张不占门前");
  eq(isComplete(s), true, "仍完整");
});

test("换门前牌：点掉一张 → 门前变 12 → 点新的补回门前", () => {
  let s = feed(createEmptyHand(), [...THIRTEEN, "9s"]);
  eq(s.concealed.length, 13, "门前 13");

  // 点掉一张门前牌
  s = removeConcealedAt(s, 0);
  eq(s.concealed.length, 12, "门前 12");
  eq(s.winningTile, "9s", "和牌张不受影响");
  eq(isComplete(s), false, "不完整了");

  // 补一张 —— 门前还不满，所以进门前而不是和牌张
  s = addTile(s, "5s");
  eq(s.concealed.length, 13, "补回门前 13");
  eq(s.winningTile, "9s", "和牌张仍是 9s");
  eq(isComplete(s), true, "又完整了");
});

test("setWinningTile 指定外来和牌张（不占门前）", () => {
  let s = feed(createEmptyHand(), THIRTEEN);
  s = setWinningTile(s, "9s");
  eq(s.winningTile, "9s", "和牌张");
  eq(s.concealed.length, 13, "门前不变");
  eq(isComplete(s), true, "完整");
});

// ============================================================
console.log("\n【3】副露对门槛的影响");
// ============================================================
// 注意：副露的**录入 UI 已移除**，但底层逻辑保留（算番要判门清）。
// 这里测的是逻辑层 —— 将来加回 UI 时这些行为必须仍然正确。

test("有副露时门槛跟着降低：门前 10 张后的第 11 张才是和牌张", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  eq(expectedConcealedCount(s.melds), 10, "一副露后门前应 10 张");

  s = feed(s, ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p"]);
  eq(s.concealed.length, 10, "门前 10 张");
  eq(s.winningTile, null, "还不到和牌张");

  s = addTile(s, "2p");
  eq(s.winningTile, "2p", "第 11 张成为和牌张");
  eq(s.concealed.length, 10, "门前仍 10 张");
  eq(isComplete(s), true, "10 + 3 + 1 = 14，完整");
});

test("剩余张数随副露递减", () => {
  let s = createEmptyHand();
  eq(remainingSlots(s), 13, "无副露 13");
  s = addMeld(s, ["1m", "2m", "3m"]);
  eq(remainingSlots(s), 10, "一副露 10");
  s = addMeld(s, ["1p", "1p", "1p"]);
  eq(remainingSlots(s), 7, "两副露 7");
});

// ============================================================
console.log("\n【4】张数上限与同种牌限制");
// ============================================================

test("同种牌超过 4 张被拒绝（含赤 5 合并计数）", () => {
  let s = createEmptyHand();
  s = feed(s, ["5m", "5m", "0m"]);
  eq(s.concealed.length, 3, "3 张");
  s = addTile(s, "0m");
  eq(s.concealed.length, 4, "第 4 张可以");
  s = addTile(s, "5m");
  eq(s.concealed.length, 4, "第 5 张被拒");
  ok(s.notice!.includes("4 张"), "应说明原因 ");
});

test("非法牌被拒绝", () => {
  const s = addTile(createEmptyHand(), "0z");
  eq(s.concealed.length, 0, "不应加入");
  ok(s.notice !== null, "应提示 ");
});

// ============================================================
console.log("\n【5】完整流程演练：模拟真人录一手牌");
// ============================================================

test("录 13 张 → 第 14 张自动和牌 → 点掉两张 → 重录", () => {
  let s = createEmptyHand();

  // 正常录入 13 张
  s = feed(s, THIRTEEN);
  eq(s.concealed.length, 13, "门前 13");
  eq(isComplete(s), false, "差和牌张");

  // 第 14 张（摸到了 9s）
  s = addTile(s, "9s");
  eq(isComplete(s), true, "完整");
  eq(s.winningTile, "9s", "和牌张 9s");

  // 发现刚才两下点错了 —— 点掉最后两张门前牌
  s = removeConcealedAt(s, s.concealed.length - 1);
  s = removeConcealedAt(s, s.concealed.length - 1);
  eq(s.concealed.length, 11, "回到 11 张");
  // 和牌张还在（没被影响）
  eq(s.winningTile, "9s", "和牌张仍是 9s");

  // 重录正确的那两张到门前
  s = addTile(s, "5p");
  s = addTile(s, "6p");
  eq(s.concealed.length, 13, "补回 13");
  eq(isComplete(s), true, "完整");
  eq(s.winningTile, "9s", "和牌张不变");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

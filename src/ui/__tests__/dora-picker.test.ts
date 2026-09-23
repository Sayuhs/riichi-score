/**
 * `dora-picker.ts` 的测试。
 *
 * ## 为什么这组测试重要
 *
 * 引擎对指示牌**几乎完全不校验**（实测：6 张、8 张都照收；非法牌面静默忽略；
 * 表里张数不等也不报错）。所以规则全在这一层 —— 一旦这里错了，
 * 用户会拿到**静默算错的番数**，而没有任何报错。
 *
 * 另外「同一张牌 ≤ 4」是引擎唯一会管的一条，但它吐英文错误，
 * 我们要在用户点到之前就禁掉。
 */
import {
  MAX_COPIES,
  MAX_INDICATORS,
  addIndicator,
  canPick,
  isAkaFive,
  normalizeKind,
  removeIndicator,
  toggleIndicator,
  uradoraEnabled,
  type IndicatorState,
} from "../dora-picker.ts";

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

/** 手牌里没有任何牌 */
const NO_HAND = () => 0;
/** 造一个「手牌里某张牌有 n 张」的计数函数 */
const handWith = (map: Record<string, number>) => (kind: string) => map[kind] ?? 0;

const empty = (): IndicatorState => ({ dora: [], uradora: [] });

// ============================================================
console.log("\n【1】数量上限：最多 5 张");
// ============================================================

test("表宝牌可以加到 5 张", () => {
  let s = empty();
  for (const t of ["1m", "2m", "3m", "4m", "5m"]) {
    const r = addIndicator(s, "dora", t, NO_HAND);
    ok(r.notice === null, `${t} 应该能加：${r.notice}`);
    s = r.state;
  }
  eq(s.dora.length, MAX_INDICATORS, "刚好 5 张");
});

test("第 6 张被拒绝，并给出中文原因", () => {
  const s: IndicatorState = { dora: ["1m", "2m", "3m", "4m", "5m"], uradora: [] };
  const r = addIndicator(s, "dora", "6m", NO_HAND);
  eq(r.state.dora.length, 5, "仍是 5 张");
  ok(r.notice !== null, "应有提示");
  ok(r.notice!.includes("5"), `提示应说明上限，实际：${r.notice}`);
});

test("上限是 5 不是 4（四杠子时会有第 5 张，必须接受）", () => {
  const s: IndicatorState = { dora: ["1m", "2m", "3m", "4m"], uradora: [] };
  const r = addIndicator(s, "dora", "5m", NO_HAND);
  ok(r.notice === null, `第 5 张不该被拒：${r.notice}`);
});

// ============================================================
console.log("\n【2】里宝张数不能超过表宝（表里一一对应）");
// ============================================================

test("没有表宝时，里宝一张都不能选", () => {
  const r = addIndicator(empty(), "uradora", "1m", NO_HAND);
  ok(r.notice !== null, "应被拒绝");
  eq(r.state.uradora.length, 0, "仍为空");
});

test("表宝 2 张时，里宝最多 2 张", () => {
  let s: IndicatorState = { dora: ["1m", "2m"], uradora: [] };
  s = addIndicator(s, "uradora", "3m", NO_HAND).state;
  eq(s.uradora.length, 1, "第 1 张 ok");
  s = addIndicator(s, "uradora", "4m", NO_HAND).state;
  eq(s.uradora.length, 2, "第 2 张 ok");

  const r = addIndicator(s, "uradora", "5m", NO_HAND);
  eq(r.state.uradora.length, 2, "第 3 张被拒");
  ok(r.notice!.includes("表里一一对应"), `提示应说明原因，实际：${r.notice}`);
});

test("删掉表宝后，多出来的里宝会被截掉（不会留下非法状态）", () => {
  const s: IndicatorState = { dora: ["1m", "2m"], uradora: ["3m", "4m"] };
  const next = removeIndicator(s, "dora", 0);
  eq(next.dora, ["2m"], "表宝剩 1 张");
  eq(next.uradora, ["3m"], "里宝被截到 1 张");
});

test("删里宝不会影响表宝", () => {
  const s: IndicatorState = { dora: ["1m", "2m"], uradora: ["3m", "4m"] };
  const next = removeIndicator(s, "uradora", 1);
  eq(next.uradora, ["3m"], "里宝剩 1");
  eq(next.dora, ["1m", "2m"], "表宝不变");
});

// ============================================================
console.log("\n【3】不接受赤 5（对算分零影响）");
// ============================================================

test("赤 5 不能当指示牌", () => {
  for (const t of ["0m", "0p", "0s"]) {
    const r = canPick("dora", t, empty(), NO_HAND);
    ok(!r.ok, `${t} 应被拒`);
    ok(r.reason!.includes("赤 5"), `原因应提到赤 5，实际：${r.reason}`);
  }
});

test("isAkaFive 判断正确", () => {
  ok(isAkaFive("0m") && isAkaFive("0p") && isAkaFive("0s"), "赤 5 应为 true");
  ok(!isAkaFive("5m") && !isAkaFive("1z"), "非赤 5 应为 false");
});

// ============================================================
console.log("\n【4】同一张牌 ≤ 4（手牌 + 副露 + 指示牌合并计数）");
// ============================================================

test("手牌已有 1 张 2s 时，指示牌最多再选 3 张 2s", () => {
  const hand = handWith({ "2s": 1 });
  let s = empty();
  for (let i = 0; i < 3; i++) {
    const r = addIndicator(s, "dora", "2s", hand);
    ok(r.notice === null, `第 ${i + 1} 张应能加：${r.notice}`);
    s = r.state;
  }
  eq(s.dora.length, 3, "加了 3 张");

  const r = addIndicator(s, "dora", "2s", hand);
  ok(r.notice !== null, "第 4 张应被拒（1 + 4 = 5 > 4）");
  ok(r.notice!.includes("4 张"), `提示应说明原因，实际：${r.notice}`);
});

test("手牌已用满 4 张时，一张指示牌都选不了", () => {
  const hand = handWith({ "1m": 4 });
  const r = canPick("dora", "1m", empty(), NO_HAND);
  ok(r.ok, "无手牌时可以选（对照组）");

  const r2 = canPick("dora", "1m", empty(), hand);
  ok(!r2.ok, "手牌满了就不该能选");
});

test("同一张牌做指示牌最多 4 张（正好是物理牌数）", () => {
  let s = empty();
  for (let i = 0; i < 4; i++) {
    const r = addIndicator(s, "dora", "3p", NO_HAND);
    ok(r.notice === null, `第 ${i + 1} 张应能加：${r.notice}`);
    s = r.state;
  }
  eq(s.dora.length, 4, "4 张都加上了");

  const r = addIndicator(s, "dora", "3p", NO_HAND);
  ok(r.notice !== null, "第 5 张应被拒（只有 4 张实体牌）");
});

test("表宝和里宝的牌面合并计数", () => {
  // 表宝 3 张 3p + 里宝 1 张 3p = 合计 4 张，已到上限
  const s: IndicatorState = { dora: ["3p", "3p", "3p"], uradora: ["3p"] };
  const r = addIndicator(s, "dora", "3p", NO_HAND);
  ok(r.notice !== null, "合计已 4 张，再加应被拒");
  ok(r.notice!.includes("4 张"), `提示应说明原因，实际：${r.notice}`);
});

test("手牌 3 张 5m 时，还能选 1 张 5m 当指示牌（3+1=4）", () => {
  const hand = handWith({ "5m": 3 });
  const r = canPick("dora", "5m", empty(), hand);
  ok(r.ok, `3 + 1 = 4 ≤ 4，应该能选，实际被拒：${r.reason}`);
});

test("手牌 4 张 5m 时，不能再选 5m 当指示牌", () => {
  const hand = handWith({ "5m": 4 });
  const r = canPick("dora", "5m", empty(), hand);
  ok(!r.ok, "4 + 1 = 5 > 4，应被拒");
});

test("normalizeKind 把赤 5 归一成普通 5", () => {
  eq(normalizeKind("0m"), "5m", "0m");
  eq(normalizeKind("0p"), "5p", "0p");
  eq(normalizeKind("3s"), "3s", "非赤牌不变");
});

// ============================================================
console.log("\n【5】不同位置的重复指示牌是合法的");
// ============================================================

test("两张相同的表宝指示牌可以并存", () => {
  let s = empty();
  s = addIndicator(s, "dora", "3m", NO_HAND).state;
  const r = addIndicator(s, "dora", "3m", NO_HAND);
  ok(r.notice === null, `第二张 3m 应该能加：${r.notice}`);
  eq(r.state.dora, ["3m", "3m"], "两张都在");
});

test("表宝和里宝可以是同一张牌", () => {
  const s: IndicatorState = { dora: ["7z"], uradora: [] };
  const r = addIndicator(s, "uradora", "7z", NO_HAND);
  ok(r.notice === null, `里宝也能是 7z：${r.notice}`);
});

// ============================================================
console.log("\n【6】toggle：点已有的删掉，点新的加上");
// ============================================================

test("点空位 → 加上", () => {
  const r = toggleIndicator(empty(), "dora", "1m", NO_HAND);
  eq(r.state.dora, ["1m"], "已加上");
});

test("点已有的 → 删掉", () => {
  const s: IndicatorState = { dora: ["1m", "2m"], uradora: [] };
  const r = toggleIndicator(s, "dora", "1m", NO_HAND);
  eq(r.state.dora, ["2m"], "1m 被删掉");
  eq(r.state.uradora, [], "里宝不受影响");
});

test("toggle 到上限时返回提示而不是静默失败", () => {
  const s: IndicatorState = { dora: ["1m", "2m", "3m", "4m", "5m"], uradora: [] };
  const r = toggleIndicator(s, "dora", "6m", NO_HAND);
  eq(r.state.dora.length, 5, "没变");
  ok(r.notice !== null, "应有提示");
});

// ============================================================
console.log("\n【7】里宝整块的启用条件");
// ============================================================

test("未立直时锁定", () => {
  const s: IndicatorState = { dora: ["1m"], uradora: [] };
  ok(!uradoraEnabled(s, false), "未立直应锁定");
});

test("立直但还没选表宝时也锁定（没有表宝就不可能有里宝）", () => {
  ok(!uradoraEnabled(empty(), true), "无表宝应锁定");
});

test("立直 + 有表宝 → 可用", () => {
  const s: IndicatorState = { dora: ["1m"], uradora: [] };
  ok(uradoraEnabled(s, true), "应可用");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

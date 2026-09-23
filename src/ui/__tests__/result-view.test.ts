/**
 * `result-view.ts` 的测试。
 *
 * ## 这一组测试在防什么
 *
 * 1. **[object Object] 回归** —— 结果页曾经直接把 `Payment[]` 插进模板，
 *    渲染成「本场 [object Object] 已计入。」纯函数化之后可以断言文案里
 *    不含这种占位符。
 *
 * 2. **支付明细的单一来源** —— `buildPaymentRows` 的合计必须取自
 *    `finalPayments`，不能自己现算 `base + honba`。
 *    这条断言就是守卫：一旦有人把算式加回来，测试会红。
 *
 * 3. **只显示真正付钱的座位** —— 自摸时和牌者不付、荣和时非放铳者不付。
 */
import type { ScoreResult } from "../../score/types.ts";
import { buildPaymentRows, honbaNote, honbaTotal } from "../result-view.ts";

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

/** 造一个只填了支付相关字段的结果（其余给中性值） */
function makeResult(part: Partial<ScoreResult>): ScoreResult {
  return {
    yaku: [],
    han: 1,
    fu: 30,
    basicPoints: 240,
    fuItems: [],
    honbaPayments: [],
    riichiBonus: 0,
    basePayments: [],
    finalPayments: [],
    total: 0,
    dora: 0,
    uradora: 0,
    akadora: 0,
    ...part,
  };
}

// ============================================================
console.log("\n【1】[object Object] 回归");
// ============================================================

test("有本场时，文案里不含 [object Object]", () => {
  const r = makeResult({
    honbaPayments: [{ seat: "west", value: 600 }],
  });
  const note = honbaNote(r);
  ok(!note.includes("[object Object]"), `文案出现了占位符: ${note}`);
  ok(!note.includes("object"), `文案出现了 object: ${note}`);
});

test("有本场时，文案里带上了合计点数", () => {
  const r = makeResult({ honbaPayments: [{ seat: "west", value: 600 }] });
  ok(honbaNote(r) === "本场（共 600 点）已计入。", `实际: ${honbaNote(r)}`);
});

test("没有本场时，文案是空串（模板据此隐藏）", () => {
  eq(honbaNote(makeResult({})), "", "无本场");
});

// ============================================================
console.log("\n【2】支付明细的单一来源（守卫断言）");
// ============================================================

test("每一行的合计必须等于 finalPayments 里同座位的值", () => {
  const r = makeResult({
    basePayments: [
      { seat: "west", value: 7700 },
      { seat: "north", value: 3900 },
    ],
    honbaPayments: [
      { seat: "west", value: 600 },
      { seat: "north", value: 300 },
    ],
    finalPayments: [
      { seat: "west", value: 8300 },
      { seat: "north", value: 4200 },
    ],
  });

  const rows = buildPaymentRows(r);
  for (const row of rows) {
    const expected = r.finalPayments.find((p) => p.seat === row.seat)!.value;
    ok(
      row.total === expected,
      `${row.seat} 的合计 ${row.total} ≠ finalPayments 的 ${expected}`,
    );
  }
});

test("本场部分是「合计 − 基础」反推出来的，与 finalPayments 自洽", () => {
  const r = makeResult({
    basePayments: [{ seat: "west", value: 7700 }],
    honbaPayments: [{ seat: "west", value: 600 }],
    finalPayments: [{ seat: "west", value: 8300 }],
  });
  const rows = buildPaymentRows(r);
  eq(rows[0], { seat: "west", base: 7700, honba: 600, total: 8300 }, "整行");
});

test("故意构造不一致时，合计仍以 finalPayments 为准（证明不是现算的）", () => {
  // base + honba = 100，但 finalPayments 说是 999。
  // 若实现是 `base + honba` 现算，这里会得到 100 而测试失败。
  const r = makeResult({
    basePayments: [{ seat: "west", value: 60 }],
    honbaPayments: [{ seat: "west", value: 40 }],
    finalPayments: [{ seat: "west", value: 999 }],
  });
  const rows = buildPaymentRows(r);
  ok(rows[0]!.total === 999, `合计应取自 finalPayments(999)，实际 ${rows[0]!.total}`);
});

// ============================================================
console.log("\n【3】只列出真正付钱的座位");
// ============================================================

test("自摸：和牌者本人不出现在明细里", () => {
  const r = makeResult({
    // 东家自摸，南西北各付
    basePayments: [
      { seat: "south", value: 1000 },
      { seat: "west", value: 1000 },
      { seat: "north", value: 1000 },
    ],
    finalPayments: [
      { seat: "south", value: 1000 },
      { seat: "west", value: 1000 },
      { seat: "north", value: 1000 },
    ],
  });
  const seats = buildPaymentRows(r).map((x) => x.seat);
  eq(seats, ["south", "west", "north"], "不含 east");
});

test("荣和：只有放铳者一行", () => {
  const r = makeResult({
    basePayments: [{ seat: "north", value: 8000 }],
    finalPayments: [{ seat: "north", value: 8000 }],
  });
  eq(buildPaymentRows(r).map((x) => x.seat), ["north"], "只有 north");
});

test("行序固定为东南西北（不随输入顺序变）", () => {
  const r = makeResult({
    finalPayments: [
      { seat: "north", value: 1 },
      { seat: "east", value: 1 },
      { seat: "west", value: 1 },
    ],
  });
  eq(buildPaymentRows(r).map((x) => x.seat), ["east", "west", "north"], "东南西北");
});

test("没有任何支付时返回空数组", () => {
  eq(buildPaymentRows(makeResult({})), [], "空");
});

// ============================================================
console.log("\n【4】本场合计");
// ============================================================

test("荣和：本场合计 = 300 × 本场数", () => {
  const r = makeResult({ honbaPayments: [{ seat: "west", value: 900 }] });
  ok(honbaTotal(r) === 900, `实际 ${honbaTotal(r)}`);
});

test("自摸：三家各 100，合计也是 300 × 本场数", () => {
  const r = makeResult({
    honbaPayments: [
      { seat: "south", value: 200 },
      { seat: "west", value: 200 },
      { seat: "north", value: 200 },
    ],
  });
  ok(honbaTotal(r) === 600, `实际 ${honbaTotal(r)}`);
});

test("无本场时为 0", () => {
  ok(honbaTotal(makeResult({})) === 0, "应为 0");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

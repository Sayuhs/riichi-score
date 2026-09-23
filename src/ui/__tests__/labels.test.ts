/**
 * `labels.ts` 的测试。
 *
 * ## 为什么补这个
 *
 * 组件审计发现：**`labels.ts` 整个文件零测试覆盖** ——
 * 没有任何测试文件 import 过它。而它里面装着有对错之分的规则，
 * 特别是 `tierLabel` 的满贯阈值。
 *
 * 这些阈值直接决定结果页顶上显示「满贯」还是「跳满」还是空白，
 * 算错了用户会照着错的档位去收钱。
 *
 * ## 阈值的依据
 *
 * 基本点 = 符 × 2^(番+2)，上限 2000（满贯）。
 * 所以「几番几符到底算不算满贯」是算出来的，不是拍的：
 *   3 番 60 符 = 60 × 32 = 1920  → 不满贯
 *   3 番 70 符 = 70 × 32 = 2240  → 超过上限，满贯
 *   4 番 30 符 = 30 × 64 = 1920  → 不满贯
 *   4 番 40 符 = 40 × 64 = 2560  → 超过上限，满贯
 */
import {
  fuReasonLabel,
  limitLabel,
  seatLabel,
  tierLabel,
  yakuLabel,
} from "../labels.ts";

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

// ============================================================
console.log("\n【1】tierLabel：番数阈值");
// ============================================================

test("13 番以上是数え役满", () => {
  eq(tierLabel(13, 30), "数え役满", "13 番");
  eq(tierLabel(20, 30), "数え役满", "20 番");
});

test("11~12 番是三倍满", () => {
  eq(tierLabel(11, 30), "三倍满", "11 番");
  eq(tierLabel(12, 30), "三倍满", "12 番");
});

test("8~10 番是倍满", () => {
  eq(tierLabel(8, 30), "倍满", "8 番");
  eq(tierLabel(10, 30), "倍满", "10 番");
});

test("6~7 番是跳满", () => {
  eq(tierLabel(6, 30), "跳满", "6 番");
  eq(tierLabel(7, 30), "跳满", "7 番");
});

test("5 番是满贯（不看符数）", () => {
  eq(tierLabel(5, 30), "满贯", "5 番 30 符");
  eq(tierLabel(5, 110), "满贯", "5 番 110 符");
});

// ============================================================
console.log("\n【2】tierLabel：4 番 / 3 番的符数边界（算出来的，不是拍的）");
// ============================================================

test("4 番 40 符是满贯（40×64 = 2560 > 2000）", () => {
  eq(tierLabel(4, 40), "满贯", "4 番 40 符");
});

test("4 番 30 符不是满贯（30×64 = 1920 ≤ 2000）", () => {
  eq(tierLabel(4, 30), "", "4 番 30 符");
});

test("3 番 70 符是满贯（70×32 = 2240 > 2000）", () => {
  eq(tierLabel(3, 70), "满贯", "3 番 70 符");
});

test("3 番 60 符不是满贯（60×32 = 1920 ≤ 2000）", () => {
  eq(tierLabel(3, 60), "", "3 番 60 符");
});

test("低于 3 番一律不满贯", () => {
  eq(tierLabel(2, 110), "", "2 番 110 符");
  eq(tierLabel(1, 110), "", "1 番 110 符");
});

// ============================================================
console.log("\n【3】tierLabel：有 limit 时优先用 limit");
// ============================================================

test("传了 limit 就直接用 limit 的标签", () => {
  // 役满时 han 是 0，不能靠番数判断
  ok(tierLabel(0, 30, "yakuman").length > 0, "役满应有标签");
  eq(tierLabel(5, 30, "mangan"), limitLabel("mangan"), "满贯用 limit");
});

test("limit 优先于番数（避免役满被显示成「数え役满」）", () => {
  const withLimit = tierLabel(13, 30, "yakuman");
  const withoutLimit = tierLabel(13, 30);
  ok(withLimit !== withoutLimit, "有 limit 时结果应不同");
});

// ============================================================
console.log("\n【4】其余标签函数：未知输入要有兜底，不能返回 undefined");
// ============================================================

test("seatLabel 四个座位都有中文", () => {
  for (const s of ["east", "south", "west", "north"] as const) {
    const label = seatLabel(s);
    ok(typeof label === "string" && label.length > 0, `${s} 应有标签，实际 ${label}`);
  }
});

test("yakuLabel 未知役种名要回退到原标题，而不是 undefined", () => {
  const unknown = "某个不存在的役";
  const label = yakuLabel(unknown);
  ok(typeof label === "string", "应是字符串");
  ok(label.length > 0, "不该是空串");
});

test("yakuLabel 常见役种有中文名", () => {
  ok(yakuLabel("riichi").length > 0, "立直");
  ok(yakuLabel("tanyao").length > 0, "断幺九");
});

test("fuReasonLabel 未知原因要回退到原字符串", () => {
  const label = fuReasonLabel("some_unknown_reason");
  ok(typeof label === "string" && label.length > 0, "不该是空串");
});

test("limitLabel 未知 limit 要回退，不能是 undefined", () => {
  const label = limitLabel("something-weird");
  ok(typeof label === "string", "应是字符串");
  ok(label !== undefined, "不该是 undefined");
});

test("limitLabel 接受 undefined（未达满贯时）", () => {
  const label = limitLabel(undefined);
  ok(typeof label === "string", "应是字符串");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

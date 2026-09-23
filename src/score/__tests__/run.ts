/**
 * 极简测试运行器。
 *
 * 为什么不用 vitest / node:test：当前沙箱**禁止 spawn 子进程**（EPERM），
 * 而 vitest 的 tinypool、node:test 的 runner、esbuild 的 service 全都依赖
 * spawn。所以这里自己写一个零依赖的 runner，直接 node 跑，不 fork 任何东西。
 *
 * 用法：node --experimental-strip-types src/score/__tests__/run.ts
 */
import { honbaPayments, isDealer, mergePayments, riichiBonus, sumPayments } from "../honba.ts";

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
  if (a !== b) throw new Error(`${label}期望 ${b}，实际 ${a}`);
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

// ---------------------------------------------------------------- isDealer
console.log("\nisDealer");
test("east 是亲家", () => {
  ok(isDealer({ seatWind: "east" }), "east ");
  ok(!isDealer({ seatWind: "south" }));
  ok(!isDealer({ seatWind: "west" }));
  ok(!isDealer({ seatWind: "north" }));
});

// ----------------------------------------------------------- honbaPayments
console.log("\nhonbaPayments —— 本场数");
test("honba=0 无额外支付", () => {
  eq(honbaPayments(0, { winType: "ron", seatWind: "south", from: "west" }), []);
});
test("荣和：每本场 300 点由放铳者独付", () => {
  eq(honbaPayments(1, { winType: "ron", seatWind: "south", from: "west" }), [
    { seat: "west", value: 300 },
  ]);
  eq(honbaPayments(3, { winType: "ron", seatWind: "south", from: "west" }), [
    { seat: "west", value: 900 },
  ]);
});
test("亲家荣和也是 300 点/本", () => {
  eq(honbaPayments(2, { winType: "ron", seatWind: "east", from: "north" }), [
    { seat: "north", value: 600 },
  ]);
});
test("自摸：每本场每家 100 点", () => {
  eq(honbaPayments(2, { winType: "tsumo", seatWind: "south" }), [
    { seat: "east", value: 200 },
    { seat: "west", value: 200 },
    { seat: "north", value: 200 },
  ]);
});
test("亲家自摸也是每家 100 点/本（天凤不翻倍）", () => {
  eq(honbaPayments(1, { winType: "tsumo", seatWind: "east" }), [
    { seat: "south", value: 100 },
    { seat: "west", value: 100 },
    { seat: "north", value: 100 },
  ]);
});
test("自摸不会向和牌者自己收钱", () => {
  const seats = honbaPayments(1, { winType: "tsumo", seatWind: "west" }).map((x) => x.seat);
  ok(!seats.includes("west"), "应排除 west ");
});
test("负数/非整数/缺 from 安全返回空", () => {
  eq(honbaPayments(-1, { winType: "ron", seatWind: "south", from: "west" }), []);
  eq(honbaPayments(1.5, { winType: "ron", seatWind: "south", from: "west" }), []);
  eq(honbaPayments(2, { winType: "ron", seatWind: "south" }), []);
});

// -------------------------------------------------------------- riichiBonus
console.log("\nriichiBonus —— 立直棒");
test("每根 1000 点", () => {
  eq(riichiBonus(0), 0);
  eq(riichiBonus(1), 1000);
  eq(riichiBonus(3), 3000);
});
test("负数/非整数安全返回 0", () => {
  eq(riichiBonus(-2), 0);
  eq(riichiBonus(1.5), 0);
});

// ------------------------------------------------------------ mergePayments
console.log("\nmergePayments");
test("同一座位相加", () => {
  eq(mergePayments([{ seat: "west", value: 1300 }], [{ seat: "west", value: 300 }]), [
    { seat: "west", value: 1600 },
  ]);
});
test("不同座位保留并保持固定顺序", () => {
  eq(
    mergePayments(
      [
        { seat: "east", value: 1000 },
        { seat: "west", value: 500 },
      ],
      [{ seat: "north", value: 500 }],
    ),
    [
      { seat: "east", value: 1000 },
      { seat: "west", value: 500 },
      { seat: "north", value: 500 },
    ],
  );
});
test("空输入返回空", () => {
  eq(mergePayments([], []), []);
});

// -------------------------------------------------------------- sumPayments
console.log("\nsumPayments");
test("求和", () => {
  eq(sumPayments([{ seat: "west", value: 1300 }]), 1300);
  eq(sumPayments([]), 0);
});

// ------------------------------------------------------------------ 汇总
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

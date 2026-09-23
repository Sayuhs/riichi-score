/**
 * M1 回归测试 —— 把调研中发现的真实 bug 与规则差异固化成守卫。
 *
 * 这里每一条都对应一个**实测发现**，不是凭空写的期望值。
 * 以后改代码若碰坏任何一条，都会立刻在这里亮红灯。
 */
import { score } from "../index.ts";
import { scoreWithRiichiScore } from "../engine-riichi-score.ts";
import { scoreWithSacckey } from "../engine-sacckey.ts";
import type { HandInput, WinContext } from "../types.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      throw new Error("异步测试请用 testAsync");
    }
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
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

function eq(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

const baseCtx = (over: Partial<WinContext> = {}): WinContext => ({
  roundWind: "east",
  seatWind: "south",
  winType: "ron",
  from: "west",
  honba: 0,
  riichiSticks: 0,
  ...over,
});

// ============================================================
console.log("\n【1】高点法补全 —— 引擎排序不完整的真实 bug");
// ============================================================
// 清一色 11223345678999m + 9m 有两个合法解读：
//   11番30符 / 12番20符，基本点都是 6000（三倍满）
// riichi-score 原生只按 basicPoints 排序，会给出 11 番（错的）
// 正确的高点法：基本点相同 → 比番数 → 应取 12 番
test("清一色双解读取 12 番而非 11 番", () => {
  const r = scoreWithRiichiScore({
    concealed: ["1m","2m","3m","1m","2m","3m","4m","5m","6m","7m","8m","9m","9m"],
    melds: [],
    winningTile: "9m",
    context: baseCtx({ winType: "tsumo", isRiichi: true }),
  });
  ok(r.ok, "应当能算出结果 ");
  if (!r.ok) return;
  eq(r.score.han, 12, "番数应为 12（高点法）");
  eq(r.score.fu, 20, "符数应为 20");
  eq(r.score.basicPoints, 6000, "基本点应为 6000（三倍满）");
});

// ============================================================
console.log("\n【2】本场数 / 立直棒 —— 引擎完全缺失，由外层补算");
// ============================================================
// 用一手便宜且役种稳定的牌来测 honba：立直+平和+断幺 3番30符 子家荣和 = 3900。
// （不要用范围大的牌，否则会撞上三倍满，把 honba 的效果淹没掉）
const cheapHand = (over: Partial<WinContext> = {}): HandInput => ({
  concealed: ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"],
  melds: [],
  winningTile: "5m",
  context: baseCtx({ isRiichi: true, ...over }),
});

await testAsync("基线：立直+平和+断幺 3番30符 子家荣和 = 3900", async () => {
  const r = await score(cheapHand());
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.han, 3, "番数");
  eq(r.fu, 30, "符数");
  eq(r.basePayments, [{ seat: "west", value: 3900 }], "基础支付");
  eq(r.total, 3900, "总收入");
});

await testAsync("荣和：每本场 300 点由放铳者独付", async () => {
  const r = await score(cheapHand({ honba: 2 }));
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.basePayments, [{ seat: "west", value: 3900 }], "基础支付不受本场影响");
  eq(r.honbaPayments, [{ seat: "west", value: 600 }], "本场支付 2×300");
  eq(r.finalPayments, [{ seat: "west", value: 4500 }], "最终支付 3900+600");
  eq(r.total, 4500, "和牌者总收入");
});

await testAsync("立直棒 3 根 → 和牌者多得 3000", async () => {
  const r = await score(cheapHand({ riichiSticks: 3 }));
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.riichiBonus, 3000, "立直棒收入");
  eq(r.total, 3900 + 3000, "总收入 = 支付 + 立直棒");
});

await testAsync("本场与立直棒同时存在", async () => {
  const r = await score(cheapHand({ honba: 1, riichiSticks: 2 }));
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.honbaPayments, [{ seat: "west", value: 300 }], "本场 1×300");
  eq(r.riichiBonus, 2000, "立直棒 2×1000");
  eq(r.total, 3900 + 300 + 2000, "总收入 6200");
});

await testAsync("自摸：每本场每家 100 点", async () => {
  const r = await score(cheapHand({ winType: "tsumo", honba: 1 }));
  ok(!("error" in r));
  if ("error" in r) return;
  eq(
    r.honbaPayments,
    [
      { seat: "east", value: 100 },
      { seat: "west", value: 100 },
      { seat: "north", value: 100 },
    ],
    "每本场每家 100",
  );
});

// ============================================================
console.log("\n【3】经典点数表 —— 与公开点数表逐格比对");
// ============================================================
await testAsync("立直+平和+断幺+门清自摸 4番20符 子家自摸", async () => {
  // 注意两点：
  //  1. 自摸会多「门前清自摸和」1 番，所以是 4 番而非 3 番
  //  2. 这手是**两面听 + 平和**，自摸时不计「门清荣和 +10 符」，
  //     所以是 20 符而非 30 符 —— 这就是经典的「平和自摸 20 符」
  const r = await score(cheapHand({ winType: "tsumo" }));
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.han, 4, "番数（立直1+平和1+断幺1+门清自摸1）");
  eq(r.fu, 20, "符数：平和自摸 = 20 符");
  eq(r.basicPoints, 1280, "基本点 20×2^6 = 1280");
  // 4番20符 子家自摸：亲 2600 / 闲各 1300，合计 5200
  eq(r.total, 5200, "子家自摸总收入");
});

await testAsync("同手牌改为荣和则为 3番30符（门清荣和 +10 符）", async () => {
  const r = await score(cheapHand());
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.han, 3, "番数（无自摸）");
  eq(r.fu, 30, "符数：平和荣和 = 20 底 + 门清荣和 10");
  eq(r.basicPoints, 960, "基本点 30×2^5 = 960");
});

// ============================================================
console.log("\n【4】规则默认值 —— 天凤基准（与 sacckey 的差异根源）");
// ============================================================
test("四暗刻単騎 默认单倍役满（天凤规则）", () => {
  const r = scoreWithRiichiScore({
    concealed: ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9m"],
    melds: [],
    winningTile: "9m",
    context: baseCtx(),
  });
  ok(r.ok);
  if (!r.ok) return;
  eq(r.score.basicPoints, 8000, "天凤默认单倍役满 = 8000");
  eq(r.score.limit, "yakuman", "limit 标签");
});

test("打开 doubleYakuman.suuankouTanki → 16000", () => {
  const r = scoreWithRiichiScore({
    concealed: ["1m","1m","1m","5p","5p","5p","7s","7s","7s","3z","3z","3z","9m"],
    melds: [],
    winningTile: "9m",
    context: baseCtx({ ruleset: { doubleYakuman: { suuankouTanki: true } } }),
  });
  ok(r.ok);
  if (!r.ok) return;
  eq(r.score.basicPoints, 16000, "开关打开后翻倍");
  eq(r.score.limit, "double-yakuman", "limit 标签");
});

test("国士無双13面待ち 默认也是单倍（天凤规则）", () => {
  const r = scoreWithRiichiScore({
    concealed: ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z"],
    melds: [],
    winningTile: "1m",
    context: baseCtx(),
  });
  ok(r.ok);
  if (!r.ok) return;
  eq(r.score.basicPoints, 8000, "天凤默认单倍");
});

test("复合役满正常叠加：字一色 + 四暗刻 = 2 倍", () => {
  const r = scoreWithRiichiScore({
    concealed: ["1z","1z","1z","2z","2z","2z","5z","5z","5z","6z","6z","6z","7z"],
    melds: [],
    winningTile: "7z",
    context: baseCtx(),
  });
  ok(r.ok);
  if (!r.ok) return;
  eq(r.score.basicPoints, 16000, "两个不同役满 = 2 倍 = 16000");
  eq(r.score.limit, "double-yakuman", "limit 标签");
});

// ============================================================
console.log("\n【5】食断开关 —— 与规则基准的一致性");
// ============================================================
// 副露 234s，其余全 2-8。注意要凑成「三色不同顺」避免撞上三色同顺，
// 否则关掉食断后仍有役，就测不出开关效果了。
const kuitanInput = (openTanyao: boolean): HandInput => ({
  concealed: ["2m","3m","4m","5m","6m","7m","3p","4p","5p","6s"],
  melds: [{ type: "run", tiles: ["2s","3s","4s"], from: "east", calledIndex: 0 }],
  winningTile: "6s",
  context: baseCtx({ ruleset: { openTanyao } }),
});

test("食断开（天凤默认）→ 断幺成立", () => {
  const r = scoreWithRiichiScore(kuitanInput(true));
  ok(r.ok, "应当是有役的 ");
  if (!r.ok) return;
  ok(r.score.yaku.some((y) => y.name === "tanyao"), "应含断幺 ");
});

test("食断关 → 无役被拒", () => {
  const r = scoreWithRiichiScore(kuitanInput(false));
  eq(r.ok, false, "应当被拒绝");
  if (r.ok) return;
  eq(r.error.kind, "no-yaku", "错误类型");
});

// ============================================================
console.log("\n【6】手动覆盖 —— 逃生舱（包 / 双响 / 库不支持时）");
// ============================================================
// 这手牌是「副露全 2-8 但食断关掉」，即真正无役可和的场面
const noYakuInput = (over: Partial<WinContext> = {}): HandInput => ({
  concealed: ["2m","3m","4m","5m","6m","7m","3p","4p","5p","6s"],
  melds: [{ type: "run", tiles: ["2s","3s","4s"], from: "east", calledIndex: 0 }],
  winningTile: "6s",
  context: baseCtx({ ruleset: { openTanyao: false }, ...over }),
});

await testAsync("无役时给手动覆盖仍能出结果", async () => {
  // 先确认确实无役
  const plain = await score(noYakuInput());
  ok("error" in plain, "无覆盖时应报错 ");
  if (!("error" in plain)) return;
  eq(plain.error.kind, "no-yaku", "错误类型应为 no-yaku");
  if (plain.error.kind !== "no-yaku") return;
  ok(plain.error.message.includes("no yaku"), "错误信息应说明无役 ");

  // 再给覆盖
  const overridden = await score(noYakuInput(), { override: { han: 2, fu: 40, yakuNote: "手动" } });
  ok(!("error" in overridden), "有覆盖时应出结果 ");
  if ("error" in overridden) return;
  eq(overridden.overridden, true, "应标记 overridden");
  eq(overridden.han, 2, "番");
  eq(overridden.fu, 40, "符");
  eq(overridden.basicPoints, 640, "基本点 40×2^4");
  // 2番40符 子家荣和 = 2600
  eq(overridden.total, 2600, "总收入");
});

await testAsync("手动覆盖也能叠加本场与立直棒", async () => {
  const r = await score(noYakuInput({ honba: 1, riichiSticks: 2 }), {
    override: { han: 1, fu: 40 },
  });
  ok(!("error" in r));
  if ("error" in r) return;
  // 1番40符 子家荣和 = 1300；本场 1 → +300；立直棒 2 → +2000
  eq(r.total, 1300 + 300 + 2000, "总收入 3600");
});

await testAsync("手动覆盖只给 total 时直接照用", async () => {
  const r = await score(noYakuInput(), { override: { total: 12345, yakuNote: "大三元被包" } });
  ok(!("error" in r));
  if ("error" in r) return;
  eq(r.total, 12345, "直接采用给定总值");
  eq(r.yaku[0]?.name, "大三元被包", "备注保留");
});

// ============================================================
console.log("\n【7】双库一致 —— 非役满手牌必须完全一致");
// ============================================================
const agreementShapes: { name: string; concealed: string[]; winning: string }[] = [
  { name: "立直平和断幺", concealed: ["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"], winning: "5m" },
  { name: "七对子", concealed: ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z"], winning: "7z" },
  { name: "三色同顺", concealed: ["2m","3m","4m","2p","3p","4p","2s","3s","4s","7m","7m","9m","9m"], winning: "7m" },
  { name: "一气通贯", concealed: ["1m","2m","3m","4m","5m","6m","7m","8m","9m","5z","5z","1p","1p"], winning: "1p" },
  { name: "混一色", concealed: ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1m","1m","5z","5z"], winning: "5z" },
  { name: "纯全带幺九", concealed: ["1m","2m","3m","7m","8m","9m","1p","2p","3p","9s","9s","1z","1z"], winning: "9s" },
  { name: "小三元", concealed: ["5z","5z","5z","6z","6z","6z","7z","7z","1m","2m","3m","4p","4p"], winning: "4p" },
];

for (const shape of agreementShapes) {
  await testAsync(`两库一致：${shape.name}`, async () => {
    for (const seatWind of ["east", "south"] as const) {
      for (const winType of ["ron", "tsumo"] as const) {
        const input: HandInput = {
          concealed: shape.concealed,
          melds: [],
          winningTile: shape.winning,
          context: baseCtx({
            seatWind,
            winType,
            ...(winType === "ron" ? { from: "west" as const } : {}),
            isRiichi: true,
          }),
        };
        const a = scoreWithRiichiScore(input);
        const b = await scoreWithSacckey(input);
        ok(a.ok, `riichi-score 应成功 (${seatWind}/${winType}) `);
        ok(b.ok, `sacckey 应成功 (${seatWind}/${winType}) `);
        if (!a.ok || !b.ok) continue;
        eq(
          { han: b.score.han, basic: b.score.basicPoints },
          { han: a.score.han, basic: a.score.basicPoints },
          `${shape.name} ${seatWind}/${winType} 两库应一致`,
        );
      }
    }
  });
}

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

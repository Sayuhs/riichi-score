/**
 * M3 测试：局面校验 + M2→M1 接缝。
 *
 * 这一层是两半输入的接缝，出错会导致「手牌看着对、却算不出结果」，
 * 而且错因很难查 —— 所以边界要覆盖密。
 */
import {
  addMeld,
  addTile,
  createEmptyHand,
  type HandState,
} from "../hand-state.ts";
import {
  createDefaultGameState,
  isDealer,
  KAMICHA,
  validateGameState,
  type GameState,
} from "../game-state.ts";
import { buildHandInput, toEngineMelds } from "../build-input.ts";
import { score } from "../../score/index.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
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

/** 立直+平和+断幺 的门清 13 张 + 和牌张 5m */
const RIICHI_PINFU_TANYAO = [
  "2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m",
];

function handWith(tiles: string[], winning: string): HandState {
  let s = createEmptyHand();
  for (const t of [...tiles, winning]) s = addTile(s, t);
  return s;
}

const game = (over: Partial<GameState> = {}): GameState => ({
  ...createDefaultGameState(),
  ...over,
});

// ============================================================
console.log("\n【1】局面默认值（天凤基准）");
// ============================================================
await test("默认是东场南家，荣和", () => {
  const g = createDefaultGameState();
  eq(g.roundWind, "east", "场风");
  eq(g.seatWind, "south", "自风");
  eq(g.winType, "ron", "和了方式");
  eq(g.honba, 0, "本场");
  eq(g.riichiSticks, 0, "立直棒");
});

await test("规则开关默认是天凤（食断开、切上满贯关、赤牌各1）", () => {
  const r = createDefaultGameState().ruleset;
  eq(r.openTanyao, true, "食断开");
  eq(r.kiriageMangan, false, "切上满贯关");
  eq(r.kazoeYakuman, true, "数え役満开");
  eq(r.akaDora, { manzu: 1, pinzu: 1, souzu: 1 }, "赤牌各 1");
  eq(r.doubleYakuman, {
    daisuushii: false, kokushi13Wait: false, suuankouTanki: false, junseiChuuren: false,
  }, "双倍役满默认全关");
});

await test("isDealer 判定", () => {
  ok(isDealer({ seatWind: "east" }), "east 是亲 ");
  ok(!isDealer({ seatWind: "south" }), "south 不是亲 ");
});

await test("上家映射正确（chi 只能来自上家）", () => {
  eq(KAMICHA.east, "north", "东家的上家是北");
  eq(KAMICHA.south, "east", "南家的上家是东");
  eq(KAMICHA.west, "south", "西家的上家是南");
  eq(KAMICHA.north, "west", "北家的上家是西");
});

// ============================================================
console.log("\n【2】局面校验：不可能的组合");
// ============================================================
await test("荣和时放铳者不能是自己", () => {
  const issues = validateGameState(
    game({ winType: "ron", seatWind: "south", from: "south" }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.some((i) => i.field === "from"), "应报错 ");
});

await test("有副露时不能立直", () => {
  const issues = validateGameState(game({ isRiichi: true }), {
    isMenzen: false,
    meldCount: 1,
  });
  ok(issues.some((i) => i.message.includes("门清")), "应报错 ");
});

await test("一发必须建立在立直上", () => {
  const issues = validateGameState(game({ isIppatsu: true }), {
    isMenzen: true,
    meldCount: 0,
  });
  ok(issues.some((i) => i.message.includes("一发")), "应报错 ");
});

await test("一发与岭上开花互斥（杠会打断一发）", () => {
  const issues = validateGameState(
    game({ isRiichi: true, isIppatsu: true, isRinshan: true, winType: "tsumo" }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.some((i) => i.message.includes("一发")), "应报错 ");
});

await test("岭上开花必须自摸", () => {
  const issues = validateGameState(game({ isRinshan: true, winType: "ron" }), {
    isMenzen: true, meldCount: 0,
  });
  ok(issues.some((i) => i.field === "isRinshan"), "应报错 ");
});

await test("抢杠必须荣和", () => {
  const issues = validateGameState(game({ isChankan: true, winType: "tsumo" }), {
    isMenzen: true, meldCount: 0,
  });
  ok(issues.some((i) => i.field === "isChankan"), "应报错 ");
});

// 这条是 mahjong-calc 交叉验证抓出的真实规则（见 docs/RULES.md §6）
await test("抢杠 + 河底互斥（枪槓的牌不是打出的牌）", () => {
  const issues = validateGameState(
    game({ isChankan: true, isHoutei: true, winType: "ron" }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.some((i) => i.message.includes("河底")), "应报错 ");
});

await test("海底必须自摸、河底必须荣和", () => {
  const a = validateGameState(game({ isHaitei: true, winType: "ron" }), {
    isMenzen: true, meldCount: 0,
  });
  ok(a.some((i) => i.field === "isHaitei"), "海底 ");
  const b = validateGameState(game({ isHoutei: true, winType: "tsumo" }), {
    isMenzen: true, meldCount: 0,
  });
  ok(b.some((i) => i.field === "isHoutei"), "河底 ");
});

await test("天和必须亲家、地和必须闲家", () => {
  const a = validateGameState(
    game({ isTenhou: true, winType: "tsumo", seatWind: "south" }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(a.some((i) => i.message.includes("亲家")), "天和应要求亲家 ");
  const b = validateGameState(
    game({ isChiihou: true, winType: "tsumo", seatWind: "east" }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(b.some((i) => i.message.includes("闲家")), "地和应要求闲家 ");
});

await test("天和不能有副露", () => {
  const issues = validateGameState(
    game({ isTenhou: true, winType: "tsumo", seatWind: "east" }),
    { isMenzen: false, meldCount: 1 },
  );
  ok(issues.some((i) => i.message.includes("副露")), "应报错 ");
});

await test("里宝牌只在立直时翻开", () => {
  const issues = validateGameState(
    game({ isRiichi: false, uradoraIndicators: ["1m"] }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.some((i) => i.field === "uradoraIndicators"), "应报错 ");
});

await test("宝牌指示牌最多 5 张", () => {
  const issues = validateGameState(
    game({ doraIndicators: ["1m", "2m", "3m", "4m", "5m", "6m"] }),
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.some((i) => i.field === "doraIndicators"), "应报错 ");
});

await test("合法局面没有问题", () => {
  const issues = validateGameState(
    game({ isRiichi: true, winType: "tsumo" }),
    { isMenzen: true, meldCount: 0 },
  );
  eq(issues, [], "不该有问题");
});
console.log("\n【4】接缝：buildHandInput");
// ============================================================
await test("手牌不完整时拒绝并说明原因", () => {
  let s = createEmptyHand();
  s = addTile(s, "1m");
  const r = buildHandInput(s, createDefaultGameState());
  eq(r.ok, false, "应拒绝");
  if (r.ok) return;
  ok(r.reason.includes("和牌张"), "应说明缺和牌张 ");
});

await test("门前张数不对时拒绝", () => {
  let s = createEmptyHand();
  for (const t of ["1m", "2m", "3m"]) s = addTile(s, t);
  s = { ...s, winningTile: "9s" };
  const r = buildHandInput(s, createDefaultGameState());
  eq(r.ok, false, "应拒绝");
  if (r.ok) return;
  ok(r.reason.includes("13 张"), "应说明张数不足 ");
});

await test("完整手牌能构造出合法 HandInput", () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const r = buildHandInput(s, game({ isRiichi: true, winType: "tsumo" }));
  eq(r.ok, true, "应成功");
  if (!r.ok) return;
  eq(r.input.concealed.length, 13, "concealed 13 张");
  eq(r.input.winningTile, "5m", "和牌张");
  eq(r.input.context.winType, "tsumo", "和了方式");
  eq(r.input.context.isRiichi, true, "立直");
  eq(r.input.context.honba, 0, "本场");
});

await test("荣和时带上放铳者，自摸时不带", () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const ron = buildHandInput(s, game({ winType: "ron", from: "west" }));
  ok(ron.ok && ron.input.context.from === "west", "荣和应带 from ");
  const tsumo = buildHandInput(s, game({ winType: "tsumo" }));
  ok(tsumo.ok && tsumo.input.context.from === undefined, "自摸不该有 from ");
});

await test("规则开关被透传", () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const g = game({ ruleset: { openTanyao: false, kiriageMangan: true } });
  const r = buildHandInput(s, g);
  ok(r.ok, "应成功");
  if (!r.ok) return;
  eq(r.input.context.ruleset?.openTanyao, false, "食断关");
  eq(r.input.context.ruleset?.kiriageMangan, true, "切上满贯开");
});

// ============================================================
console.log("\n【5】副露映射");
// ============================================================
await test("吃（run）的来源自动补为上家", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  const melds = toEngineMelds(s, "south");
  eq(melds[0]!.type, "run", "类型");
  eq(melds[0]!.from, "east", "南家的上家是东");
});

await test("暗杠没有 from", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["1m", "1m", "1m", "1m"]);
  const melds = toEngineMelds(s, "south");
  eq(melds[0]!.type, "ankan", "类型");
  eq(melds[0]!.from, undefined, "暗杠没有来源");
});

await test("刻子（pon）有 from", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["1m", "1m", "1m"]);
  const melds = toEngineMelds(s, "south");
  eq(melds[0]!.type, "triplet", "类型");
  ok(melds[0]!.from !== undefined, "应有来源 ");
});

// ============================================================
console.log("\n【6】端到端：从录入到算出点数");
// ============================================================
await test("立直+平和+断幺 自摸 → 4番20符", async () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const r = buildHandInput(s, game({ isRiichi: true, winType: "tsumo" }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), "算番成功");
  if ("error" in result) return;

  eq(result.han, 4, "番数（立直1+平和1+断幺1+门清自摸1）");
  eq(result.fu, 20, "符数（平和自摸 20 符）");
  eq(result.total, 5200, "子家自摸总收入");
});

await test("同一手牌改荣和 → 3番30符", async () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const r = buildHandInput(s, game({ isRiichi: true, winType: "ron", from: "west" }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), "算番成功");
  if ("error" in result) return;
  eq(result.han, 3, "番数");
  eq(result.fu, 30, "符数（门清荣和 +10）");
  eq(result.basePayments, [{ seat: "west", value: 3900 }], "放铳者付 3900");
});

await test("本场与立直棒在端到端流程里生效", async () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  const r = buildHandInput(
    s,
    game({ isRiichi: true, winType: "ron", from: "west", honba: 2, riichiSticks: 1 }),
  );
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), "算番成功");
  if ("error" in result) return;
  // 3番30符 子家荣和 = 3900；本场2 → +600；立直棒1 → +1000
  eq(result.honbaPayments, [{ seat: "west", value: 600 }], "本场 2×300");
  eq(result.riichiBonus, 1000, "立直棒");
  eq(result.total, 3900 + 600 + 1000, "总收入 5500");
});

await test("宝牌指示牌影响番数", async () => {
  const s = handWith(RIICHI_PINFU_TANYAO, "5m");
  // 手里有 8s 两张，指示牌 7s → 宝牌 = 8s，共 2 张
  const r = buildHandInput(
    s,
    game({ isRiichi: true, winType: "tsumo", doraIndicators: ["7s"] }),
  );
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), "算番成功");
  if ("error" in result) return;
  eq(result.dora, 2, "宝牌 2 张");
  eq(result.han, 6, "4番+2宝牌=6番（跳满）");
});

await test("有副露的端到端流程（食断 + 三色同顺）", async () => {
  // 副露 234s + 门前 234m 567m 234p + 雀头 66s，和牌张 6s
  //
  // ⚠️ 注意这手牌有**两个**役，不是只有断幺：
  //   - 断幺：全部 2-8
  //   - 三色同顺：234m + 234p + 234s
  // 我一开始把这手写成"只该有断幺 1 番"，结果实测是 2 番。
  // 凑「全 2-8」的牌很容易顺手凑出三色，测试时要留意。
  let s = createEmptyHand();
  s = addMeld(s, ["2s", "3s", "4s"]);
  for (const t of ["2m","3m","4m","5m","6m","7m","2p","3p","4p","6s"]) s = addTile(s, t);
  eq(s.concealed.length, 10, "门前 10 张");

  // 第 11 张自动成为和牌张
  s = addTile(s, "6s");
  eq(s.winningTile, "6s", "和牌张 6s");
  eq(s.concealed.filter((t) => t === "6s").length, 1, "门前的 6s 仍在（和牌张是另一张）");

  const r = buildHandInput(s, game({ winType: "ron", from: "west" }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), `算番成功（实际: ${"error" in result ? result.error.message : ""}）`);
  if ("error" in result) return;
  ok(result.yaku.some((y) => y.name === "tanyao"), "应有断幺 ");
  ok(result.yaku.some((y) => y.name === "sanshoku"), "应有三色同顺 ");
  eq(result.han, 2, "断幺1 + 三色1 = 2 番");
  // 2番30符 子家荣和 = 2000
  eq(result.basePayments, [{ seat: "west", value: 2000 }], "放铳者付 2000");
});

await test("只带食断、不含三色的副露手牌 → 1 番", async () => {
  // 副露 234s + 门前 234m 567m 345p + 雀头 88s，和牌张 8s
  // 用 345p 而不是 234p，避免凑出三色同顺
  let s = createEmptyHand();
  s = addMeld(s, ["2s", "3s", "4s"]);
  for (const t of ["2m","3m","4m","5m","6m","7m","3p","4p","5p","8s"]) s = addTile(s, t);
  s = addTile(s, "8s");

  const r = buildHandInput(s, game({ winType: "ron", from: "west" }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok(!("error" in result), "算番成功");
  if ("error" in result) return;
  eq(result.yaku.map((y) => y.name), ["tanyao"], "只应有断幺");
  eq(result.han, 1, "1 番");
});

await test("副露的 from 被正确补成上家（否则引擎会拒绝）", async () => {
  let s = createEmptyHand();
  s = addMeld(s, ["2s", "3s", "4s"]);
  for (const t of ["2m","3m","4m","5m","6m","7m","2p","3p","4p","6s"]) s = addTile(s, t);
  s = addTile(s, "6s");

  // 南家吃，只能来自东家 —— 引擎会校验这一点
  const r = buildHandInput(s, game({ seatWind: "south", winType: "ron", from: "west" }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;
  eq(r.input.melds![0]!.from, "east", "南家的吃必须来自东家");

  const result = await score(r.input);
  ok(!("error" in result), "引擎接受了上家来源");
});

await test("无役的手牌返回中文错误", async () => {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  for (const t of ["1m","2m","3m","4m","5m","6m","1p","2p","3p","1z"]) s = addTile(s, t);
  s = addTile(s, "1z");

  const r = buildHandInput(s, game({ winType: "ron", from: "west", ruleset: { openTanyao: false } }));
  ok(r.ok, "构造成功");
  if (!r.ok) return;

  const result = await score(r.input);
  ok("error" in result, "应报错");
  if (!("error" in result)) return;
  eq(result.error.kind, "no-yaku", "错误类型是 no-yaku");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

/**
 * 录入完成时「预检」的测试。
 *
 * ## 这一组守住的是**不要把用户卡死**
 *
 * 「有没有役」取决于场况，不是牌型本身的性质。同一手门清牌：
 *   荣和 + 不立直 → 无役
 *   勾立直       → 有役
 *
 * 如果只要「当前场况无役」就禁用「下一步」，用户永远进不去场况页，
 * 也就永远勾不上立直 —— 那手牌直接卡死。而现实中「无役」绝大多数
 * 恰恰就是忘了勾立直。
 *
 * 所以三档的分界必须准确：
 *   ok            → 不打扰
 *   context-hint  → **允许下一步**，只提示「记得勾立直」
 *   hopeless      → 才拦住，要求换牌
 */
import { addMeld, addTile, createEmptyHand, type HandState } from "../hand-state.ts";
import { createDefaultGameState, type GameState } from "../game-state.ts";
import { precheckBlocks, precheckHand } from "../hand-precheck.ts";

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

function baseGame(part: Partial<GameState> = {}): GameState {
  return { ...createDefaultGameState(), ...part };
}

/** 门清无役：123m + 456m + 789p + 234s + 99s（和 9s，单骑听） */
const MENZEN_NO_YAKU = [
  "1m","2m","3m","4m","5m","6m","7p","8p","9p","2s","3s","4s","9s",
];

// ============================================================
console.log("\n【1】没录完 → idle（不打扰、不算）");
// ============================================================

await test("只录了 5 张 → idle", async () => {
  const hand = feed(createEmptyHand(), ["1m","2m","3m","1p","2p"]);
  const r = await precheckHand(hand, baseGame(), { isMenzen: true });
  eq(r.kind, "idle", "应 idle");
  eq(r.text, "", "文案应为空");
});

await test("录满但没设和牌张 → idle", async () => {
  const hand = feed(createEmptyHand(), MENZEN_NO_YAKU);
  // concealed 13 张，winningTile 还是 null
  eq(hand.winningTile, null, "前置：还没有和牌张");
  const r = await precheckHand(hand, baseGame(), { isMenzen: true });
  eq(r.kind, "idle", "应 idle");
});

// ============================================================
console.log("\n【2】当前场况就有役 → ok（不打扰）");
// ============================================================

await test("勾了立直 → ok", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const r = await precheckHand(hand, baseGame({ isRiichi: true }), { isMenzen: true });
  eq(r.kind, "ok", "有役就不该提示");
  eq(r.text, "", "不该有文案");
});

// ============================================================
console.log("\n【3】★ 当前没役但勾立直就有 → context-hint（**必须放行**）");
// ============================================================

await test("门清 + 荣和 + 不立直 → context-hint，不是 hopeless", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const r = await precheckHand(hand, baseGame(), { isMenzen: true });

  eq(r.kind, "context-hint", "这种牌必须放行，拦住就卡死了");
  ok(r.text.includes("立直"), `提示应点名立直，实际：${r.text}`);
  ok(r.swaps.length === 0, "不必给换牌建议（勾立直就行）");
  console.log(`        （${r.text}）`);
});

await test("★ 这一档绝对不能是 hopeless —— 那是「卡死用户」的 bug", async () => {
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const r = await precheckHand(hand, baseGame(), { isMenzen: true });
  ok(r.kind !== "hopeless", "门清手牌勾立直就有役，不该被拦");
});

await test("自摸就能有役时也算 context-hint", async () => {
  // 副露了（立直不成立），但自摸可能有役 —— 用门清牌但假装有暗杠
  const hand = feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]);
  const r = await precheckHand(hand, baseGame({ winType: "ron" }), { isMenzen: false });
  // isMenzen=false → 立直不可用；若自摸也救不了，就看是不是 hopeless
  ok(
    r.kind === "context-hint" || r.kind === "hopeless",
    `应是这两档之一，实际 ${r.kind}`,
  );
});

// ============================================================
console.log("\n【4】真的没役 → hopeless（拦住 + 给换牌建议）");
// ============================================================

await test("有副露、无役牌 → hopeless", async () => {
  // 111m(碰) + 345p + 678p + 234s + 99s
  // 有幺九 → 不是断幺九；没役牌；非门清 → 立直/平和/一盃口全不成立
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  hand = feed(hand, ["3p","4p","5p","6p","7p","8p","2s","3s","4s","9s"]);
  hand = addTile(hand, "9s");

  const r = await precheckHand(hand, baseGame(), { isMenzen: false });
  eq(r.kind, "hopeless", "试遍场况都没役，才该拦");
  ok(r.text.length > 0, "应有文案");
  ok(r.text.includes("没有役"), `文案应说明没役，实际：${r.text}`);
  console.log(`        （${r.text}，换牌建议 ${r.swaps.length} 条）`);
});

await test("hopeless 时文案非空（提示条不能空着）", async () => {
  let hand = createEmptyHand();
  hand = addMeld(hand, ["1m","1m","1m"]);
  hand = feed(hand, ["3p","4p","5p","6p","7p","8p","2s","3s","4s","9s"]);
  hand = addTile(hand, "9s");

  const r = await precheckHand(hand, baseGame(), { isMenzen: false });
  ok(typeof r.text === "string" && r.text.length > 0, "文案不该为空");
});

// ============================================================
console.log("\n【5】不给用户添乱");
// ============================================================

await test("★ 牌形不成立 → invalid-shape（拦住，别让用户白走到算番）", async () => {
  // 14 张，但凑不成「4 组面子 + 1 对雀头」：每条花色都是「隔一张」的孤张
  const hand = feed(
    createEmptyHand(),
    ["1m","2m","4m","6m","8m","3p","5p","7p","9p","2s","4s","6s","8s"],
  );
  const withWin = addTile(hand, "1z");
  const r = await precheckHand(withWin, baseGame(), { isMenzen: true });
  eq(r.kind, "invalid-shape", "牌形不成立该由预检拦下");
  ok(r.text.includes("牌形"), `文案应说明是牌形问题，实际：${r.text}`);
  ok(precheckBlocks(r.kind), "这一档必须拦住「下一步」");
  console.log(`        （${r.text}，换牌建议 ${r.swaps.length} 条）`);
});

await test("★ 牌形不成立时给出的换牌建议，换完必须真的能和牌", async () => {
  // 用户报的原案：吃 345p + 碰 888p + 门前 1m1m2m3m5m6m7m + 和牌张 6s
  // 旧版会给「把 1万 换成 6条」—— 换完牌形成立，但**依然无役**，白改一遍。
  let hand = createEmptyHand();
  hand = addMeld(hand, ["3p", "4p", "5p"]);
  hand = addMeld(hand, ["8p", "8p", "8p"]);
  hand = feed(hand, ["1m", "1m", "2m", "3m", "5m", "6m", "7m"]);
  hand = addTile(hand, "6s");

  const r = await precheckHand(hand, baseGame(), { isMenzen: false });
  eq(r.kind, "invalid-shape", "这手牌牌形不成立");

  if (r.swaps.length) {
    for (const s of r.swaps) {
      ok(s.yaku.length > 0, `建议「${s.from} → ${s.to}」必须列出成立的役`);
      ok(s.han > 0, `建议「${s.from} → ${s.to}」必须有番数`);
    }
    console.log(`        （${r.swaps.length} 条建议，全部带役）`);
  } else {
    // 这手牌换单张确实救不回来（门前和和牌张怎么换都缺役）——
    // 那也必须**明说**，而不是塞一条假建议
    ok(r.text.includes("救不回来"), `无建议时要说明，实际：${r.text}`);
  }
});

await test("任何档位的 text 都是字符串（固定高度契约）", async () => {
  const cases: [HandState, GameState, boolean][] = [
    [createEmptyHand(), baseGame(), true],
    [feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]), baseGame(), true],
    [feed(createEmptyHand(), [...MENZEN_NO_YAKU, "9s"]), baseGame({ isRiichi: true }), true],
  ];
  for (const [h, g, m] of cases) {
    const r = await precheckHand(h, g, { isMenzen: m });
    ok(typeof r.text === "string", "text 不是字符串");
    ok(
      ["idle", "ok", "context-hint", "hopeless", "invalid-shape"].includes(r.kind),
      `kind 非法：${r.kind}`,
    );
  }
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

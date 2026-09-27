/**
 * 「手牌不成立」诊断的测试。
 *
 * ## 这一组在防什么
 *
 * 牌形不成立时引擎只吐一句英文，用户看完还是不知道该改什么。
 * 这个诊断要给出**确定性的**具体问题：
 *
 *   1. 换哪一张牌就成立了（牌形错误通常就是打错一张）
 *   2. 某张牌超过 4 张 —— 特别是**宝牌指示牌和手牌撞牌**这种
 *      用户完全想不到的错因
 *   3. 尽力分解后报出「凑出几组、剩哪几张」
 *
 * ⚠️ 这里有一个我踩过的坑，专门写了测试守住：
 *    「把和牌张与门前某张互换」是**无效**的诊断 —— 互换不改变 14 张的多重集，
 *    引擎给的答案必然一样，那个循环永远不会命中。
 *    必须**替换成别的牌面**才真的改变多重集。
 */
import { addTile, createEmptyHand, type HandState } from "../hand-state.ts";
import { createDefaultGameState, type GameState } from "../game-state.ts";
import { buildHandInput } from "../build-input.ts";
import { score } from "../../score/index.ts";
import { diagnoseInvalidHand } from "../invalid-hand-advice.ts";

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

function feed(state: HandState, tiles: string[]): HandState {
  let s = state;
  for (const t of tiles) s = addTile(s, t);
  return s;
}

function baseGame(part: Partial<GameState> = {}): GameState {
  return { ...createDefaultGameState(), ...part };
}

/** 前置确认：这手牌确实算出「牌型不成立」 */
async function assertInvalid(hand: HandState, game: GameState): Promise<void> {
  const built = buildHandInput(hand, game);
  ok(built.ok, `输入应能构造：${built.ok ? "" : built.reason}`);
  if (!built.ok) return;
  const r = await score(built.input);
  ok(
    "error" in r && r.error.kind === "invalid-hand",
    `应当是「牌型不成立」，实际：${
      "error" in r ? r.error.kind : "算出来了（说明牌形其实成立）"
    }`,
  );
}

// ============================================================
console.log("\n【1】换和牌张就能成立（最常见的录错方式）");
// ============================================================

// 正确牌形：123m 456m 789m 123p 99s
// 但和牌张被设成了 5s（应该是 9s）
await test("前置：这手牌确实不成立", async () => {
  const hand = feed(
    createEmptyHand(),
    ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","9s"],
  );
  const withWin = addTile(hand, "5s");
  await assertInvalid(withWin, baseGame());
});

await test("诊断出「把和牌张从 5s 改成 9s」", async () => {
  const hand = feed(
    createEmptyHand(),
    ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","9s"],
  );
  const withWin = addTile(hand, "5s");

  const d = await diagnoseInvalidHand(withWin, baseGame());
  ok(d.winningFix !== undefined, `应给出换和牌张的建议，实际：${d.problems.join(" | ")}`);
  ok(d.winningFix!.from === "5s", `from 应是 5s，实际 ${d.winningFix!.from}`);
  ok(d.winningFix!.to === "9s", `to 应是 9s，实际 ${d.winningFix!.to}`);
  ok(d.verdict.includes("和牌张"), `结论应提到和牌张，实际：${d.verdict}`);
  console.log(`        （${d.verdict}）`);
});

// ============================================================
console.log("\n【2】★ 守住「互换和牌张」那个坑");
// ============================================================

await test("如果只是互换和牌张（多重集不变），不该给出「改成同一张牌」的废话建议", async () => {
  // 这手牌 14 张的多重集本身就不成立，换和牌张也没用 ——
  // 诊断不该报出一个「答案就是它自己」的假建议
  const hand = feed(
    createEmptyHand(),
    ["1m","1m","3m","5m","7m","2p","4p","6p","8p","1s","3s","5s","7z"],
  );
  const withWin = addTile(hand, "6s");
  await assertInvalid(withWin, baseGame());

  const d = await diagnoseInvalidHand(withWin, baseGame());
  if (d.winningFix) {
    ok(
      d.winningFix.from !== d.winningFix.to,
      "换牌建议的 from 和 to 不能是同一张牌",
    );
  }
  // 无论有没有建议，都必须给出具体问题
  ok(d.problems.length > 0, "应给出具体问题");
});

// ============================================================
console.log("\n【3】宝牌指示牌与手牌撞牌（用户想不到的错因）");
// ============================================================

await test("手里 4 张 1m 又把它设成指示牌 → 明确指出", async () => {
  // 手牌：1111m + 234p + 567p + 234s + 99s（14 张，牌形本身是成立的）
  const hand = feed(
    createEmptyHand(),
    ["1m","1m","1m","1m","2p","3p","4p","5p","6p","7p","2s","3s","4s","9s"],
  );
  // 但把 1m 设成宝牌指示牌 → 1m 合计 5 张 → 引擎报「手牌不成立」
  const game = baseGame({ doraIndicators: ["1m"] });

  await assertInvalid(hand, game);

  const d = await diagnoseInvalidHand(hand, game);
  const hit = d.problems.find((p) => p.includes("指示牌"));
  ok(hit !== undefined, `应指出是指示牌撞牌，实际：${d.problems.join(" | ")}`);
  ok(hit!.includes("最多 4 张"), `应说明上限，实际：${hit}`);
  console.log(`        （${hit}）`);
});

// ============================================================
console.log("\n【4】凑不成面子时给出具体缺口");
// ============================================================

await test("随便一手牌 → 报出「凑出几组、剩哪几张、还差几组」", async () => {
  const hand = feed(
    createEmptyHand(),
    ["1m","1m","3m","5m","7m","2p","4p","6p","8p","1s","3s","5s","7z"],
  );
  const withWin = addTile(hand, "6s");
  await assertInvalid(withWin, baseGame());

  const d = await diagnoseInvalidHand(withWin, baseGame());
  ok(
    d.problems.some((p) => p.includes("4 组面子")),
    `应说明目标形与缺口，实际：${d.problems.join(" | ")}`,
  );
});

await test("任何情况下 problems 都非空（弹窗不能空着）", async () => {
  const hand = feed(createEmptyHand(), ["1m","2m","4m","6m","8m"]);
  const withWin = addTile(hand, "9m");
  const d = await diagnoseInvalidHand(withWin, baseGame());
  ok(d.problems.length > 0, "problems 不该为空");
});

// ============================================================
console.log("\n【5】七对子 / 国士不该被当成「不成立」");
// ============================================================

await test("七对子牌形被识别（不给「不成立」的结论）", async () => {
  const hand = feed(
    createEmptyHand(),
    ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z"],
  );
  const withWin = addTile(hand, "7z");
  // 七对子本身是合法和牌形（只是可能有役的问题），不该走到 invalid-hand
  const built = buildHandInput(withWin, baseGame());
  ok(built.ok, "应能构造输入");
  if (!built.ok) return;
  const r = await score(built.input);
  const isInvalid = "error" in r && r.error.kind === "invalid-hand";
  ok(!isInvalid, "七对子是合法牌形，不该报「不成立」");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

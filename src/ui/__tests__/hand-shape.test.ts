/**
 * 牌形判定的测试。
 *
 * ## 这一组守的是什么
 *
 * 「张数够了」≠「牌形成立」。录满 14 张（**逻辑**张数）但凑不成
 * 「4 组面子 + 1 对雀头」、也不是七对 / 国士时，算番必然失败 ——
 * 预检必须当场拦住（`precheck` 的 `invalid-shape` 档），
 * 而不是让用户走到算番才看到一句英文报错。
 *
 * ## 逻辑张数 vs 物理张数
 *
 * 每个杠在引擎眼里只占 3 格（`门前 + 副露组数 × 3 + 1 = 14`）。
 * 早期版本按**实际张数**拼数组，有杠时拼出 15+ 张，判定函数一看长度不对
 * 就直接返回 false —— 所以这里专门用「杠」的用例把这条钉死。
 */
import { addMeld, addTile, createEmptyHand, type HandState } from "../hand-state.ts";
import { createDefaultGameState, type GameState } from "../game-state.ts";
import { isWinningShape, shapeProblems } from "../hand-shape.ts";

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

/** 门清：123m 456m 789p 234s + 99s（和 9s） */
const MENZEN_WIN = ["1m","2m","3m","4m","5m","6m","7p","8p","9p","2s","3s","4s","9s"];

/** 用户报的那手牌：吃 345p + 碰 888p + 门前 1m1m2m3m5m6m7m + 和牌张 6s */
function reportedHand(): HandState {
  let h = createEmptyHand();
  h = addMeld(h, ["3p", "4p", "5p"]);
  h = addMeld(h, ["8p", "8p", "8p"]);
  h = feed(h, ["1m", "1m", "2m", "3m", "5m", "6m", "7m"]);
  return addTile(h, "6s");
}

// ============================================================
console.log("\n【1】门清的标准和牌形");
// ============================================================

await test("完整标准形 → 成立", () => {
  const h = feed(createEmptyHand(), [...MENZEN_WIN, "9s"]);
  eq(isWinningShape(h), true, "123m 456m 789p 234s 99s 应当成立");
});

await test("还没设和牌张 → 不成立", () => {
  const h = feed(createEmptyHand(), MENZEN_WIN);
  eq(h.winningTile, null, "前置：还没和牌张");
  eq(isWinningShape(h), false, "张数都不够");
});

await test("14 张但拆不出面子 → 不成立", () => {
  const h = feed(
    createEmptyHand(),
    ["1m","2m","4m","6m","8m","3p","5p","7p","9p","2s","4s","6s","8s","1z"],
  );
  eq(isWinningShape(h), false, "全是孤张，凑不出 4 组面子");
});

await test("七对子 → 成立", () => {
  const h = feed(
    createEmptyHand(),
    ["1m","1m","2m","2m","3p","3p","4p","4p","5s","5s","6s","6s","7z","7z"],
  );
  eq(isWinningShape(h), true, "七对子也是和牌形");
});

await test("国士无双 → 成立", () => {
  const h = feed(
    createEmptyHand(),
    ["1m","9m","1p","9p","1s","9s","1z","2z","3z","4z","5z","6z","7z","7z"],
  );
  eq(isWinningShape(h), true, "国士无双也是和牌形");
});

// ============================================================
console.log("\n【2】副露与杠（按逻辑张数算）");
// ============================================================

await test("一组副露：门前 10 张 + 那组面子 = 成立", () => {
  let h = createEmptyHand();
  h = addMeld(h, ["7s", "8s", "9s"]);
  h = feed(h, ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p"]);
  h = addTile(h, "1p");
  eq(h.concealed.length, 10, "门前 10 张");
  eq(isWinningShape(h), true, "123m 456m 789m 123p + 789s(副露)");
});

await test("★ 杠（副露 4 张）也只占 3 格 —— 不能按物理张数判", () => {
  let h = createEmptyHand();
  h = addMeld(h, ["1m", "1m", "1m", "1m"]); // 明杠：4 张实体牌，但只是一组面子
  h = feed(h, ["2m","3m","4m","5m","6m","7m","2p","3p","4p","9s"]);
  h = addTile(h, "9s");
  eq(h.concealed.length, 10, "门前按逻辑张数是 10（不是 9）");
  eq(isWinningShape(h), true, "1111m(杠) + 234m + 567m + 234p + 99s");
});

await test("两组副露：门前 7 张 + 2 组面子 = 成立", () => {
  let h = createEmptyHand();
  h = addMeld(h, ["3p", "4p", "5p"]);
  h = addMeld(h, ["8p", "8p", "8p"]);
  h = feed(h, ["1m","1m","2m","3m","4m","5m","6m"]);
  h = addTile(h, "7m");
  eq(h.concealed.length, 7, "门前 7 张");
  eq(isWinningShape(h), true, "11m 雀头 + 234m + 567m + 两组副露");
});

await test("★ 用户报的原案：换牌之前牌形确实不成立", () => {
  const h = reportedHand();
  eq(h.concealed.length, 7, "前置：门前 7 张");
  eq(isWinningShape(h), false, "1m1m2m3m5m6m7m + 6s 拆不出 2 组面子 + 雀头");
});

// ============================================================
console.log("\n【3】shapeProblems：说清「哪里不对」");
// ============================================================

await test("牌形成立时不报问题", () => {
  const h = feed(createEmptyHand(), [...MENZEN_WIN, "9s"]);
  eq(shapeProblems(h, baseGame()), [], "成立就该是空数组");
});

await test("牌形不成立时给出目标形与缺口", () => {
  const h = feed(
    createEmptyHand(),
    ["1m","2m","4m","6m","8m","3p","5p","7p","9p","2s","4s","6s","8s","1z"],
  );
  const p = shapeProblems(h, baseGame());
  ok(p.length > 0, "不该为空");
  ok(p.some((x) => x.includes("4 组面子")), `要说明目标形，实际：${p.join(" | ")}`);
});

await test("指示牌和手牌撞牌 → 明确指出（用户想不到的错因）", () => {
  const h = feed(
    createEmptyHand(),
    ["1m","1m","1m","1m","2p","3p","4p","5p","6p","7p","2s","3s","4s","9s"],
  );
  const p = shapeProblems(h, baseGame({ doraIndicators: ["1m"] }));
  ok(p.some((x) => x.includes("指示牌")), `应指出撞牌，实际：${p.join(" | ")}`);
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

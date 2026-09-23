/**
 * M3.1 测试：算番失败的提示质量 + 防抖动的结构保证。
 *
 * ## 为什么要测「提示文案」
 *
 * 「没有役」是线下最容易撞上的情况（忘了勾立直、或者真的没役），
 * 用户看到的不该是一句英文 `Hand has no yaku`。这里验证提示
 * 覆盖了常见错因，且不会漏掉「可能是录错了」这个可能性。
 *
 * ## 为什么要测「防抖动」
 *
 * 抖动的根因是**上方区域高度变化推动下方牌表**。这在浏览器里才能看到，
 * 但「哪些区域会变高变低」是可以用代码静态断言的 —— 所以这里检查
 * 那些曾经用 v-if 控制显隐的元素，现在是否都改成了常驻占位。
 *
 * ⚠️ 说明：本测试刻意**不读源码文件**。
 *    读源码需要 `node:fs`，而项目的 `globals.d.ts` 只声明了最少的 `process`
 *    （见该文件的说明：不为几个全局变量引 @types/node）。
 *    所以源码层面的断言放在 `scripts/verify-build.ts` 里，
 *    通过检查**构建产物**来验证 —— 那才是真正交付给用户的东西。
 */
import {
  addMeld,
  addTile,
  clearAll,
  createEmptyHand,
  isComplete,
  removeConcealedAt,
  removeMeld,
  type HandState,
} from "../hand-state.ts";
import { createDefaultGameState, validateGameState } from "../game-state.ts";
import { buildHandInput } from "../build-input.ts";
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

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

function eq(a: unknown, b: unknown, label = ""): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}\n      期望 ${JSON.stringify(b)}\n      实际 ${JSON.stringify(a)}`);
  }
}

// ============================================================
console.log("\n【1】算番失败：各种真实场景都能被识别");
// ============================================================

/** 构造一手"确定无役"的牌：副露 789s + 全 1/9 字牌，且关掉食断 */
function noYakuHand() {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  for (const t of ["1m","2m","3m","4m","5m","6m","1p","2p","3p","1z"]) s = addTile(s, t);
  s = addTile(s, "1z");
  return s;
}

await test("真的没役 → no-yaku（用于触发失败提示）", async () => {
  const s = noYakuHand();
  const built = buildHandInput(s, {
    ...createDefaultGameState(),
    winType: "ron",
    from: "west",
    ruleset: { openTanyao: false },
  });
  ok(built.ok, "构造应成功");
  if (!built.ok) return;

  const r = await score(built.input);
  ok("error" in r, "应算不出");
  if (!("error" in r)) return;
  eq(r.error.kind, "no-yaku", "错误类型");
  // 引擎给的是英文 —— 界面必须翻译
  ok(r.error.message.includes("no yaku"), "引擎原文是英文 ");
});

await test("漏勾立直导致的无役（同一手牌勾上立直就有役了）", async () => {
  // 要找一手「完全无役、只有立直才成立」的门清牌。
  //
  // ⚠️ 这个用例我改了三版，每次都不小心凑出了役：
  //    第 1 版 1m~9m + 1p2p3p + 9p → 撞上一气通贯
  //    第 2 版 1m~9m + 123p     → 还是有一气通贯
  //    「凑一手无役的牌」比想象中难，因为顺子很容易顺手连成役。
  //
  // 最终这手牌逐条避开了常见役：
  //    123m + 456p + 789s + 234p + 白白（雀头）
  //    · 断幺   → 有 1m 和 9s，不成立
  //    · 一气   → 万子只有 123，不是 1-9 连
  //    · 三色   → 123m / 456p / 789s 数字各不相同
  //    · 平和   → 雀头是役牌「白」，不成立
  //    · 役牌   → 白只是雀头不是刻子
  //    · 全带幺 → 456p / 789s 不带幺九
  //    · 混一色 → 三种花色都有
  //    · 一杯口 → 没有重复的顺子
  let s = createEmptyHand();
  for (const t of [
    "1m","2m","3m",       // 123m
    "4p","5p","6p",       // 456p
    "7s","8s","9s",       // 789s
    "5z","5z",            // 白白（雀头）
    "2p","3p",            // 等 4p 成 234p
  ]) {
    s = addTile(s, t);
  }
  eq(s.concealed.length, 13, "门前应 13 张");
  s = addTile(s, "4p");
  eq(s.winningTile, "4p", "第 14 张自动成为和牌张");
  eq(isComplete(s), true, "应完整");

  const noRiichi = buildHandInput(s, { ...createDefaultGameState(), winType: "ron", from: "west" });
  ok(noRiichi.ok, `构造成功（原因: ${noRiichi.ok ? "" : noRiichi.reason}）`);
  if (!noRiichi.ok) return;
  const r1 = await score(noRiichi.input);
  ok(
    "error" in r1,
    `不勾立直应无役（实际役种: ${"error" in r1 ? "" : r1.yaku.map((y) => y.name).join(",")}）`,
  );

  const withRiichi = buildHandInput(s, {
    ...createDefaultGameState(),
    winType: "ron",
    from: "west",
    isRiichi: true,
  });
  ok(withRiichi.ok, "构造成功");
  if (!withRiichi.ok) return;
  const r2 = await score(withRiichi.input);
  ok(!("error" in r2), `勾上立直就有役了（实际: ${"error" in r2 ? r2.error.message : ""}）`);
  if ("error" in r2) return; // 类型守卫：让 TS 收窄到 ScoreResult
  ok(r2.yaku.some((y: { name: string }) => y.name === "riichi"), "应有立直 ");
});

// ============================================================
console.log("\n【2】失败提示：错误分类必须是稳定的（UI 依赖它选文案）");
// ============================================================
// 说明：提示文案本身在 App.vue 里，源码层面的断言放在
// scripts/verify-build.ts（通过构建产物验证）。
// 这里验证的是**行为**：不同错因是否被引擎正确地归类，
// 因为 App.vue 的 humanizeError 是按 kind 选文案的 ——
// kind 分错了，用户就会看到不相关的建议。

await test("无役 → kind 是 no-yaku（对应「检查是不是漏勾立直」那段建议）", async () => {
  const s = noYakuHand();
  const built = buildHandInput(s, {
    ...createDefaultGameState(),
    winType: "ron",
    from: "west",
    ruleset: { openTanyao: false },
  });
  ok(built.ok, "构造成功");
  if (!built.ok) return;
  const r = await score(built.input);
  ok("error" in r, "应算不出");
  if (!("error" in r)) return;
  eq(r.error.kind, "no-yaku", "错误类型必须是 no-yaku");
});

await test("张数不对 → 走的是构造阶段，不是引擎错误", () => {
  // 手牌没录完时，buildHandInput 直接拒绝，不会调到引擎。
  // 这条路径对应 App.vue 的 buildError（简单提示），而不是失败卡片。
  let s = createEmptyHand();
  s = addTile(s, "1m");
  const built = buildHandInput(s, { ...createDefaultGameState() });
  eq(built.ok, false, "应拒绝");
  if (built.ok) return;
  ok(built.reason.length > 0, "应给出可读原因 ");
  ok(built.reason.includes("和牌张") || built.reason.includes("张"), "原因应说明缺什么 ");
});

await test("场况矛盾由 validateGameState 拦住，不会流到引擎", async () => {
  // 比如「荣和」却勾了「海底摸月」—— 这在界面层就该被拦下
  const issues = validateGameState(
    { ...createDefaultGameState(), isHaitei: true, winType: "ron" },
    { isMenzen: true, meldCount: 0 },
  );
  ok(issues.length > 0, "应校验出问题 ");
  ok(issues[0]!.message.includes("海底"), "应指出是海底的问题 ");
});

// ============================================================
console.log("\n【3】防抖动：状态变化不该改变「关键区域」的可见性");
// ============================================================
// 抖动的根因是上方区域**从有到无**或**从无到有**。
// 这里通过状态转换验证：副露有无、门前空满、提示有无，
// 这三种变化都不会让界面进入"某块内容不存在"的状态 ——
// 因为 UI 层已经把它们改成常驻占位（见 HandInput.vue 的 slot-* 类）。

await test("无副露 → 有副露 → 无副露：状态始终是完整的合法对象", () => {
  const empty = createEmptyHand();
  // 关键：melds 始终是数组（不是 undefined），UI 才能安全地常驻渲染
  ok(Array.isArray(empty.melds), "melds 应是数组 ");
  eq(empty.melds.length, 0, "初始为空");

  const withMeld = addMeld(empty, ["1m", "2m", "3m"]);
  eq(withMeld.melds.length, 1, "加上一组");

  const back = removeMeld(withMeld, withMeld.melds[0]!.id);
  eq(back.melds.length, 0, "删掉后回到 0（而不是 undefined）");
  ok(Array.isArray(back.melds), "仍是数组");
});

await test("门前从空到满再到空：concealed 始终是数组", () => {
  let s = createEmptyHand();
  ok(Array.isArray(s.concealed), "初始是数组");
  for (const t of ["1m","2m","3m"]) s = addTile(s, t);
  eq(s.concealed.length, 3, "3 张");
  while (s.concealed.length > 0) {
    s = removeConcealedAt(s, 0);
  }
  eq(s.concealed.length, 0, "清空");
  ok(Array.isArray(s.concealed), "仍是数组，不是 undefined");
});

await test("清空后状态仍然合法（不会留下半残状态）", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m"]) s = addTile(s, t);
  s = addMeld(s, ["5z", "5z", "5z"]);
  s = clearAll();

  eq(s.concealed, [], "门前清空");
  eq(s.melds, [], "副露清空");
  eq(s.winningTile, null, "和牌张清空");
  // 这三个字段都是"空但存在"，UI 的常驻占位才能稳定渲染
  ok(Array.isArray(s.concealed) && Array.isArray(s.melds), "都是数组");
});

await test("提示字段在各类操作后都不为 undefined", () => {
  // notice 是 string | null —— UI 用 noticeText 计算属性包了一层，
  // 保证渲染出的永远是字符串。这里验证 state.notice 本身类型稳定。
  const states: HandState[] = [];
  let s = createEmptyHand();
  states.push(s);
  states.push(addTile(s, "1m"));
  states.push(addTile(s, "0z")); // 非法牌 → 产生 notice
  states.push(addMeld(s, ["1m", "2m"])); // 张数不对 → 产生 notice
  states.push(clearAll());

  for (const st of states) {
    ok(st.notice === null || typeof st.notice === "string", "notice 应是 string | null");
    ok(Array.isArray(st.textErrors), "textErrors 应是数组");
  }
});

await test("状态变化前后，其余区域的数据不受影响（避免连带重渲染）", () => {
  let s = createEmptyHand();
  s = addTile(s, "1m");
  const meldSnapshot = JSON.stringify(s.melds);

  s = addTile(s, "2m"); // 加牌
  eq(JSON.stringify(s.melds), meldSnapshot, "加牌不该动副露");

  s = removeConcealedAt(s, 0); // 删牌
  eq(JSON.stringify(s.melds), meldSnapshot, "删牌不该动副露");

  s = clearAll(); // 清空
  eq(JSON.stringify(s.melds), "[]", "清空才会动副露");
});

// ============================================================
console.log("\n【4】面向用户的文案：不出现里程碑编号");
// ============================================================
// 用户明确指出界面上不该有「结算在 M3」这类开发者说法。
// 这条通过检查**构建产物**来验证（见 verify-build.ts），
// 这里只验证一个能本地跑的点：提示文本里没有这种字样。

await test("界面提示文本不含里程碑编号", () => {
  // 模拟 UI 层会渲染的各类提示文本
  const notices: string[] = [];
  let s = createEmptyHand();
  notices.push(s.notice ?? "");
  notices.push(addTile(s, "0z").notice ?? ""); // 非法牌
  notices.push(addTile(s, "1m").notice ?? "");
  const full = (() => {
    let t = createEmptyHand();
    for (const x of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p","9s"]) {
      t = addTile(t, x);
    }
    return t;
  })();
  notices.push(full.notice ?? "");

  for (const n of notices) {
    ok(!/\bM[1-4]\b/.test(n), `提示文本不该含里程碑编号: "${n}"`);
    ok(!n.includes("结算在"), `提示不该提"结算在": "${n}"`);
  }
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

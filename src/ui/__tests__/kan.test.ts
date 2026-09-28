/**
 * 杠的标记 + 物理张数的测试。
 *
 * ## 这一组在防什么
 *
 * 1. **「4 张同牌」不等于「杠」** —— 实测过的反例：
 *    `1111m(杠) + 2222m(不是杠) + 345p + 99s`，15 张实体牌里有两个 4 张组，
 *    只有 1m 是真杠。自动推断会把 2222m 也变成杠，番符全错。
 *    所以必须有「用户明确指定」这一步，而且指定错了要能拒绝。
 *
 * 2. **和牌张不能属于杠** —— 真实牌局不可能（杠的 4 张在和牌前就都在手里）。
 *    遇到就拒绝，不能偷偷把和牌张清掉（那会少一张牌却不明显）。
 *
 * 3. **物理张数与逻辑张数是两个口径** —— 界面只展示物理的。
 *    没有杠时都是 14；1 个杠时逻辑仍是 14、物理是 15。
 *
 * 4. **取消暗杠是「撤销」，不是「删除」** —— 那 4 张本来就是自己门前的牌
 *    （`promoteToKan` 就是从门前搬走的），取消时必须退回门前。
 *    碰 / 明杠不能这么退：那些牌是从别人那里要来的。
 */
import {
  addMeld,
  addTile,
  clearAll,
  countKind,
  createEmptyHand,
  expectedConcealedCount,
  expectedPhysicalCount,
  isComplete,
  kanCandidate,
  physicalTileCount,
  promoteToKan,
  setMeldKind,
  unpromoteKan,
  type HandState,
} from "../hand-state.ts";

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

function feed(state: HandState, tiles: string[]): HandState {
  let s = state;
  for (const t of tiles) s = addTile(s, t);
  return s;
}

// ============================================================
console.log("\n【1】物理张数 vs 逻辑张数");
// ============================================================

test("没有杠时：物理 = 逻辑 = 14", () => {
  const s = feed(createEmptyHand(), [
    "1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p","9s",
  ]);
  eq(physicalTileCount(s), 14, "物理");
  eq(s.concealed.length + 1, 14, "逻辑（门前 + 和牌张）");
  eq(expectedPhysicalCount(s.melds), 14, "目标物理");
});

test("1 个杠时：物理 15，逻辑仍是 14", () => {
  const s = feed(createEmptyHand(), [
    "1m","1m","1m","1m","2p","3p","4p","5p","6p","7p","8s","9s","5z",
  ]);
  const after = promoteToKan(s, "1m", "ankan");

  eq(after.melds.length, 1, "有 1 组副露");
  eq(after.concealed.length, 9, "门前剩 9 张（13-4）");
  eq(expectedConcealedCount(after.melds), 10, "门前目标变 10");
  // 物理 = 门前 9 + 杠 4 = 13，还没录和牌张
  eq(physicalTileCount(after), 13, "物理（还没和牌张）");
  eq(expectedPhysicalCount(after.melds), 15, "目标物理 15");

  const full = feed(after, ["2s"]);
  eq(physicalTileCount(full), 14, "补到 10 张门前 + 杠 4 = 14，还没和牌张");
});

test("expectedPhysicalCount：每个杠加一张", () => {
  eq(expectedPhysicalCount([]), 14, "0 杠");
  eq(expectedPhysicalCount([{ id: 1, kind: "ankan", tiles: ["1m","1m","1m","1m"] }]), 15, "1 杠");
  eq(
    expectedPhysicalCount([
      { id: 1, kind: "ankan", tiles: ["1m","1m","1m","1m"] },
      { id: 2, kind: "daiminkan", tiles: ["9p","9p","9p","9p"] },
    ]),
    16,
    "2 杠",
  );
  // 碰（3 张）不算杠，不增加物理目标
  eq(expectedPhysicalCount([{ id: 3, kind: "triplet", tiles: ["5z","5z","5z"] }]), 14, "碰不加");
});

// ============================================================
console.log("\n【2】kanCandidate：发现「门前凑满 4 张」");
// ============================================================

test("门前有 4 张同牌时能检出", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m","3m"]);
  eq(kanCandidate(s), "3m", "应检出 3m");
});

test("只有 3 张时检不出", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m"]);
  eq(kanCandidate(s), null, "不该检出");
});

test("赤 5 与普通 5 合并计数（4 张即可）", () => {
  // 0m 与 5m 是同一种牌的两种形态
  const s = feed(createEmptyHand(), ["5m","5m","5m","0m"]);
  const c = kanCandidate(s);
  ok(c !== null, "应检出");
  ok(c === "5m" || c === "0m", `检出的应是 5m 或 0m，实际 ${c}`);
});

test("和牌张不算进「门前凑满 4 张」", () => {
  // 门前 3 张 3m，第 4 张点成和牌张 —— kanCandidate 只看门前，应为 null
  let s = feed(createEmptyHand(), [
    "3m","3m","3m","2p","3p","4p","5p","6p","7p","8s","9s","5z","5z",
  ]);
  eq(s.concealed.length, 13, "门前满 13");
  s = addTile(s, "3m");
  eq(s.winningTile, "3m", "3m 成为和牌张");
  eq(countKind(s, "3m"), 4, "3m 总共 4 张");
  eq(kanCandidate(s), null, "门前只有 3 张，不该检出");
});

// ============================================================
console.log("\n【3】promoteToKan：正常路径");
// ============================================================

test("4 张从门前移入副露，kind 记录正确", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m","3m","1p","2p","3p"]);
  const after = promoteToKan(s, "3m", "ankan");

  eq(after.melds.length, 1, "1 组");
  eq(after.melds[0]!.kind, "ankan", "暗杠");
  eq(after.melds[0]!.tiles, ["3m","3m","3m","3m"], "4 张都在");
  eq(after.concealed.length, 3, "门前剩 3 张（1p2p3p）");
  eq(after.concealed.includes("3m"), false, "门前不再有 3m");
  eq(after.notice, null, "无提示");
});

test("明杠也支持（Q4 的要求）", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m","3m"]);
  const after = promoteToKan(s, "3m", "daiminkan");
  eq(after.melds[0]!.kind, "daiminkan", "明杠");
});

test("标记后门前目标少 3 张（13 -> 10）", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m","3m"]);
  eq(expectedConcealedCount(s.melds), 13, "标记前 13");
  const after = promoteToKan(s, "3m", "ankan");
  eq(expectedConcealedCount(after.melds), 10, "标记后 10");
});

// ============================================================
console.log("\n【4】promoteToKan：必须拒绝的情况");
// ============================================================

test("★ 反例：另一个 4 张组不该被误当成杠（由调用方决定，这里验证不误伤）", () => {
  // 门前：2m 4 张 + 3m 4m 3p 4p 5p 9s（10 张），副露：暗杠 1111m
  // 2m 有 4 张但**不是杠**（拆成 222m 刻子 + 234m 顺子）
  const s0 = feed(createEmptyHand(), [
    "1m","1m","1m","1m",
    "2m","2m","2m","2m","3m","4m","3p","4p","5p","9s",
  ]);
  // ⚠️ 喂 14 张 → 门前 13、9s 自动成为和牌张
  eq(s0.concealed.length, 13, "门前 13");
  eq(s0.winningTile, "9s", "和牌张是 9s");

  // 先标 1m 为杠：门前从 13 掉到 9（移走 4 张），目标从 13 降到 10
  const withKan = promoteToKan(s0, "1m", "ankan");
  eq(withKan.melds.length, 1, "1m 记为杠");
  eq(withKan.concealed.length, 9, "门前剩 9 张（13-4）");
  eq(expectedConcealedCount(withKan.melds), 10, "门前目标降到 10");

  // 标杠后要再补 1 张才回到目标（差 3 而不是 4 —— 杠多出的那张由物理牌补）
  const filled = feed(withKan, ["6s"]);
  eq(filled.concealed.length, 10, "补到 10 张");
  eq(physicalTileCount(filled), 15, "物理 15 张 = 门前 10 + 杠 4 + 和牌张 1");

  // 此时 2m 仍有 4 张，kanCandidate 会检出 —— 但用户可以说「不是」
  eq(kanCandidate(filled), "2m", "会提示 2m 也可疑");
  // ⚠️ 这正是「必须由用户明确指定」的原因：
  //    UI 要给出 [暗杠][明杠][不是] 三个选项，不能自动进入。
  //    这里验证的是：**不调用 promoteToKan 就不会被误标**。
  eq(filled.melds.length, 1, "没被自动标成第二个杠");
});

test("和牌张是同一张牌时 → 拒绝并提示", () => {
  // 门前 13 张里 3 张 3m，第 14 张点 3m 成为和牌张
  let s = feed(createEmptyHand(), [
    "3m","3m","3m","2p","3p","4p","5p","6p","7p","8s","9s","5z","5z",
  ]);
  s = addTile(s, "3m");

  const before = { concealed: s.concealed.length, melds: s.melds.length, win: s.winningTile };
  const after = promoteToKan(s, "3m", "ankan");

  // 完全没变
  eq(after.concealed.length, before.concealed, "门前不变");
  eq(after.melds.length, before.melds, "副露不变");
  eq(after.winningTile, before.win, "和牌张不变（不偷偷清掉）");
  ok(after.notice !== null, "应给提示");
  ok(after.notice!.includes("和牌张"), `提示应说明原因，实际：${after.notice}`);
});

test("门前不足 4 张时 → 拒绝", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m"]);
  const after = promoteToKan(s, "3m", "ankan");
  eq(after.melds.length, 0, "没有产生副露");
  ok(after.notice !== null, "应给提示");
  ok(after.notice!.includes("3 张"), `提示应说明张数，实际：${after.notice}`);
});

test("门前 0 张时 → 拒绝（不崩）", () => {
  const after = promoteToKan(createEmptyHand(), "3m", "ankan");
  eq(after.melds.length, 0, "没有产生副露");
  ok(after.notice !== null, "应给提示");
});

// ============================================================
console.log("\n【5】标记后能正常算番（端到端）");
// ============================================================

test("标记一个暗杠后，手牌仍能被判定为完整", () => {
  // 目标：门前 10 张 + 暗杠 1111m + 和牌张 = 完整
  // 喂 13 张（1m 4 张 + 2p~7p 6 张 + 7s 8s 2 张 + 5z 1 张）
  let s = feed(createEmptyHand(), [
    "1m","1m","1m","1m",
    "2p","3p","4p","5p","6p","7p","7s","8s","5z",
  ]);
  eq(s.concealed.length, 13, "门前 13 张");

  s = promoteToKan(s, "1m", "ankan");
  eq(s.concealed.length, 9, "标杠后门前 9 张（13-4）");
  eq(expectedConcealedCount(s.melds), 10, "目标降到 10");
  eq(isComplete(s), false, "还没和牌张");

  // 第 10 张：进门前（因为目标是 10）
  s = addTile(s, "9s");
  eq(s.concealed.length, 10, "门前 10 张");
  eq(s.winningTile, null, "还不是和牌张");

  // 第 11 张：门前已满，这一张成为和牌张
  s = addTile(s, "5z");
  eq(s.winningTile, "5z", "和牌张");
  eq(s.concealed.length, 10, "门前仍 10 张");
  eq(isComplete(s), true, "完整了");
  eq(physicalTileCount(s), 15, "物理 15 张 = 10 + 4 + 1");
});

test("全清后不残留副露", () => {
  let s = feed(createEmptyHand(), ["3m","3m","3m","3m"]);
  s = promoteToKan(s, "3m", "ankan");
  const cleared = clearAll();
  eq(cleared.melds.length, 0, "没有副露");
  eq(cleared.concealed.length, 0, "没有门前牌");
  eq(expectedPhysicalCount(cleared.melds), 14, "目标回到 14");
});

// ============================================================
console.log("\n【6】unpromoteKan：取消暗杠 = 撤销，不是删除");
// ============================================================
//
// 这一段防的是「门的暗杠点了没反应 / 点了 4 张牌就没了」——
// 暗杠那 4 张本来就是自己门前的牌，取消之后必须退回门前。

test("取消暗杠：4 张退回门前，副露清空", () => {
  const s0 = feed(createEmptyHand(), ["3m","3m","3m","3m","1p","2p","3p"]);
  const kan = promoteToKan(s0, "3m", "ankan");
  eq(kan.concealed.length, 3, "标杠后门前 3 张");

  const back = unpromoteKan(kan, kan.melds[0]!.id);
  eq(back.melds.length, 0, "没有副露了");
  eq(back.concealed.length, 7, "7 张全回到门前");
  // 顺序按 sortTiles 的既有约定：m → p → s → z（见 tiles.ts 的 SUIT_ORDER）
  eq(back.concealed, ["3m","3m","3m","3m","1p","2p","3p"], "内容与排序");
  eq(expectedConcealedCount(back.melds), 13, "门前目标回到 13");
});

test("可逆：promote → unpromote 完全回到原状态", () => {
  const s0 = feed(createEmptyHand(), ["3m","3m","3m","3m","1p","2p","3p"]);
  const kan = promoteToKan(s0, "3m", "ankan");
  const back = unpromoteKan(kan, kan.melds[0]!.id);
  eq(back.concealed, s0.concealed, "门前牌完全一致");
  eq(back.melds.length, s0.melds.length, "副露数一致");
  eq(back.winningTile, s0.winningTile, "和牌张一致");
  eq(back.notice, "已取消杠，4 张退回门前。", "干净的一句提示");
});

test("还没补过牌时退回正好：门前 13 张，不多不少", () => {
  // 13 张里 3m 占 4 张 → 标杠 → 门前 9、目标 10（界面会要求再补 1 张）
  const s0 = feed(createEmptyHand(), [
    "3m","3m","3m","3m","1p","2p","3p","4p","5p","6p","7s","8s","5z",
  ]);
  eq(s0.concealed.length, 13, "门前 13");
  const kan = promoteToKan(s0, "3m", "ankan");
  eq(kan.concealed.length, 9, "标杠后 9 张");
  eq(expectedConcealedCount(kan.melds), 10, "目标降到 10（差 1 张）");

  const back = unpromoteKan(kan, kan.melds[0]!.id);
  eq(back.concealed.length, 13, "退回来正好 13 张");
  eq(back.concealed.length, expectedConcealedCount(back.melds), "正好凑满，不超");
});

test("已经补过牌时退回会多 1 张 —— 只提示，不替用户删", () => {
  const s0 = feed(createEmptyHand(), [
    "3m","3m","3m","3m","1p","2p","3p","4p","5p","6p","7s","8s","5z",
  ]);
  let s = promoteToKan(s0, "3m", "ankan");
  s = feed(s, ["6s"]);
  eq(s.concealed.length, 10, "补到门前 10 张");

  const back = unpromoteKan(s, s.melds[0]!.id);
  eq(back.concealed.length, 14, "退回来 14 张（比目标多 1）");
  eq(expectedConcealedCount(back.melds), 13, "目标是 13");
  ok(back.notice !== null, "应给提示");
  ok(
    back.notice!.includes("多了 1 张"),
    `提示要说明超出几张，实际：${back.notice}`,
  );
});

test("和牌张一并重置（门前张数变了，那份认定的前提就没了）", () => {
  const s0 = feed(createEmptyHand(), [
    "3m","3m","3m","3m","1p","2p","3p","4p","5p","6p","7s","8s","5z",
  ]);
  let s = promoteToKan(s0, "3m", "ankan");
  s = feed(s, ["6s","9s"]);
  eq(s.winningTile, "9s", "已有和牌张");

  const back = unpromoteKan(s, s.melds[0]!.id);
  eq(back.winningTile, null, "和牌张被重置");
  ok(back.notice!.includes("和牌张"), `提示要说明原因，实际：${back.notice}`);
});

test("非暗杠一律原样返回 —— 碰 / 明杠的牌不能退回门前", () => {
  // 碰的 3 张来自别人，退回门前等于谎称「这是我自己摸的」
  const pon = addMeld(createEmptyHand(), ["5z","5z","5z"]);
  eq(unpromoteKan(pon, pon.melds[0]!.id), pon, "碰：不变");

  // 明杠的 4 张里有 1 张是别人打的，同样不能整组退回
  const raw = addMeld(createEmptyHand(), ["5z","5z","5z","5z"]);
  const dai = setMeldKind(raw, raw.melds[0]!.id, "daiminkan");
  eq(dai.melds[0]!.kind, "daiminkan", "先确认它确实被改成明杠了");
  eq(unpromoteKan(dai, dai.melds[0]!.id), dai, "明杠：不变");
});

test("id 不存在时原样返回（不崩）", () => {
  const s = feed(createEmptyHand(), ["3m","3m","3m","3m"]);
  eq(unpromoteKan(s, 9999), s, "不变");
});

test("取消之后再标回来，手牌仍然完整（端到端）", () => {
  const s0 = feed(createEmptyHand(), [
    "3m","3m","3m","3m","1p","2p","3p","4p","5p","6p","7s","8s","5z",
  ]);
  let s = promoteToKan(s0, "3m", "ankan");
  s = unpromoteKan(s, s.melds[0]!.id);
  eq(s.concealed.length, 13, "退回后 13 张");

  // 再标一次：应该是同样的结果
  s = promoteToKan(s, "3m", "ankan");
  eq(s.melds.length, 1, "又有一组杠");
  eq(s.concealed.length, 9, "门前又是 9 张");
  eq(expectedConcealedCount(s.melds), 10, "目标又是 10");

  // 补满 + 和牌张
  s = feed(s, ["6s","9s"]);
  eq(s.winningTile, "9s", "和牌张");
  eq(isComplete(s), true, "完整");
  eq(physicalTileCount(s), 15, "物理 15 张 = 10 + 4 + 1");
});

// // ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

/**
 * M2 解析与状态模型测试。
 *
 * 为什么重点测这些：手牌解析是**用户唯一的输入口**，也是所有算分错误的源头。
 * 解析错了，后面算得再对也没用。所以边界要覆盖密：赤 5、字牌上限、
 * 副露括号、空格写法、张数上限、单张删除。
 */
import {
  formatHandText,
  formatTiles,
  isRedFive,
  isValidTile,
  normalizeRedFive,
  parseCompact,
  parseHandText,
  parseSpaced,
  sortTiles,
  tileLabel,
  type ParseError,
  type ParseResult,
} from "../tiles.ts";
import {
  addConcealed,
  addMeld,
  clearWinningTile,
  countKind,
  createEmptyHand,
  expectedConcealedCount,
  isComplete,
  removeConcealedAt,
  removeMeld,
  remainingSlots,
  setMeldKind,
  setWinningTile,
  setWinningTileFromHand,
  stateToText,
  textToState,
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

// ============================================================
console.log("\n【1】单张牌合法性");
// ============================================================
test("合法牌", () => {
  for (const t of ["1m", "9p", "5s", "0m", "0p", "0s", "1z", "7z"]) {
    ok(isValidTile(t), `${t} 应合法 `);
  }
});
test("非法牌", () => {
  for (const t of ["0z", "8z", "9z", "1x", "m", "11m", "", "1", "z1"]) {
    ok(!isValidTile(t), `${t} 应非法 `);
  }
});
test("赤 5 识别与折算", () => {
  ok(isRedFive("0p"), "0p 是赤5 ");
  ok(!isRedFive("5p"), "5p 不是赤5 ");
  eq(normalizeRedFive("0p"), "5p", "0p 折算成 5p");
  eq(normalizeRedFive("3m"), "3m", "非赤牌原样返回");
});

// ============================================================
console.log("\n【2】紧凑写法解析");
// ============================================================
test("标准紧凑写法", () => {
  // 13 张：123m(3) + 456p(3) + 789s(3) + 1122z(4)
  const r = parseCompact("123m456p789s1122z");
  ok(r.ok, "应解析成功 ");
  if (!r.ok) return;
  eq(r.value.length, 13, "张数");
  eq(r.value.slice(0, 3), ["1m", "2m", "3m"], "前 3 张");
  eq(r.value.slice(-4), ["1z", "1z", "2z", "2z"], "末 4 张字牌");
});
/** 断言解析成功并取出 value。避免每处都写 `if (!r.ok) return;` 造成的类型收窄问题。 */
function unwrap<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new Error("期望解析成功，实际失败: " + r.errors.map((e) => e.message).join("; "));
  return r.value;
}

/** 断言解析失败并取出错误列表 */
function unwrapErr<T>(r: ParseResult<T>): ParseError[] {
  if (r.ok) throw new Error("期望解析失败，实际成功了");
  return r.errors;
}

test("张数确实是逐张展开的（防止再数错）", () => {
  eq(unwrap(parseCompact("123m")).length, 3, "123m = 3 张");
  eq(unwrap(parseCompact("11z")).length, 2, "11z = 2 张");
  eq(unwrap(parseCompact("123m456p789s11z")).length, 11, "加起来是 11 张");
});
test("赤 5 混在紧凑写法里", () => {
  const r = parseCompact("405m");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value, ["4m", "0m", "5m"], "含赤5");
});
test("字牌上限 7z，8z 报错", () => {
  const r = parseCompact("8z");
  eq(r.ok, false, "8z 应失败");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("1z-7z"), "错误信息应提示字牌范围 ");
});
test("花色前缺数字报错", () => {
  const r = parseCompact("m");
  eq(r.ok, false, "应失败");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("前面没有数字"), "错误信息 ");
});
test("数字后缺花色报错", () => {
  const r = parseCompact("123");
  eq(r.ok, false, "应失败");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("缺少花色"), "错误信息 ");
});
test("无法识别的字符报错并给下标", () => {
  const r = parseCompact("1m@2m");
  eq(r.ok, false, "应失败");
  if (r.ok) return;
  eq(r.errors[0]!.index, 2, "错误下标应为 2");
});

// ============================================================
console.log("\n【3】空格写法解析（Q20：必须同时兼容）");
// ============================================================
test("空格分隔", () => {
  const r = parseSpaced("1m 2m 3m 4p 5p");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value, ["1m", "2m", "3m", "4p", "5p"], "按空格切分");
});
test("逗号分隔（含中文逗号）", () => {
  const r = parseSpaced("1m,2m，3m");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value, ["1m", "2m", "3m"], "逗号也当分隔符");
});
test("空格与紧凑混写", () => {
  const r = parseSpaced("123m 456p 1122z");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value.length, 10, "3+3+4 = 10 张");
});
test("非法片段报错", () => {
  const r = parseSpaced("1m xx 3m");
  eq(r.ok, false, "应失败");
});

// ============================================================
console.log("\n【4】副露括号解析（Q20）");
// ============================================================
test("无副露", () => {
  const r = parseHandText("123m456p789s1122z");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value.concealed.length, 13, "门前张数");
  eq(r.value.melds.length, 0, "无副露");
});
test("一组副露", () => {
  const r = parseHandText("123m456p[789s]1122z");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value.concealed.length, 10, "门前张数 = 13-3");
  eq(r.value.melds.length, 1, "一组副露");
  eq(r.value.melds[0], ["7s", "8s", "9s"], "副露内容");
});
test("两组副露", () => {
  const r = parseHandText("[111m][222p]123s456s11z");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value.melds.length, 2, "两组副露");
  // 123s(3) + 456s(3) + 11z(2) = 8
  eq(r.value.concealed.length, 8, "门前张数");
  eq(expectedConcealedCountById(r.value.melds.length), 7, "标准算应只需 7 张，这里多了 1 张");
});
test("杠副露 4 张", () => {
  const r = parseHandText("[1111m]123p456p789p11z");
  ok(r.ok, "应成功 ");
  if (!r.ok) return;
  eq(r.value.melds[0]!.length, 4, "杠是 4 张");
});
test("方括号不闭合报错", () => {
  const r = parseHandText("123m[456p");
  eq(r.ok, false, "应失败");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("没有对应的"), "错误信息 ");
});
test("副露张数不对报错", () => {
  const r = parseHandText("123m[45p]678m");
  eq(r.ok, false, "应失败");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("3 张"), "错误信息 ");
});

/** 13 - 3×副露组数。测试里独立算一遍，避免和被测代码用同一个函数（那样测不出错） */
function expectedConcealedCountById(meldCount: number): number {
  return 13 - 3 * meldCount;
}

// ============================================================
console.log("\n【5】格式化与往返");
// ============================================================
test("格式化按万筒索字排序", () => {
  eq(formatTiles(["1z", "9s", "1m", "5p"]), "1m5p9s1z", "顺序");
});
test("排序：赤5与普通5相邻", () => {
  const sorted = sortTiles(["5m", "0m", "4m", "6m"]);
  eq(sorted.length, 4, "张数不变");
  ok(sorted.indexOf("4m") < sorted.indexOf("0m"), "4m 应在赤5前 ");
  ok(sorted.indexOf("5m") < sorted.indexOf("6m"), "5m 应在 6m 前 ");
});
// ⚠️ 这组是本轮发现的真实问题：副露原本在文本中间，
//    格式化后会被挤到末尾，导致「输入什么、显示什么」不一致。
//    修法：格式化时把副露放回原位置（分段排序）。
//
// 注意：这里断言的是**语义等价**，不是逐字相同。
// `234p567p` 与 `234567p` 是同一手牌，格式化时合并写法是正确的；
// 逐字比对会因为这种无害的合并而误报。所以比较「解析后是否一致」。
function sameHand(a: string, b: string): boolean {
  const pa = parseHandText(a);
  const pb = parseHandText(b);
  if (!pa.ok || !pb.ok) return false;
  const norm = (p: typeof pa & { ok: true }) => ({
    concealed: [...p.value.concealed].sort().join(","),
    melds: p.value.melds.map((m) => [...m].sort().join("+")).sort().join("|"),
    positions: (p.value.meldPositions ?? []).join(","),
  });
  return JSON.stringify(norm(pa as never)) === JSON.stringify(norm(pb as never));
}

test("往返等价：副露在原位（不挤到末尾）", () => {
  const text = "123m456p[789s]1122z";
  const out = stateToText(textToState(text));
  ok(sameHand(text, out), `应等价，实际输出 "${out}"`);
});

test("往返等价：含赤 5", () => {
  const text = "123m40p[789s]1122z";
  const out = stateToText(textToState(text));
  ok(sameHand(text, out), `应等价，实际输出 "${out}"`);
});

test("往返等价：副露在开头", () => {
  const text = "[111m]234p567p8899s";
  const out = stateToText(textToState(text));
  ok(sameHand(text, out), `应等价，实际输出 "${out}"`);
  // 副露必须还在开头，不能被挪到末尾
  ok(out.startsWith("[111m]"), `副露应保持在开头，实际 "${out}"`);
});

test("往返等价：副露在末尾", () => {
  // 门前 10 张（123m 456p 789s 1p）+ 副露 3 张 = 13
  const text = "123m456p789s1p[1z1z1z]";
  const out = stateToText(textToState(text));
  ok(sameHand(text, out), `应等价，实际输出 "${out}"`);
  // 副露必须在末尾（紧凑写法会把它合并成 [111z]，这也是合法的）
  const p = parseHandText(out);
  ok(p.ok, "输出应可再解析 ");
  if (!p.ok) return;
  eq(p.value.melds.length, 1, "仍有一组副露");
  eq(p.value.concealed.length, 10, "门前仍是 10 张");
  ok(!out.includes("[") || out.indexOf("[") > out.search(/[1-9]p/), `副露应在末尾，实际 "${out}"`);
});
test("副露前的数字悬空应报错（不是合法输入）", () => {
  // `11` 后面没有花色字母，也不是副露的一部分 —— 这是笔误
  const r = parseHandText("123m456p789s11[1z1z1z]");
  eq(r.ok, false, "应报错");
  if (r.ok) return;
  ok(r.errors[0]!.message.includes("缺少花色"), "错误信息应指出缺花色 ");
});

test("往返等价：两组副露都在开头", () => {
  const text = "[111m][222p]123s456s11z";
  const out = stateToText(textToState(text));
  ok(sameHand(text, out), `应等价，实际输出 "${out}"`);
});

test("往返等价：无副露时逐字一致", () => {
  // 没有副露的场合，格式化结果应当是确定的（全排序后按花色合并）
  for (const text of ["123m456p789s1122z", "123m40p789s1122z", "1111222233334444m"]) {
    const out = stateToText(textToState(text));
    eq(out, text, `无副露时应逐字一致（${text}）`);
  }
});

// ============================================================
console.log("\n【6】状态模型 —— 录入与删除（Q19）");
// ============================================================
test("空手牌状态", () => {
  const s = createEmptyHand();
  eq(s.concealed, [], "门前为空");
  eq(s.winningTile, null, "无和牌张");
  eq(remainingSlots(s), 13, "还差 13 张");
});
test("加入牌会自动排序", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "9m");
  s = addConcealed(s, "1m");
  eq(s.concealed, ["1m", "9m"], "应按顺序排好");
});
test("门前牌加满后拒绝并提示", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 13, "已满 13 张");
  const after = addConcealed(s, "9s");
  eq(after.concealed.length, 13, "不应加入");
  ok(after.notice !== null, "应给出提示 ");
});
test("同种牌超过 4 张被拒", () => {
  let s = createEmptyHand();
  for (let i = 0; i < 4; i++) s = addConcealed(s, "1m");
  eq(s.concealed.length, 4, "4 张可以");
  const after = addConcealed(s, "1m");
  eq(after.concealed.length, 4, "第 5 张应被拒");
  ok(after.notice!.includes("4 张"), "提示应说明原因 ");
});
test("赤 5 与普通 5 合计不超过 4 张", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "5m");
  s = addConcealed(s, "5m");
  s = addConcealed(s, "0m");
  eq(countKind(s, "5m"), 3, "赤5与普通5算同种");
  s = addConcealed(s, "0m");
  eq(s.concealed.length, 4, "第 4 张可以");
  const after = addConcealed(s, "5m");
  eq(after.concealed.length, 4, "第 5 张应被拒（赤5+普通5 合计 4）");
});
test("单张删除（Q19 关键）", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "1m");
  s = addConcealed(s, "2m");
  s = addConcealed(s, "3m");
  s = removeConcealedAt(s, 1);
  eq(s.concealed, ["1m", "3m"], "应只删掉中间那张");
});
test("删除越界下标安全无效", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "1m");
  eq(removeConcealedAt(s, 5).concealed, ["1m"], "越界不应改变状态");
  eq(removeConcealedAt(s, -1).concealed, ["1m"], "负数下标不应改变状态");
});
test("设置和牌张（取自门前）会移走那一张", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "1m");
  s = addConcealed(s, "2m");
  s = addConcealed(s, "3m");
  // 把下标 1（即 2m）设为和牌张
  s = setWinningTile(s, "2m", 1);
  eq(s.winningTile, "2m", "和牌张已设");
  eq(s.concealed, ["1m", "3m"], "门前牌里不再重复");
});
test("设置和牌张（外来）门前牌不变", () => {
  let s = createEmptyHand();
  s = addConcealed(s, "1m");
  s = setWinningTile(s, "9p");
  eq(s.winningTile, "9p", "和牌张");
  eq(s.concealed, ["1m"], "门前牌不变");
});
test("setWinningTileFromHand 按下标精确移走，不受同种牌干扰", () => {
  let s = createEmptyHand();
  for (const t of ["1m", "2m", "3m", "2m", "5m"]) s = addConcealed(s, t);
  // 门前排好序是 1m 2m 2m 3m 5m；取第 2 个下标（0-based 为 2，即第二张 2m）
  const before = s.concealed.length;
  s = setWinningTileFromHand(s, 2);
  eq(s.winningTile, "2m", "和牌张是 2m");
  eq(s.concealed.length, before - 1, "门前少一张");
  eq(s.concealed.filter((t) => t === "2m").length, 1, "只移走一张 2m");
});
test("清除和牌张", () => {
  let s = createEmptyHand();
  s = setWinningTile(s, "1m");
  s = clearWinningTile(s);
  eq(s.winningTile, null, "应已清除");
});
test("非法牌加入被拒", () => {
  const s = addConcealed(createEmptyHand(), "0z");
  eq(s.concealed, [], "不应加入");
  ok(s.notice !== null, "应提示 ");
});

// ============================================================
console.log("\n【7】副露对门前张数的影响");
// ============================================================
test("一组副露后门前只需 10 张", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  eq(expectedConcealedCount(s.melds), 10, "13 - 3 = 10");
});
test("两组副露后门前只需 7 张", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["1m", "1m", "1m"]);
  s = addMeld(s, ["2p", "2p", "2p"]);
  eq(expectedConcealedCount(s.melds), 7, "13 - 6 = 7");
});
test("副露类型自动猜：连续的当顺子", () => {
  const s = addMeld(createEmptyHand(), ["7s", "8s", "9s"]);
  eq(s.melds[0]!.kind, "run", "应猜为顺子");
});
test("副露类型自动猜：相同的当刻子", () => {
  const s = addMeld(createEmptyHand(), ["1m", "1m", "1m"]);
  eq(s.melds[0]!.kind, "triplet", "应猜为刻子");
});
test("副露类型自动猜：4 张当暗杠（可改）", () => {
  const s = addMeld(createEmptyHand(), ["1m", "1m", "1m", "1m"]);
  eq(s.melds[0]!.kind, "ankan", "应猜为暗杠");
});
test("可以改副露类型（暗杠 vs 明杠符数不同）", () => {
  let s = addMeld(createEmptyHand(), ["1m", "1m", "1m", "1m"]);
  const id = s.melds[0]!.id;
  s = setMeldKind(s, id, "daiminkan");
  eq(s.melds[0]!.kind, "daiminkan", "应已改为明杠");
});
test("删除副露", () => {
  let s = addMeld(createEmptyHand(), ["1m", "1m", "1m"]);
  const id = s.melds[0]!.id;
  s = removeMeld(s, id);
  eq(s.melds.length, 0, "应已删除");
  eq(expectedConcealedCount(s.melds), 13, "门前张数要求恢复");
});
test("副露张数不合法被拒", () => {
  const s = addMeld(createEmptyHand(), ["1m", "2m"]);
  eq(s.melds.length, 0, "不应加入");
  ok(s.notice!.includes("3 或 4 张"), "应提示 ");
});
test("加副露导致门前牌超出时给提示", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 10, "先放 10 张");
  s = addMeld(s, ["1s", "1s", "1s"]);
  // 加了副露后门前上限变 10，正好不超
  ok(s.notice === null, "正好卡住不应提示 ");
  s = addMeld(s, ["2s", "2s", "2s"]);
  // 再加一组，上限变 7，超了 3 张
  ok(s.notice !== null, "超出应提示 ");
  ok(s.notice!.includes("超了"), "提示应说明超出 ");
});

// ============================================================
console.log("\n【8】完整性判断（与 Scorer 的硬契约）");
// ============================================================
// 契约（M1 实测得出）：
//   concealed 张数 + 副露组数×3 + 1(和牌张) = 14
// 即 riichi-score 的 closedTiles 要 `13 - 3×副露组数` 张，和牌张是独立的第 14 张。
//
// 这是录入界面与算番引擎之间的接口。弄错会导致「看着完整却算不出结果」，
// 而且很难查出原因 —— 所以用一组测试钉死。
test("契约：完整 = 14 张 = 门前 13 + 和牌张 1", () => {
  let s = createEmptyHand();
  const tiles = ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"];
  for (const t of tiles) s = addConcealed(s, t);
  eq(s.concealed.length, 13, "门前 13 张");
  eq(isComplete(s), false, "还没有和牌张，不完整");
  s = setWinningTile(s, "9s"); // 外来的和牌张
  eq(s.concealed.length, 13, "外来和牌张不占门前");
  eq(isComplete(s), true, "13 门前 + 1 和牌张 = 14，完整");
});

test("契约：门前 12 + 和牌张 1 = 13 张，不完整", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 12, "门前只 12 张");
  s = setWinningTile(s, "9s");
  eq(isComplete(s), false, "13 张不够，必须 14 张");
});

test("契约：一组副露 = 门前 10 + 副露 3 + 和牌张 1", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["7s", "8s", "9s"]);
  for (const t of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 10, "门前 10 张");
  s = setWinningTile(s, "9s");
  eq(isComplete(s), true, "10 + 3 + 1 = 14，完整");
});

test("契约：两组副露 = 门前 7 + 副露 6 + 和牌张 1", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["1m", "1m", "1m"]);
  s = addMeld(s, ["2p", "2p", "2p"]);
  for (const t of ["1m","2m","3m","4m","5m","6m","7m"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 7, "门前 7 张");
  s = setWinningTile(s, "9s");
  eq(isComplete(s), true, "7 + 6 + 1 = 14，完整");
});

test("取门前牌当和牌张后，需再补一张才算完整", () => {
  let s = createEmptyHand();
  const tiles = ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"];
  for (const t of tiles) s = addConcealed(s, t);
  eq(isComplete(s), false, "还没和牌张");

  // 把手里那张 4p 点成和牌张
  const idx = s.concealed.indexOf("4p");
  s = setWinningTileFromHand(s, idx);
  eq(s.concealed.length, 12, "门前少一张");
  eq(s.winningTile, "4p", "和牌张已定");
  eq(isComplete(s), false, "14 张里少了一张，需要再补一张门前牌");

  // 补一张，就完整了
  s = addConcealed(s, "9s");
  eq(s.concealed.length, 13, "补到 13 张");
  eq(isComplete(s), true, "现在完整");
});

test("剩余张数不含和牌张（和牌张是独立的第 14 张）", () => {
  let s = createEmptyHand();
  eq(remainingSlots(s), 13, "初始门前差 13 张");
  s = addConcealed(s, "1m");
  eq(remainingSlots(s), 12, "加一张后差 12 张");
  s = setWinningTile(s, "9s");
  eq(remainingSlots(s), 12, "设和牌张不影响门前差数");
});

test("副露会减少所需门前张数", () => {
  let s = createEmptyHand();
  eq(remainingSlots(s), 13, "无副露 13");
  s = addMeld(s, ["1m", "2m", "3m"]);
  eq(remainingSlots(s), 10, "一组副露后 10");
  s = addMeld(s, ["1p", "1p", "1p"]);
  eq(remainingSlots(s), 7, "两组副露后 7");
});

test("门前牌加满 13 张后再加会被拒", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p"]) {
    s = addConcealed(s, t);
  }
  eq(s.concealed.length, 13, "已满");
  const after = addConcealed(s, "9s");
  eq(after.concealed.length, 13, "不应加入");
  ok(after.notice !== null, "应提示 ");
});

// ============================================================
console.log("\n【9】文本编辑通道（Q19/Q20 的排错救命通道）");
// ============================================================
test("`+` 表示外来和牌张（荣和的那张），门前牌不受影响", () => {
  // `123m456p789s112z` = 12 张门前，+9s 是别人打出的牌
  const s = textToState("123m456p789s112z+9s");
  eq(s.winningTile, "9s", "和牌张");
  eq(s.concealed.length, 12, "门前仍是 12 张（外来的牌不占门前）");
  eq(s.concealed.filter((t) => t === "9s").length, 1, "门前那 9s 不该被移走");
});

test("`^` 表示取自门前的和牌张，会从门前移走一张", () => {
  // `123m456p789s112z` = 12 张，^1z 表示把手里一张 1z 点成和牌张
  const s = textToState("123m456p789s112z^1z");
  eq(s.winningTile, "1z", "和牌张");
  eq(s.concealed.length, 11, "门前 11 张");
  eq(s.concealed.filter((t) => t === "1z").length, 1, "门前还剩 1 张 1z");
});

test("`^` 不会误删同种牌里不该删的那张", () => {
  // 这里 `456p` 里含 4p，`^4p` 只应移走一张，不该影响其余
  const s = textToState("123m456p789s^4p");
  eq(s.winningTile, "4p", "和牌张");
  // 门前原本 9 张（123m 456p 789s），移走一张 4p → 8 张
  eq(s.concealed.length, 8, "门前 8 张");
  eq(s.concealed.filter((t) => t === "4p").length, 0, "4p 已移作和牌张");
});

test("两条路径行为一致：文本导入 vs 点选", () => {
  // 点选路径：放 9 张门前，把其中 4p（下标 3）点成和牌张
  let viaClick = createEmptyHand();
  for (const t of ["1m","2m","3m","4p","5p","6p","7s","8s","9s"]) {
    viaClick = addConcealed(viaClick, t);
  }
  viaClick = setWinningTileFromHand(viaClick, 3);

  // 文本路径：用 `^` 表达同一件事
  const viaText = textToState("123m456p789s^4p");

  eq(viaText.winningTile, viaClick.winningTile, "和牌张应一致");
  eq(viaText.concealed, viaClick.concealed, "门前牌应一致");
  eq(viaText.concealed.length, 8, "门前 8 张");
});

test("stateToText 导出的和牌张能被再导入", () => {
  let s = createEmptyHand();
  for (const t of ["1m","2m","3m","4p","5p","6p","7s","8s","9s"]) s = addConcealed(s, t);
  s = setWinningTile(s, "4p");
  const text = stateToText(s);
  const back = textToState(text);
  eq(back.winningTile, s.winningTile, "和牌张往返一致");
  eq(back.concealed, s.concealed, "门前往返一致");
});
test("不带 + 时和牌张留空", () => {
  const s = textToState("123m456p789s1122z");
  eq(s.winningTile, null, "无和牌张");
});
test("解析失败时保留原状态并给出错误", () => {
  const prev = textToState("123m");
  const s = textToState("123m@@", prev);
  ok(s.textErrors.length > 0, "应有错误 ");
  eq(s.concealed, prev.concealed, "应保留原有牌");
});
test("带副露的文本导入", () => {
  const s = textToState("123m456p[789s]1122z");
  eq(s.melds.length, 1, "一组副露");
  eq(s.concealed.length, 10, "门前 10 张");
});

// ============================================================
console.log("\n【10】牌面标签（给不用缩写的人看）");
// ============================================================
test("数牌标签", () => {
  eq(tileLabel("1m"), "1万", "1m");
  eq(tileLabel("9p"), "9筒", "9p");
  eq(tileLabel("3s"), "3索", "3s");
});
test("字牌标签", () => {
  eq(tileLabel("1z"), "东", "1z");
  eq(tileLabel("5z"), "白", "5z");
  eq(tileLabel("7z"), "中", "7z");
});
test("赤 5 标签", () => {
  eq(tileLabel("0p"), "赤5筒", "0p");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

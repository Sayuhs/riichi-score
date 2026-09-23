/**
 * 役种速查弹窗的测试。
 *
 * ## 重点验证什么
 *
 * 1. **番数与天凤官方一致** —— 数据是从 `docs/tenhou-mjlog.md` 抄的，
 *    这里逐条对照，防止抄错。役种番数抄错会直接误导用户算钱。
 *
 * 2. **门清/副露的区分是对的** —— 这是弹窗最有价值的一条信息。
 *    平和、一盃口、七对子、立直等副露后不成立，如果标错了，
 *    用户会拿着错的判据去算钱。
 *
 * 3. **每个役都有「怎么认」** —— 用户要的是提示不是规则文档。
 */
import {
  NO_YAKU_HINTS,
  YAKU_GROUPS,
  YAKU_LIST,
  yakuByGroup,
  windHint,
  type YakuInfo,
} from "../yaku-guide.ts";
import { addMeld, addTile, createEmptyHand } from "../hand-state.ts";
import { createDefaultGameState } from "../game-state.ts";
import { buildHandInput } from "../build-input.ts";
import { score } from "../../score/index.ts";

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

/** 按中文名找役 */
function byName(name: string): YakuInfo | undefined {
  return YAKU_LIST.find((y) => y.name === name);
}

// ============================================================
console.log("\n【1】番数与天凤官方表一致（docs/tenhou-mjlog.md）");
// ============================================================
// 下面这些期望值逐条抄自 docs/tenhou-mjlog.md 的「通常役」表。
// 表格格式：[中文名, 门清番, 副露番]，null 表示不成立。

const OFFICIAL_1HAN: [string, number, number | null][] = [
  ["门前清自摸和", 1, null],
  ["立直", 1, null],
  ["一发", 1, null],
  ["抢杠", 1, 1],
  ["岭上开花", 1, 1],
  ["海底摸月", 1, 1],
  ["河底捞鱼", 1, 1],
  ["平和", 1, null],
  ["断幺九", 1, 1],
  ["一盃口", 1, null],
  ["役牌 白", 1, 1],
  ["役牌 发", 1, 1],
  ["役牌 中", 1, 1],
  ["场风牌", 1, 1],
  ["自风牌", 1, 1],
];

for (const [name, closed, open] of OFFICIAL_1HAN) {
  test(`1番役「${name}」门清 ${closed} / 副露 ${open ?? "-"}`, () => {
    const y = byName(name);
    ok(y !== undefined, `${name} 应在列表里 `);
    if (!y) return;
    eq(y.closedHan, closed, "门清番");
    eq(y.openHan, open, "副露番");
  });
}

const OFFICIAL_HIGHER: [string, number, number | null, string][] = [
  ["两立直", 2, null, "2番"],
  ["七对子", 2, null, "2番"],
  ["混全带幺九", 2, 1, "2番"],
  ["一气通贯", 2, 1, "2番"],
  ["三色同顺", 2, 1, "2番"],
  ["三色同刻", 2, 2, "2番"],
  ["三杠子", 2, 2, "2番"],
  ["对对和", 2, 2, "2番"],
  ["三暗刻", 2, 2, "2番"],
  ["小三元", 2, 2, "2番"],
  ["混老头", 2, 2, "2番"],
  ["二盃口", 3, null, "3番"],
  ["纯全带幺九", 3, 2, "3番"],
  ["混一色", 3, 2, "3番"],
  ["清一色", 6, 5, "6番"],
];

for (const [name, closed, open, group] of OFFICIAL_HIGHER) {
  test(`${group}役「${name}」门清 ${closed} / 副露 ${open ?? "-"}`, () => {
    const y = byName(name);
    ok(y !== undefined, `${name} 应在列表里 `);
    if (!y) return;
    eq(y.closedHan, closed, "门清番");
    eq(y.openHan, open, "副露番");
    eq(y.group, group, "分组");
  });
}

// ============================================================
console.log("\n【2】副露后不成立的役标对了（这是弹窗最有价值的信息）");
// ============================================================
const CLOSED_ONLY = ["立直", "门前清自摸和", "一发", "平和", "一盃口", "两立直", "七对子", "二盃口"];

for (const name of CLOSED_ONLY) {
  test(`「${name}」副露后不成立`, () => {
    const y = byName(name);
    ok(y !== undefined, `应存在 `);
    if (!y) return;
    eq(y.openHan, null, "副露番应为 null（不成立）");
    ok(y.closedHan !== null, "门清时应有番数 ");
  });
}

test("断幺九副露后仍然成立（常见误解）", () => {
  const y = byName("断幺九");
  ok(y !== undefined);
  if (!y) return;
  eq(y.openHan, 1, "食断在天凤规则下成立");
});

test("役牌副露后仍成立（碰出来也算）", () => {
  for (const name of ["役牌 白", "役牌 发", "役牌 中", "场风牌", "自风牌"]) {
    const y = byName(name);
    ok(y?.openHan === 1, `${name} 副露应仍是 1 番 `);
  }
});

// ============================================================
console.log("\n【3】每个役都有可读的判据");
// ============================================================
test("所有役都有「怎么认」", () => {
  const missing = YAKU_LIST.filter((y) => !y.how || y.how.length < 5).map((y) => y.name);
  eq(missing, [], "不该有缺判据的役");
});

test("所有役都有中文名和日文名", () => {
  const missing = YAKU_LIST.filter((y) => !y.name || !y.ja).map((y) => y.name ?? "?");
  eq(missing, [], "不该有缺名字的役");
});

test("所有役都归入了某个分组", () => {
  const bad = YAKU_LIST.filter((y) => !YAKU_GROUPS.includes(y.group as never)).map((y) => y.name);
  eq(bad, [], "分组应合法");
});

test("役种名不重复", () => {
  const names = YAKU_LIST.map((y) => y.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  eq(dup, [], "不该有重名");
});

test("engineNames 不重复（否则匹配引擎输出会串）", () => {
  const all: string[] = [];
  const dup: string[] = [];
  for (const y of YAKU_LIST) {
    for (const n of y.engineNames) {
      if (all.includes(n)) dup.push(n);
      all.push(n);
    }
  }
  eq(dup, [], "引擎名不该重复");
});

// ============================================================
console.log("\n【4】分组取用正确");
// ============================================================
test("每个分组都取得到役", () => {
  for (const g of YAKU_GROUPS) {
    const list = yakuByGroup(g);
    ok(list.length > 0, `${g} 不该为空 `);
    ok(list.every((y) => y.group === g), `${g} 里应全是该分组的 `);
  }
});

test("各分组的役数量合理", () => {
  eq(yakuByGroup("1番").length, 15, "1 番 15 个");
  eq(yakuByGroup("2番").length, 11, "2 番 11 个");
  eq(yakuByGroup("3番").length, 3, "3 番 3 个");
  eq(yakuByGroup("6番").length, 1, "6 番 1 个（仅清一色）");
  ok(yakuByGroup("役满").length >= 10, "役满至少 10 个");
});

test("役满的番数字段是 null（点数由倍数决定）", () => {
  for (const y of yakuByGroup("役满")) {
    eq(y.closedHan, null, `${y.name} 的门清番应为 null`);
    eq(y.openHan, null, `${y.name} 的副露番应为 null`);
  }
});

// ============================================================
console.log("\n【5】「没役怎么办」提示覆盖高频错因");
// ============================================================
test("至少有 5 条提示", () => {
  ok(NO_YAKU_HINTS.length >= 5, `实际 ${NO_YAKU_HINTS.length} 条`);
});

test("提到「副露后没役」这个最常见原因", () => {
  const all = NO_YAKU_HINTS.map((h) => h.title + h.body).join(" ");
  ok(all.includes("副露"), "应提到副露 ");
  ok(all.includes("平和") || all.includes("七对子"), "应举出副露后失效的役 ");
});

test("提到「宝牌不算役」这个新手坑", () => {
  const all = NO_YAKU_HINTS.map((h) => h.title + h.body).join(" ");
  ok(all.includes("宝牌"), "应提到宝牌 ");
  ok(all.includes("不算役") || all.includes("不能和"), "应说明宝牌不是役 ");
});

test("提到立直是最省事的凑役方式", () => {
  const all = NO_YAKU_HINTS.map((h) => h.title + h.body).join(" ");
  ok(all.includes("立直"), "应提到立直 ");
});

test("提到断幺和役牌这两个保底手段", () => {
  const all = NO_YAKU_HINTS.map((h) => h.title + h.body).join(" ");
  ok(all.includes("断幺"), "应提到断幺 ");
  ok(all.includes("字牌") || all.includes("白发中"), "应提到字牌刻子 ");
});

test("每条提示都有标题和正文", () => {
  for (const h of NO_YAKU_HINTS) {
    ok(h.title.length > 0, "标题不该为空");
    ok(h.body.length > 10, `正文太短: ${h.body}`);
  }
});

// ============================================================
console.log("\n【6】场风提示随场况变化");
// ============================================================
test("东风场 + 东家（亲家）", () => {
  const t = windHint("east", "east", true);
  ok(t.includes("东场"), "应说东场 ");
  ok(t.includes("东家"), "应说东家 ");
  ok(t.includes("亲家"), "应说亲家 ");
  ok(t.includes("连风") || t.includes("2 番"), "应提到连风算 2 番 ");
});

test("南风场 + 西家（闲家）", () => {
  const t = windHint("south", "west", false);
  ok(t.includes("南场"), "应说南场 ");
  ok(t.includes("西家"), "应说西家 ");
  ok(t.includes("闲家"), "应说闲家 ");
  ok(!t.includes("连风"), "不同风不该提连风 ");
});

test("场风与自风相同时提示连风", () => {
  const t = windHint("south", "south", false);
  ok(t.includes("连风"), "应提示连风 ");
});

// ============================================================
console.log("\n【7】引擎名映射覆盖实际输出");
// ============================================================
// 这些名字来自 riichi-score 实测的输出（见 m1.test.ts 的用例）
test("常见引擎输出都能被映射到中文名", () => {
  const engineOutputs = [
    "riichi", "menzen-tsumo", "pinfu", "tanyao", "iipeiko",
    "sanshoku", "ittsuu", "chanta", "junchan", "honitsu", "chinitsu",
    "chiitoitsu", "toitoi", "sanankou", "shousangen", "honroutou",
    "suuankou", "daisangen", "kokushi-musou", "tsuuiisou", "ryuuiisou",
    "chuuren-poutou", "tenhou", "chiihou", "haku", "hatsu", "chun",
  ];
  const unmapped: string[] = [];
  for (const e of engineOutputs) {
    if (!YAKU_LIST.some((y) => y.engineNames.includes(e))) unmapped.push(e);
  }
  eq(unmapped, [], "这些引擎输出应有对应中文名");
});

// ============================================================
console.log("\n【8】示例牌型必须真的成立该役（用引擎验证）");
// ============================================================
// ⚠️ 这是本文件里最重要的一段。
//
// 手写牌型极易出错 —— 我自己在写测试时就栽过四次（顺手凑出三色、一气、
// 四暗刻等）。示例牌型如果错了，用户会拿着错的判据去算钱。
// 所以每个 exampleTiles 都要过一遍真引擎，确认：
//   ① 是合法的和牌形
//   ② 确实成立它声称的那个役
//
// 依赖场况的役（海底/河底/岭上/抢杠/一发/两立直/天和/地和）不在此列 ——
// 它们的成立靠场况而非牌形，用一个"典型牌形"只作示意，无法验证。

const CONTEXT_ONLY = new Set([
  "海底摸月", "河底捞鱼", "岭上开花", "抢杠", "一发", "两立直", "天和", "地和",
]);

const examplesToVerify = YAKU_LIST.filter(
  (y) => y.exampleTiles && !CONTEXT_ONLY.has(y.name),
);

console.log(`  （共 ${examplesToVerify.length} 个役的牌型需要验证）`);

for (const y of examplesToVerify) {
  await testAsync(`示例牌型成立「${y.name}」`, async () => {
    const ex = y.exampleTiles!;
    let s = createEmptyHand();
    // 先加副露（如果有），门前牌数会相应减少
    for (const m of ex.melds ?? []) {
      s = addMeld(s, m.tiles);
    }
    for (const t of ex.concealed) s = addTile(s, t);
    s = addTile(s, ex.winning);

    const built = buildHandInput(s, {
      ...createDefaultGameState(),
      // 一律用自摸，避免荣和需要指定放铳者；立直类役靠 isRiichi 开关
      winType: "tsumo",
      isRiichi: y.engineNames.includes("riichi") || y.engineNames.includes("double-riichi"),
      isDoubleRiichi: y.engineNames.includes("double-riichi"),
    });
    ok(built.ok, `应能构造输入（${built.ok ? "" : built.reason}）`);
    if (!built.ok) return;

    const r = await score(built.input);
    ok(
      !("error" in r),
      `应能算出来（实际: ${"error" in r ? r.error.kind + ": " + r.error.message : ""}）`,
    );
    if ("error" in r) return;

    const names = r.yaku.map((x: { name: string }) => x.name);
    const hit = y.engineNames.some((n) => names.includes(n));
    ok(hit, `牌型应成立「${y.name}」，引擎实际给出 [${names.join(", ")}]`);
  });
}

test("依赖场况的役不提供牌型验证（只用示意牌型）", () => {
  // 这些役的成立靠场况，验证不了 —— 但要确保它们的内容没被漏掉
  for (const name of CONTEXT_ONLY) {
    const y = YAKU_LIST.find((x) => x.name === name);
    ok(y !== undefined, `${name} 应在列表里 `);
    ok(y!.how.length > 5, `${name} 应有判据 `);
  }
});

test("所有提供牌型的役，牌张数符合 Scorer 约定", () => {
  for (const y of YAKU_LIST) {
    if (!y.exampleTiles) continue;
    const ex = y.exampleTiles;
    const meldCount = ex.melds?.length ?? 0;
    // 契约（与 riichi-score 的 closedTiles 一致）：
    //   concealed + meldCount × 3 + 1(和牌张) = 14
    // ⚠️ 注意：杠虽然占 4 张牌，但**只算一组（3 张手牌位）** ——
    //    这是 Scorer 的约定，不是按实际牌数算。
    const expected = 13 - 3 * meldCount;
    ok(
      ex.concealed.length === expected,
      `${y.name} 门前应是 ${expected} 张（${meldCount} 组副露），实际 ${ex.concealed.length} 张`,
    );
  }
});

test("有副露的例子里，副露张数是 3 或 4", () => {
  for (const y of YAKU_LIST) {
    const melds = y.exampleTiles?.melds;
    if (!melds) continue;
    for (const m of melds) {
      ok(
        m.tiles.length === 3 || m.tiles.length === 4,
        `${y.name} 的副露应是 3 或 4 张，实际 ${m.tiles.length}`,
      );
    }
  }
});

test("所有提供牌型的役，和牌张也应在牌形里说得通", () => {
  for (const y of YAKU_LIST) {
    if (!y.exampleTiles) continue;
    ok(y.exampleTiles.winning.length === 2, `${y.name} 的和牌张应是单张 `);
  }
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

/**
 * 试算沙盒的结果格式化测试。
 *
 * ## 这一组在防什么
 *
 * 沙盒那一行是**用户会照着收钱的数字**（番/符/点）。格式错了
 * （比如役满显示成「0 番」、或者漏了役名）会直接误导。
 *
 * 另外它必须是**固定高度的一行**，所以 `text` 任何情况下都不能是
 * `undefined`/`null` —— 那会让那一行塌掉、推动上方牌表。
 */
import type { ScoreError, ScoreResult } from "../../score/types.ts";
import { formatSandboxResult } from "../sandbox-result.ts";

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

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

function eq(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}\n      期望 ${b}\n      实际 ${a}`);
}

/** 造一个只填必要字段的结果 */
function makeResult(part: Partial<ScoreResult>): ScoreResult {
  return {
    yaku: [],
    han: 1,
    fu: 30,
    basicPoints: 240,
    fuItems: [],
    honbaPayments: [],
    riichiBonus: 0,
    basePayments: [],
    finalPayments: [],
    total: 1000,
    dora: 0,
    uradora: 0,
    akadora: 0,
    ...part,
  };
}

// ============================================================
console.log("\n【1】还没录完时不显示错误");
// ============================================================

test("没录完 → 空文案、中性配色", () => {
  const r = formatSandboxResult(null, { kind: "no-yaku", message: "" }, false);
  eq(r.tone, "idle", "配色");
  eq(r.text, "", "文案应为空（固定高度靠这个不抖）");
});

test("没录完时即使有错误也不当成错误显示", () => {
  // 录到一半必然是「还差几张」，不该红着脸报错
  const r = formatSandboxResult(
    null,
    { kind: "invalid-hand", message: "" } as ScoreError,
    false,
  );
  eq(r.tone, "idle", "不该是 bad");
});

// ============================================================
console.log("\n【2】失败情况的文案");
// ============================================================

test("无役 → bad + 中文说明", () => {
  const r = formatSandboxResult(null, { kind: "no-yaku", message: "" }, true);
  eq(r.tone, "bad", "配色");
  ok(r.text.includes("无役"), `实际：${r.text}`);
});

test("牌型不成立 → bad", () => {
  const r = formatSandboxResult(null, { kind: "invalid-hand", message: "" }, true);
  eq(r.tone, "bad", "配色");
  ok(r.text.includes("不成立"), `实际：${r.text}`);
});

test("场况矛盾 → bad", () => {
  const r = formatSandboxResult(null, { kind: "invalid-context", message: "" }, true);
  eq(r.tone, "bad", "配色");
});

test("任何失败情况下文案都非空（固定高度不能塌）", () => {
  for (const kind of ["no-yaku", "invalid-hand", "invalid-context", "engine-error"] as const) {
    const r = formatSandboxResult(null, { kind, message: "" }, true);
    ok(typeof r.text === "string" && r.text.length > 0, `${kind} 的文案是空的`);
  }
});

// ============================================================
console.log("\n【3】正常结果");
// ============================================================

test("有役 → ok + 役名 / 番 / 符 / 点", () => {
  const r = formatSandboxResult(
    makeResult({
      yaku: [{ name: "riichi", han: 1 }],
      han: 1,
      fu: 40,
      total: 1300,
    }),
    null,
    true,
  );
  eq(r.tone, "ok", "配色");
  ok(r.text.includes("立直"), `应含役名，实际：${r.text}`);
  ok(r.text.includes("1 番"), `应含番数，实际：${r.text}`);
  ok(r.text.includes("40 符"), `应含符数，实际：${r.text}`);
  ok(r.text.includes("1,300") || r.text.includes("1300"), `应含点数，实际：${r.text}`);
});

test("多役用顿号连起来", () => {
  const r = formatSandboxResult(
    makeResult({
      yaku: [
        { name: "riichi", han: 1 },
        { name: "pinfu", han: 1 },
        { name: "tanyao", han: 1 },
      ],
      han: 3,
    }),
    null,
    true,
  );
  const names = ["立直", "平和", "断幺九"];
  for (const n of names) ok(r.text.includes(n), `缺 ${n}：${r.text}`);
  ok(r.text.includes("、"), "应该用顿号连起来");
});

test("★ 役满不能显示成「0 番」（役满时 han 是 0）", () => {
  const r = formatSandboxResult(
    makeResult({
      yaku: [{ name: "kokushi-musou", han: 0, limit: "yakuman" }],
      han: 0,
      fu: 0,
      limit: "yakuman",
      total: 32000,
    }),
    null,
    true,
  );
  ok(!r.text.includes("0 番"), `不该出现「0 番」：${r.text}`);
  ok(r.text.includes("役满"), `应显示役满：${r.text}`);
});

test("双倍役满的倍数标签正确", () => {
  const r = formatSandboxResult(
    makeResult({
      yaku: [{ name: "suuankou", han: 0, limit: "double-yakuman" }],
      limit: "double-yakuman",
      total: 64000,
    }),
    null,
    true,
  );
  ok(r.text.includes("双倍役满"), `实际：${r.text}`);
});

test("只有宝牌没有役时标成 bad（宝牌不算役）", () => {
  const r = formatSandboxResult(
    makeResult({ yaku: [], dora: 3, han: 3, total: 2600 }),
    null,
    true,
  );
  eq(r.tone, "bad", "配色");
  ok(r.text.includes("不算役"), `应说明宝牌不算役，实际：${r.text}`);
});

// ============================================================
console.log("\n【4】固定高度契约");
// ============================================================

test("任何输入组合下 text 都是字符串", () => {
  const cases: (ScoreResult | null)[] = [null, makeResult({})];
  const errs: (ScoreError | null)[] = [
    null,
    { kind: "no-yaku", message: "" },
    { kind: "invalid-hand", message: "" },
    { kind: "invalid-context", message: "" },
    { kind: "engine-error", message: "" },
  ];
  for (const r of cases)
    for (const e of errs)
      for (const ready of [true, false]) {
        const out = formatSandboxResult(r, e, ready);
        ok(typeof out.text === "string", `text 不是字符串（ready=${ready}）`);
        ok(
          out.tone === "ok" || out.tone === "bad" || out.tone === "idle",
          `tone 非法：${out.tone}`,
        );
      }
});

test("无役时不应该同时显示点数（会误导）", () => {
  const r = formatSandboxResult(null, { kind: "no-yaku", message: "" }, true);
  ok(!r.text.includes("点"), `无役的文案里不该有「点」：${r.text}`);
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;

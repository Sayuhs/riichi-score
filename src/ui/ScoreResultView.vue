<script setup lang="ts">
/**
 * 结算结果展示 —— M3 的产出。
 *
 * 按 Q21 的要求展示：
 *  - 役种清单 + 番数 + 符数 + 点数
 *  - **逐项符明细**（底 20 符 / 中张暗刻 +4 / 单骑听 +2 ...）
 *    这是「这怎么算的」争论时唯一能立刻服人的东西，而且库已经吐出来了
 *  - 四家支付明细（含本场与立直棒）
 *
 * 不做「牌-役对应高亮」（Q21 明确排除，成本高收益低）。
 */
import { computed } from "vue";
import type { ScoreResult } from "../score/types.ts";
import { fuReasonLabel, limitLabel, seatLabel, tierLabel, yakuLabel } from "./labels.ts";

const props = defineProps<{
  result: ScoreResult;
  /** 和牌者的座位，用于高亮 */
  winnerSeat: string;
  /** 和了方式，用于支付说明 */
  winType: "ron" | "tsumo";
}>();

/** 点数档次（满贯 / 跳满 / 役满...） */
const tier = computed(() => tierLabel(props.result.han, props.result.fu, props.result.limit));

/** 番数是否来自役满（役满时 han 是 0，不能直接显示"0番"） */
const isYakuman = computed(() => props.result.limit?.includes("yakuman") ?? false);

/** 番数显示文本 */
const hanText = computed(() => {
  if (isYakuman.value) return limitLabel(props.result.limit);
  return `${props.result.han} 番`;
});

/** 本场 / 立直棒的存在性 */
const hasHonba = computed(() => props.result.honbaPayments.length > 0);
const hasSticks = computed(() => props.result.riichiBonus > 0);

/** 支付明细：合并「基础支付」与「本场」以便逐家展示 */
const paymentRows = computed(() => {
  const rows: { seat: string; base: number; honba: number; total: number }[] = [];
  const seats = new Set<string>();
  for (const p of props.result.basePayments) seats.add(p.seat);
  for (const p of props.result.honbaPayments) seats.add(p.seat);

  for (const seat of ["east", "south", "west", "north"]) {
    if (!seats.has(seat)) continue;
    const base = props.result.basePayments.find((p) => p.seat === seat)?.value ?? 0;
    const honba = props.result.honbaPayments.find((p) => p.seat === seat)?.value ?? 0;
    rows.push({ seat, base, honba, total: base + honba });
  }
  return rows;
});

/** 支付方式说明 */
const payNote = computed(() =>
  props.winType === "tsumo" ? "自摸：三家分别支付" : "荣和：放铳者支付",
);
</script>

<template>
  <div class="result">
    <!-- ===== 总分（最大的数字）===== -->
    <section class="card total-card">
      <span class="card-title">和牌者收入</span>
      <div class="total-line">
        <strong class="total-num">{{ result.total.toLocaleString() }}</strong>
        <span class="total-unit">点</span>
      </div>
      <div class="total-sub">
        <span class="chip">{{ hanText }}</span>
        <span v-if="!isYakuman" class="chip">{{ result.fu }} 符</span>
        <span v-if="tier" class="chip chip-tier">{{ tier }}</span>
        <span class="chip">基本点 {{ result.basicPoints }}</span>
      </div>
    </section>

    <!-- ===== 役种清单 ===== -->
    <section class="card">
      <span class="card-title">役种</span>
      <ul v-if="result.yaku.length" class="yaku-list">
        <li v-for="(y, i) in result.yaku" :key="i" class="yaku">
          <span class="yaku-name">{{ yakuLabel(y.name) }}</span>
          <span class="yaku-han">
            {{ y.limit ? limitLabel(y.limit) : y.han > 0 ? y.han + " 番" : "—" }}
          </span>
        </li>
      </ul>
      <p v-else class="muted">（无役种，来自手动覆盖）</p>

      <!-- 宝牌单列，因为它们是"加番"而不是役 -->
      <div v-if="result.dora || result.uradora || result.akadora" class="dora-line">
        <span v-if="result.dora" class="chip chip-dora">宝牌 {{ result.dora }}</span>
        <span v-if="result.uradora" class="chip chip-dora">里宝牌 {{ result.uradora }}</span>
        <span v-if="result.akadora" class="chip chip-dora">赤宝牌 {{ result.akadora }}</span>
      </div>
    </section>

    <!-- ===== 逐项符明细（Q21：争论时唯一能立刻服人的东西）===== -->
    <section v-if="result.fuItems.length" class="card">
      <span class="card-title">
        符的明细
        <span class="fu-sum">合计 {{ result.fu }} 符</span>
      </span>
      <ul class="fu-list">
        <li v-for="(f, i) in result.fuItems" :key="i" class="fu">
          <span class="fu-reason">{{ fuReasonLabel(f.reason) }}</span>
          <span class="fu-val">{{ f.value > 0 ? "+" + f.value : f.value }}</span>
        </li>
      </ul>
    </section>

    <!-- ===== 支付明细 ===== -->
    <section class="card">
      <span class="card-title" :title="payNote">支付明细</span>
      <div class="pay-table">
        <div v-for="row in paymentRows" :key="row.seat" class="pay-row">
          <span class="pay-seat">{{ seatLabel(row.seat as never) }}</span>
          <span class="pay-detail">
            <template v-if="row.honba > 0">
              {{ row.base }} + {{ row.honba }}（本场）
            </template>
            <template v-else>{{ row.total }}</template>
          </span>
          <strong class="pay-total">{{ row.total.toLocaleString() }}</strong>
        </div>
      </div>

      <!-- 立直棒 -->
      <div v-if="hasSticks" class="pay-extra">
        <span class="pay-seat">立直棒</span>
        <strong class="pay-total plus">+{{ result.riichiBonus.toLocaleString() }}</strong>
      </div>

      <!-- 合计 -->
      <div class="pay-sum">
        <span>合计</span>
        <strong>{{ result.total.toLocaleString() }} 点</strong>
      </div>

      <p v-if="hasHonba || hasSticks" class="pay-note">
        <template v-if="hasHonba">本场 {{ result.honbaPayments }} 已计入。</template>
        本场与立直棒由本工具自行计算（引擎不含这两项）。
      </p>
    </section>

    <!-- ===== 手动覆盖标记 ===== -->
    <p v-if="result.overridden" class="override-note">
      此结果是**手动覆盖**的，不是引擎算出来的。
    </p>
  </div>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card {
  background: var(--card);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-hard);
  padding: 7px 8px;
}

.card-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  opacity: 0.6;
  margin-bottom: 5px;
  text-transform: uppercase;
}

/* ---- 总分卡片：最醒目 ---- */
.total-card {
  background: var(--pop-yellow);
}

.total-line {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.total-num {
  font-size: 34px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
  text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.15);
}

.total-unit {
  font-size: 13px;
  font-weight: 800;
}

.total-sub {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.chip {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}
.chip-tier {
  background: var(--pop-pink);
  color: #fff;
}
.chip-dora {
  background: var(--pop-orange);
  color: #fff;
}

/* ---- 役种 ---- */
.yaku-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yaku {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  padding: 3px 5px;
  background: #f7f4ec;
  border-radius: var(--radius-sm);
}

.yaku-name {
  font-weight: 800;
}

.yaku-han {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.7;
  white-space: nowrap;
}

.dora-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

/* ---- 符明细 ---- */
.fu-sum {
  font-size: 10px;
  font-weight: 800;
  opacity: 0.85;
  text-transform: none;
  letter-spacing: 0;
}

.fu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
}

.fu {
  display: contents;
}

.fu-reason {
  font-size: 11px;
  padding: 2px 5px;
}

.fu-val {
  font-size: 11px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-align: right;
  padding: 2px 5px;
}

/* ---- 支付明细 ---- */
.pay-table {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pay-row,
.pay-extra,
.pay-sum {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
}

.pay-seat {
  font-weight: 800;
  min-width: 3.5em;
}

.pay-detail {
  font-size: 10px;
  opacity: 0.65;
  margin-left: auto;
}

.pay-total {
  font-size: 14px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  min-width: 4.5em;
  text-align: right;
}
.pay-total.plus {
  color: var(--accent);
}

.pay-extra {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px dashed var(--card-border);
}

.pay-sum {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 2px solid var(--ink);
  font-weight: 900;
}
.pay-sum strong {
  margin-left: auto;
  font-size: 14px;
}

.pay-note {
  margin: 5px 0 0;
  font-size: 9px;
  opacity: 0.6;
  line-height: 1.3;
}

.muted {
  font-size: 11px;
  opacity: 0.6;
  margin: 0;
}

.override-note {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  padding: 6px 8px;
  background: var(--warn-bg);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
}
</style>

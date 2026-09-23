<script setup lang="ts">
/**
 * 局面设置面板 —— M3 的一半输入。
 *
 * 光有手牌算不出番符，还得知道"什么场、谁在和、怎么和的"。
 * 这个面板收集：场风 / 自风 / 和了方式 / 放铳者 / 本场 / 立直棒 /
 * 役种开关 / 宝牌指示牌。
 *
 * ## 设计要点
 *
 * 1. **不可能的选项直接禁用**，而不是让用户点完再报错。
 *    比如有副露时「立直」不可点、荣和时才显示「放铳者」。
 *    校验逻辑在 game-state.ts 的 validateGameState，这里只做呈现。
 *
 * 2. **本场/立直棒用步进器**而不是数字键盘输入 —— 线下打牌时
 *    「这本几本场了」通常是个位数，点一下比打字快。
 *
 * 3. 波普风：和 M2 一致的粗黑边 + 硬阴影 + 高饱和底色。
 */
import { computed } from "vue";
import {
  ALL_SEATS,
  isDealer,
  parseIndicatorInput,
  SEAT_LABELS,
  type GameState,
} from "./game-state.ts";

const props = defineProps<{
  game: GameState;
  /** 手牌是否门清（决定立直能不能点） */
  isMenzen: boolean;
  /** 副露组数（决定天和/地和能不能点） */
  meldCount: number;
  /** 校验出的问题，用于禁用/标红对应字段 */
  issues: { field: string; message: string }[];
}>();

const emit = defineEmits<{
  (e: "update:game", value: GameState): void;
}>();

function patch(part: Partial<GameState>) {
  emit("update:game", { ...props.game, ...part });
}

/** 某字段是否有问题 */
function hasIssue(field: string): boolean {
  return props.issues.some((i) => i.field === field);
}

function issueOf(field: string): string {
  return props.issues.find((i) => i.field === field)?.message ?? "";
}

// ---------------------------------------------------------------- 宝牌

const doraText = computed({
  get: () => props.game.doraIndicators.join(""),
  set: (v: string) => {
    const { tiles } = parseIndicatorInput(v);
    patch({ doraIndicators: tiles });
  },
});

const uradoraText = computed({
  get: () => props.game.uradoraIndicators.join(""),
  set: (v: string) => {
    const { tiles } = parseIndicatorInput(v);
    patch({ uradoraIndicators: tiles });
  },
});

const doraError = computed(() => parseIndicatorInput(doraText.value).error);
const uradoraError = computed(() => parseIndicatorInput(uradoraText.value).error);

// ---------------------------------------------------------------- 开关

type FlagKey =
  | "isRiichi"
  | "isDoubleRiichi"
  | "isIppatsu"
  | "isHaitei"
  | "isHoutei"
  | "isRinshan"
  | "isChankan"
  | "isTenhou"
  | "isChiihou";

/** 哪些开关在什么条件下不可用 */
const flags = computed<
  { key: FlagKey; label: string; disabled: boolean; why: string }[]
>(() => {
  const tsumo = props.game.winType === "tsumo";
  const ron = props.game.winType === "ron";
  const menzen = props.isMenzen;
  const dealer = isDealer(props.game);
  return [
    {
      key: "isRiichi",
      label: "立直",
      disabled: !menzen,
      why: "立直必须门清",
    },
    {
      key: "isDoubleRiichi",
      label: "两立直",
      disabled: !menzen,
      why: "两立直必须门清",
    },
    {
      key: "isIppatsu",
      label: "一发",
      disabled: !menzen || (!props.game.isRiichi && !props.game.isDoubleRiichi),
      why: "一发要建立在立直之上",
    },
    { key: "isHaitei", label: "海底摸月", disabled: !tsumo, why: "海底必须自摸" },
    { key: "isHoutei", label: "河底捞鱼", disabled: !ron, why: "河底必须荣和" },
    { key: "isRinshan", label: "岭上开花", disabled: !tsumo, why: "岭上必须自摸" },
    { key: "isChankan", label: "抢杠", disabled: !ron, why: "抢杠必须荣和" },
    {
      key: "isTenhou",
      label: "天和",
      disabled: !tsumo || !menzen || !dealer,
      why: "天和必须亲家自摸且门清",
    },
    {
      key: "isChiihou",
      label: "地和",
      disabled: !tsumo || !menzen || dealer,
      why: "地和必须闲家自摸且门清",
    },
  ];
});

function toggle(key: FlagKey, disabled: boolean) {
  if (disabled) return;
  patch({ [key]: !props.game[key] } as Partial<GameState>);
}

// ---------------------------------------------------------------- 本场/立直棒

function stepHonba(delta: number) {
  const next = Math.max(0, Math.min(99, props.game.honba + delta));
  patch({ honba: next });
}

function stepSticks(delta: number) {
  const next = Math.max(0, Math.min(20, props.game.riichiSticks + delta));
  patch({ riichiSticks: next });
}

/** 放铳者候选：除和牌者外的三家 */
const discarderOptions = computed(() =>
  ALL_SEATS.filter((s) => s !== props.game.seatWind),
);
</script>

<template>
  <div class="panel">
    <!-- ===== 场风 / 自风 ===== -->
    <section class="card">
      <span class="card-title">场况</span>
      <div class="grid2">
        <label class="field">
          <span class="lbl">场风</span>
          <div class="seg">
            <button
              v-for="s in ALL_SEATS"
              :key="`r-${s}`"
              type="button"
              class="seg-btn"
              :class="{ on: game.roundWind === s }"
              @click="patch({ roundWind: s })"
            >
              {{ SEAT_LABELS[s] }}
            </button>
          </div>
        </label>

        <label class="field">
          <span class="lbl">
            自风
            <em v-if="isDealer(game)" class="dealer-mark">亲</em>
          </span>
          <div class="seg">
            <button
              v-for="s in ALL_SEATS"
              :key="`s-${s}`"
              type="button"
              class="seg-btn"
              :class="{ on: game.seatWind === s }"
              @click="patch({ seatWind: s })"
            >
              {{ SEAT_LABELS[s] }}
            </button>
          </div>
        </label>
      </div>
    </section>

    <!-- ===== 和了方式 ===== -->
    <section class="card">
      <span class="card-title">和了方式</span>
      <div class="seg seg-wide">
        <button
          type="button"
          class="seg-btn"
          :class="{ on: game.winType === 'ron' }"
          @click="patch({ winType: 'ron' })"
        >
          荣和
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ on: game.winType === 'tsumo' }"
          @click="patch({ winType: 'tsumo' })"
        >
          自摸
        </button>
      </div>

      <!-- 放铳者（仅荣和） -->
      <div v-if="game.winType === 'ron'" class="field mt">
        <span class="lbl" :class="{ bad: hasIssue('from') }">放铳者</span>
        <div class="seg">
          <button
            v-for="s in discarderOptions"
            :key="`f-${s}`"
            type="button"
            class="seg-btn"
            :class="{ on: game.from === s }"
            @click="patch({ from: s })"
          >
            {{ SEAT_LABELS[s] }}
          </button>
        </div>
      </div>
    </section>

    <!-- ===== 本场 / 立直棒 ===== -->
    <section class="card">
      <span class="card-title">本场 / 供托</span>
      <div class="grid2">
        <div class="field">
          <span class="lbl">本场数</span>
          <div class="stepper">
            <button type="button" class="step" @click="stepHonba(-1)">−</button>
            <span class="step-val">{{ game.honba }}</span>
            <button type="button" class="step" @click="stepHonba(1)">+</button>
          </div>
          <span class="sub">荣和放铳者 +300/本，自摸每家 +100/本</span>
        </div>

        <div class="field">
          <span class="lbl">立直棒</span>
          <div class="stepper">
            <button type="button" class="step" @click="stepSticks(-1)">−</button>
            <span class="step-val">{{ game.riichiSticks }}</span>
            <button type="button" class="step" @click="stepSticks(1)">+</button>
          </div>
          <span class="sub">每根 1000 点，归和牌者</span>
        </div>
      </div>
    </section>

    <!-- ===== 役种开关 ===== -->
    <section class="card">
      <span class="card-title">役种</span>
      <div class="flags">
        <button
          v-for="f in flags"
          :key="f.key"
          type="button"
          class="flag"
          :class="{ on: game[f.key], off: f.disabled }"
          :disabled="f.disabled"
          :title="f.disabled ? f.why : ''"
          @click="toggle(f.key, f.disabled)"
        >
          {{ f.label }}
        </button>
      </div>
      <p v-if="issues.length" class="issue-list">
        <span v-for="(i, n) in issues" :key="n" class="issue">{{ i.message }}</span>
      </p>
    </section>

    <!-- ===== 宝牌 ===== -->
    <section class="card">
      <span class="card-title">宝牌指示牌</span>
      <div class="grid2">
        <label class="field">
          <span class="lbl">表宝牌</span>
          <input
            v-model="doraText"
            class="txt"
            :class="{ bad: !!doraError }"
            placeholder="如 13m"
            spellcheck="false"
          />
          <span v-if="doraError" class="sub bad">{{ doraError }}</span>
          <span v-else class="sub">按天凤记法，如 1m 3p</span>
        </label>

        <label class="field">
          <span class="lbl">里宝牌</span>
          <input
            v-model="uradoraText"
            class="txt"
            :class="{ bad: !!uradoraError }"
            placeholder="如 2s"
            spellcheck="false"
            :disabled="!game.isRiichi && !game.isDoubleRiichi"
          />
          <span v-if="uradoraError" class="sub bad">{{ uradoraError }}</span>
          <span v-else-if="!game.isRiichi && !game.isDoubleRiichi" class="sub">
            只在立直时翻开
          </span>
          <span v-else class="sub">立直时才能看</span>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.panel {
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
  display: block;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  opacity: 0.6;
  margin-bottom: 5px;
  text-transform: uppercase;
}

.grid2 {
  display: grid;
  /* ⚠️ 用 minmax(0, 1fr) 而不是 1fr ——
     默认的 1fr 有 min-content 下限，内容偏宽时会把格子撑开，
     导致卡片宽度抖动（甚至整体横向溢出）。
     minmax(0, 1fr) 允许格子收缩，宽度就固定了。 */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.lbl {
  font-size: 10px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 3px;
}
.lbl.bad {
  color: var(--err-ink);
}

.dealer-mark {
  font-style: normal;
  font-size: 9px;
  background: var(--pop-pink);
  color: #fff;
  border-radius: 999px;
  padding: 0 4px;
  font-weight: 900;
}

.sub {
  font-size: 9px;
  opacity: 0.6;
  line-height: 1.25;
}
.sub.bad {
  color: var(--err-ink);
  opacity: 1;
  font-weight: 700;
}

/* ---- 分段控件 ---- */
/* ⚠️ 防抖动：所有分段按钮用固定的 flex 基准（flex: 1 1 0），
   而不是 flex: 1（= flex: 1 1 0%）。
   两者看起来一样，但 flex-basis: auto 时按钮宽度会随文字内容变化 ——
   比如「东」和「荣和」宽度不同，切换时整行会横向抖动。 */
.seg {
  display: flex;
  gap: 3px;
  width: 100%;
}
.seg-wide .seg-btn {
  flex: 1 1 0;
  min-height: 32px;
  font-size: 12px;
}

.seg-btn {
  flex: 1 1 0;
  min-width: 0;
  font-size: 12px;
  font-weight: 800;
  padding: 5px 2px;
  border: 1.5px solid var(--ink);
  background: #fff;
  color: var(--ink);
  border-radius: var(--radius-sm);
  cursor: pointer;
  min-height: 28px;
  /* 文字不换行，避免"东家"折成两行改变高度 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.seg-btn.on {
  background: var(--accent);
  box-shadow: var(--shadow-hard-sm);
}

/* ---- 步进器 ---- */
/* ⚠️ 防抖动：三个元素宽度固定。
   stepper 默认会被父容器拉伸，数字位数变化（0 → 10）时宽度会变，
   左右两个按钮就被推着动。所以中间的数字给固定宽度。 */
.stepper {
  display: flex;
  align-items: center;
  gap: 3px;
}

.step {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  font-size: 16px;
  font-weight: 900;
  line-height: 1;
  border: 1.5px solid var(--ink);
  background: var(--pop-yellow);
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--ink);
}
.step:active {
  transform: translate(1px, 1px);
}

.step-val {
  flex: 1 1 auto;
  min-width: 2.2em;
  text-align: center;
  font-size: 16px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

/* ---- 役种开关 ---- */
/* ⚠️ 防抖动：给容器固定高度。
   9 个开关在 360px 屏上会折成 3~4 行，行数随字体渲染略有差异；
   不固定高度的话，勾选状态变化时整张卡片高度会跳。 */
.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  /* 4 行 × (28 + 4) - 4 = 124px，留出余量 */
  min-height: 124px;
  align-content: flex-start;
}

.flag {
  font-size: 11px;
  font-weight: 800;
  padding: 5px 8px;
  border: 1.5px solid var(--ink);
  background: #fff;
  color: var(--ink);
  border-radius: 999px;
  cursor: pointer;
  min-height: 28px;
  /* ⚠️ 固定不换行：否则文字折行会让按钮高度不同，一整行就参差不齐 */
  white-space: nowrap;
}
.flag.on {
  background: var(--pop-cyan);
  box-shadow: var(--shadow-hard-sm);
}
/* 不可用：划掉 + 变灰，一眼看出"这个场面不可能" */
.flag.off {
  opacity: 0.35;
  text-decoration: line-through;
  cursor: not-allowed;
}

/* 校验问题列表：固定最小高度，避免出现/消失时卡片高度变 */
.issue-list {
  margin: 6px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}
.issue {
  font-size: 10px;
  font-weight: 700;
  color: var(--err-ink);
}
.issue::before {
  content: "⚠ ";
}

/* ---- 文本输入 ---- */
.txt {
  width: 100%;
  padding: 5px 6px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 13px;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink);
  min-width: 0;
  /* ⚠️ box-sizing 已在全局设置，但这里再声明一次以防万一 ——
     不加的话输入框会因 padding/border 撑宽容器，造成横向抖动 */
  box-sizing: border-box;
}
.txt:disabled {
  opacity: 0.45;
}
.txt.bad {
  border-color: var(--err-ink);
  background: #fff0f4;
}

.mt {
  margin-top: 6px;
}
</style>

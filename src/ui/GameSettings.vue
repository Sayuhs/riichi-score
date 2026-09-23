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
import { computed, ref } from "vue";
import {
  ALL_SEATS,
  canWinOnFirstTurn,
  isDealer,
  SEAT_LABELS,
  type GameState,
} from "./game-state.ts";
import {
  MAX_INDICATORS,
  SELECTABLE_KINDS,
  canPick,
  removeIndicator,
  toggleIndicator,
  uradoraEnabled,
  type IndicatorState,
} from "./dora-picker.ts";
import TileImage from "./TileImage.vue";

const props = defineProps<{
  game: GameState;
  /** 手牌是否门清（决定立直能不能点） */
  isMenzen: boolean;
  /** 副露组数（决定天和/地和能不能点） */
  meldCount: number;
  /**
   * 手牌 + 副露里每种牌的张数（键是归一后的牌面，如 `"5m"`）。
   *
   * 用来实现「同一张牌（手牌 + 副露 + 表宝 + 里宝）≤ 4 张」——
   * 引擎会校验这条，但它吐的是英文 `A tile appears more than four times`，
   * 所以我们提前把已经用满的牌种禁掉。
   */
  handCounts: Record<string, number>;
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

// ---------------------------------------------------------------- 宝牌指示牌
//
// ## 为什么改成牌面点选，而不是继续用文本框
//
// 原来的文本框有一个**修不干净**的 bug：
//   v-model 绑在 computed 上，getter 返回 state 的拼接、setter 解析后回写。
//   解析失败时不更新 state → getter 立刻回吐旧值（空串）
//   → Vue 的 `beforeUpdate` 每次重渲染都把 DOM 覆盖回空串
//   → **逐键打进去的字符全部被吞**（只有一次性粘贴完整串才成功）。
//   更糟的是那个「格式错误」提示是**死代码**，永远不会亮 ——
//   用户只看到字消失，得不到任何反馈。
//
// 改成点选后，那套 getter/setter 整个消失，问题从「修」变成「不存在」。
//
// ## 规则在哪
//
// 全在 `dora-picker.ts`（纯函数，有 24 条测试）。
// 因为引擎对指示牌**几乎不校验**（实测：6 张、8 张都照收，非法牌面静默忽略），
// 所以「最多 5 张」「表里一一对应」「同一张牌 ≤ 4」全靠那一层挡。

/** 当前展开的是哪个选择器（null = 都收起） */
const openPicker = ref<null | "dora" | "uradora">(null);

/** 上一次点选失败的提示（如「里宝不能超过表宝」） */
const pickerNotice = ref<string | null>(null);

const indicatorState = computed<IndicatorState>(() => ({
  dora: props.game.doraIndicators,
  uradora: props.game.uradoraIndicators,
}));

/** 手牌 + 副露里某张牌有几张 —— 供「同一张牌 ≤ 4」的合并计数用 */
const countInHand = (kind: string) => props.handCounts[kind] ?? 0;

/** 里宝整块能不能操作（未立直、或还没选表宝时锁死） */
const uradoraOk = computed(() =>
  uradoraEnabled(
    indicatorState.value,
    props.game.isRiichi || props.game.isDoubleRiichi,
  ),
);

/** 某张牌在当前状态下能不能选（用于把不能选的置灰） */
function canPickTile(which: "dora" | "uradora", tile: string): boolean {
  return canPick(which, tile, indicatorState.value, countInHand).ok;
}

/** 点一下牌表里的牌：已选的删掉，没选的加上 */
function toggleDora(which: "dora" | "uradora", tile: string) {
  const r = toggleIndicator(indicatorState.value, which, tile, countInHand);
  pickerNotice.value = r.notice;
  // 两个字段都提交 —— 删表宝可能会顺带截短里宝（保持表里一一对应）
  patch({
    doraIndicators: r.state.dora,
    uradoraIndicators: r.state.uradora,
  });
}

/** 点已选牌上的 ✕：删掉它 */
function removeDoraAt(which: "dora" | "uradora", index: number) {
  const next = removeIndicator(indicatorState.value, which, index);
  pickerNotice.value = null;
  patch({
    doraIndicators: next.dora,
    uradoraIndicators: next.uradora,
  });
}

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

  // ⚠️ 天和/地和的前提用共享函数算，**不能用 `menzen`**。
  //
  //    暗杠虽然仍是「门清」（立直、门前清自摸和都还成立），
  //    但它确实是一次鸣牌 —— 杠了要从岭上摸牌，
  //    所以那一局不可能同时是天和/地和。
  //
  //    以前这里用 menzen 判断，而 `validateGameState` 用 `meldCount > 0`，
  //    结果纯暗杠手牌时界面允许勾天和、勾完立刻报错。
  //    现在两边共用 `canWinOnFirstTurn`，不可能再各自漂移。
  const firstTurn = canWinOnFirstTurn(props.game, { meldCount: props.meldCount });

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
      disabled: !firstTurn.tenhou,
      why: "天和必须亲家自摸，且整局无人鸣牌（含暗杠）",
    },
    {
      key: "isChiihou",
      label: "地和",
      disabled: !firstTurn.chiihou,
      why: "地和必须闲家自摸，且整局无人鸣牌（含暗杠）",
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

    <!-- ===== 宝牌指示牌 ===== -->
    <!--
      用牌面点选，不用文本框（文本框那个「打不进字」的 bug 已经删掉了）。
      点＋在卡片内展开牌表（内联展开，不开弹窗）——
      宝牌通常只有 1 张，为一次点击开弹窗太重。
    -->
    <section class="card">
      <span class="card-title">宝牌指示牌</span>

      <!-- 表宝牌 -->
      <div class="ind-row">
        <!--
          标签和箭头在**同一个按钮**里：
            · 视觉上是一体的，不会各占一块显得零散
            · 字号天然一致（箭头用 em 定尺寸，跟着标签文字走）
            · 点击区从一个小箭头变成整个标签，好点得多
        -->
        <button
          type="button"
          class="ind-label"
          :class="{ on: openPicker === 'dora' }"
          :aria-expanded="openPicker === 'dora'"
          @click="openPicker = openPicker === 'dora' ? null : 'dora'"
        >
          <span>表宝牌</span>
          <svg class="chev" viewBox="0 0 14 9" aria-hidden="true">
            <path
              d="M1.5 1.75 L7 7.25 L12.5 1.75"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="ind-tiles">
          <TileImage
            v-for="(t, i) in game.doraIndicators"
            :key="`d${i}`"
            :tile="t"
            size="sm"
            show-label
            clickable
            title="点一下删掉"
            @pick="removeDoraAt('dora', i)"
          />
          <span v-if="game.doraIndicators.length >= MAX_INDICATORS" class="sub">
            已满 {{ MAX_INDICATORS }} 张
          </span>
        </div>
      </div>
      <!-- 表宝牌的选择表（内联展开） -->
      <!-- 选择表：flex 排列，超过容器宽度自动换行。
           不用 grid，因为这里不需要「均分列宽」—— 牌保持固定的
           34px（够大的点击目标，减少误触），放不下就换行。 -->
      <div v-if="openPicker === 'dora'" class="ind-picker">
        <TileImage
          v-for="t in SELECTABLE_KINDS"
          :key="t"
          :tile="t"
          size="md"
          show-label
          clickable
          :dim="!canPickTile('dora', t)"
          @pick="toggleDora('dora', t)"
        />
      </div>

      <!-- 里宝牌 -->
      <div class="ind-row">
        <!-- 标签 + 箭头同在一个按钮里，理由同表宝牌。
             未立直时整块禁用（disabled 的按钮点不动）。 -->
        <button
          type="button"
          class="ind-label"
          :class="{ on: openPicker === 'uradora' }"
          :aria-expanded="openPicker === 'uradora'"
          :disabled="!uradoraOk"
          @click="openPicker = openPicker === 'uradora' ? null : 'uradora'"
        >
          <span>里宝牌</span>
          <svg class="chev" viewBox="0 0 14 9" aria-hidden="true">
            <path
              d="M1.5 1.75 L7 7.25 L12.5 1.75"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="ind-tiles">
          <template v-if="uradoraOk">
            <TileImage
              v-for="(t, i) in game.uradoraIndicators"
              :key="`u${i}`"
              :tile="t"
              size="sm"
              show-label
              clickable
              title="点一下删掉"
              @pick="removeDoraAt('uradora', i)"
            />
            <span v-if="game.uradoraIndicators.length >= game.doraIndicators.length" class="sub">
              已与表宝一致
            </span>
          </template>
          <!-- 未立直 / 还没选表宝时整块锁死，顺便把规则告诉用户 -->
          <span v-else class="sub">
            {{ game.isRiichi || game.isDoubleRiichi ? "先选表宝牌" : "只在立直时翻开" }}
          </span>
        </div>
      </div>
      <!-- 里宝牌的选择表 -->
      <!-- 选择表：flex 排列，超过容器宽度自动换行。
           不用 grid，因为这里不需要「均分列宽」—— 牌保持固定的
           34px（够大的点击目标，减少误触），放不下就换行。 -->
      <div v-if="openPicker === 'uradora'" class="ind-picker">
        <TileImage
          v-for="t in SELECTABLE_KINDS"
          :key="t"
          :tile="t"
          size="md"
          show-label
          clickable
          :dim="!canPickTile('uradora', t)"
          @pick="toggleDora('uradora', t)"
        />
      </div>

      <!-- 点选被拒绝的原因（如「里宝不能超过表宝」） -->
      <p v-if="pickerNotice" class="sub bad ind-notice">{{ pickerNotice }}</p>
      <p v-else class="sub ind-notice">
        最多 {{ MAX_INDICATORS }} 张（初始 1 张 + 最多 4 次杠）· 表里张数一一对应
      </p>
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

/* ---- 宝牌指示牌的点选器 ----
   原来的文本框样式（.txt / .txt:disabled / .txt.bad）已随文本框一起删除 ——
   那是「打不进字」那个 bug 的载体。 */

.ind-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}

/* 已选指示牌那一行 */
.ind-tiles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  min-height: 26px;
  flex: 1 1 auto;
  min-width: 0;
}

/* 「标签 + 展开箭头」——同一个按钮。
 *
 * 为什么合在一起（而不是把箭头放在牌后面）：
 *   · 两半分开时，标签和箭头各占一块、视觉零散
 *   · 合起来后字号天然一致（箭头用 em，跟着这个 font-size 走）
 *   · 点击区从一个小箭头变成整个标签，好点得多
 *
 * 也去掉了 :active —— 这里不需要，而且旁边就是牌，
 * 按下去的位移会让人以为牌也在动。
 */
.ind-label {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 0;
  border: none;
  background: none;
  /* ⚠️ 字号必须和 .lbl 一致 —— 这样箭头（用 em 定尺寸）
     才会和标签文字一样高，看起来是一体的。 */
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}

/* 未立直时禁用（里宝牌） */
.ind-label:disabled {
  cursor: default;
  opacity: 0.4;
}
.ind-label:disabled .chev {
  /* 禁用时也不该有「可展开」的暗示 */
  opacity: 0;
}

/* 箭头：用 em 定尺寸，跟着上面的 font-size 自动对齐 */
.ind-label .chev {
  width: 0.85em;
  height: auto;
  display: block;
  /* 只旋转 svg，不动按钮盒子 —— 不会引起任何重排 */
  transition: transform 0.15s ease;
}

/* 展开时箭头翻过来 */
.ind-label.on .chev {
  transform: rotate(180deg);
}

/* 展开时标签加个下划线，状态更明确（不靠颜色，避免和禁用态混淆）*/
.ind-label.on {
  text-decoration: underline;
  text-underline-offset: 2px;
}
/* 内联展开的牌表：**flex 排列，超过容器宽度自动换行**。
   不用 grid —— 这里不需要「均分列宽」，牌保持固定的 34px
   （够大的点击目标，不容易误触），放不下就换行。
   注：不设 overflow-x —— 换行已经保证不会横向溢出，
   留个滚动条反而会在换行和滚动之间摇摆。 */
.ind-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  padding: 6px;
  margin-bottom: 4px;
  background: #fff;
  border: 2px dashed var(--ink);
  border-radius: var(--radius-sm);
}

/* （.ind-picker-row 已删除：选择表改成 flex-wrap，不再需要分行） */

/* 提示行：固定最小高度，避免出现/消失时卡片高度跳 */
.ind-notice {
  margin: 0;
  min-height: 15px;
}

.mt {
  margin-top: 6px;
}
</style>

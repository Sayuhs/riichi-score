<script setup lang="ts">
/**
 * 手牌录入面板。
 *
 * ## 已移除的功能（按用户要求）
 *
 * - 文本输入通道 / 复制按钮 / 撤销按钮（M3.3）
 * - **副露（吃碰杠）录入模块**（本轮，用户强调三次「不需要这个」）
 *
 * ⚠️ 副露移除的影响（必须知道）：
 *   日麻里「有没有副露」直接决定役种 —— 平和、一盃口、七对子、立直、
 *   门前清自摸和等一堆役都要求门清。移除录入 UI 后，
 *   **有副露的手牌录不进去，也就无法算番。**
 *
 *   底层数据结构**保留**（`hand-state.ts` 的 melds、文本里的 `[789s]` 解析），
 *   所以这只是移除 UI，不是移除能力 —— 将来想加回来很容易。
 *
 * ## 布局（Q8 A）—— 防抖动的关键
 *
 * 上「牌面区」钉住不滚，下「牌表」滚动。
 * **所有钉住区的高度都是固定的**（见 CSS 的 `slot-*` 类），
 * 否则状态一变就推动下方牌表，用户正要点的地方会移位。
 */
import { computed, onMounted, ref, watch } from "vue";
import TileImage from "./TileImage.vue";
import { PICKER_ROWS } from "./tile-images.ts";
import {
  addTile,
  clearAll,
  clearWinningTile,
  countKind,
  createEmptyHand,
  expectedConcealedCount,
  isComplete,
  removeConcealedAt,
  remainingSlots,
  stateToText,
  textToState,
  type HandState,
} from "./hand-state.ts";

const props = withDefaults(
  defineProps<{
    /** 外部持有的手牌状态（由 App 统一管理） */
    modelValue?: HandState;
  }>(),
  {},
);

const emit = defineEmits<{
  (e: "update:modelValue", value: HandState): void;
  /** 请求打开役种速查弹窗 */
  (e: "openGuide"): void;
}>();

const state = ref<HandState>(props.modelValue ?? createEmptyHand());

// 内部改动同步给外部
watch(
  state,
  (s) => {
    emit("update:modelValue", s);
  },
  { deep: true },
);

// 外部状态变化时同步进来（如「下一手」清空）
watch(
  () => props.modelValue,
  (v) => {
    if (!v || v === state.value) return;
    state.value = v;
  },
);

onMounted(() => {
  const restored = maybeRestoreDraft();
  if (restored) state.value = restored;
});

// ---------------------------------------------------------------- 草稿（Q13）

const DRAFT_KEY = "riichi-hand-draft-v1";

watch(
  state,
  (s) => {
    try {
      localStorage.setItem(DRAFT_KEY, stateToText(s));
    } catch {
      /* 隐私模式等场景下 localStorage 不可用，忽略 */
    }
  },
  { deep: true },
);

function maybeRestoreDraft(): HandState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const s = textToState(raw);
    if (s.concealed.length === 0 && !s.winningTile && s.melds.length === 0) return null;
    return s;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 动作

function pick(tile: string) {
  state.value = addTile(state.value, tile);
}
function removeAt(index: number) {
  state.value = removeConcealedAt(state.value, index);
}
function removeWinning() {
  state.value = clearWinningTile(state.value);
}
function reset() {
  state.value = clearAll();
}

// ---------------------------------------------------------------- 派生

const expected = computed(() => expectedConcealedCount(state.value.melds));
const remaining = computed(() => remainingSlots(state.value));
const complete = computed(() => isComplete(state.value));
const hasWinning = computed(() => state.value.winningTile !== null);
const awaitingWinning = computed(
  () => !hasWinning.value && state.value.concealed.length >= expected.value,
);

/**
 * 提示条文本 —— **永远返回非空字符串**。
 * 用 v-if 控制显隐会让提示条高度变化推动下方牌表，那正是抖动的来源。
 */
const noticeText = computed(() => {
  if (state.value.notice) return state.value.notice;
  if (complete.value) return "已凑齐，去下面设置场况后算番";
  if (awaitingWinning.value) return "门前已满，再点的那张会成为和牌张";
  if (remaining.value > 0) return `还需录入 ${remaining.value} 张`;
  return "";
});

const noticeClass = computed(() => {
  if (state.value.notice) return "notice-warn";
  if (complete.value) return "notice-ok";
  return "notice-quiet";
});
</script>

<template>
  <div class="app">
    <!-- ============ 顶栏 ============ -->
    <header class="bar">
      <div class="progress">
        <span class="count">{{ state.concealed.length }}<i>/{{ expected }}</i></span>
        <span v-if="complete" class="tag tag-ok">凑齐了</span>
        <span v-else-if="awaitingWinning" class="tag tag-pink">点最后一张</span>
      </div>
      <button type="button" class="btn btn-cyan" title="役种速查" @click="emit('openGuide')">
        役种？
      </button>
    </header>

    <!-- ============ 牌面区（钉住，高度固定）============ -->
    <div class="pinned">
      <!-- 和牌张 -->
      <section class="card card-winning slot-win" :class="{ awaiting: awaitingWinning }">
        <span class="card-title">和牌张</span>
        <div class="winning-body">
          <TileImage
            v-if="state.winningTile"
            :tile="state.winningTile"
            size="sm"
            clickable
            @pick="removeWinning"
          />
          <span v-else class="hint">{{ awaitingWinning ? "← 点一张牌" : "录满自动" }}</span>
        </div>
      </section>

      <!-- 门前牌 -->
      <section class="card card-hand slot-hand">
        <span class="card-title">门前</span>
        <div class="slot-body">
          <div v-if="state.concealed.length" class="tiles">
            <TileImage
              v-for="(tile, i) in state.concealed"
              :key="`${tile}-${i}`"
              :tile="tile"
              size="lg"
              clickable
              @pick="removeAt(i)"
            />
          </div>
          <span v-else class="hint">点下方牌表开始录</span>
        </div>
      </section>
    </div>

    <!-- ============ 牌表（滚动）============ -->
    <div class="scroll">
      <div v-for="(row, ri) in PICKER_ROWS" :key="ri" class="picker-row">
        <TileImage
          v-for="tile in row"
          :key="tile"
          :tile="tile"
          size="md"
          show-label
          clickable
          :dim="countKind(state, tile) >= 4"
          @pick="pick(tile)"
        />
      </div>
    </div>

    <!-- ============ 提示（固定高度）============ -->
    <p class="notice slot-notice" :class="noticeClass">{{ noticeText }}</p>

    <!-- ============ 工具条 ============ -->
    <div class="tools">
      <button type="button" class="btn btn-yellow" @click="emit('openGuide')">役种速查</button>
      <button type="button" class="btn" @click="reset">全清</button>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 6px;
  gap: 6px;
  overflow: hidden;
}

/* ---------------- 顶栏 ---------------- */
.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.count {
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  text-shadow: 1px 1px 0 var(--pop-yellow);
}
.count i {
  font-style: normal;
  font-size: 13px;
  font-weight: 700;
  opacity: 0.5;
}

.tag {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  background: #fff;
  white-space: nowrap;
}
.tag-cyan {
  background: var(--pop-cyan);
}
.tag-pink {
  background: var(--pop-pink);
  color: #fff;
}
.tag-ok {
  background: var(--pop-green);
}

/* ---------------- 钉住区 ---------------- */
.pinned {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ============ 防抖动：固定高度占位 ============
 * 症状：选择或清空时容器上下抖动。
 * 根因：和牌张、门前、提示条的高度会变，而下方牌表是 flex:1 —— 上面一矮牌表就往上跳。
 * 修法：这些区域固定高度，内容不足时留白。
 */
.slot-win {
  display: flex;
  flex-direction: column;
}
.slot-win .winning-body {
  /* 牌宽 28px（border-box）→ 内容 25px → 3:4 高 33.33px + 边框 3px
     + 硬阴影 1.5px ≈ 37.8px。原来写 28px，牌上下各溢出 11px、
     压住了「和牌张」标题（它没有 overflow:hidden，所以是溢出不是裁切）。
     这是个固定值（和牌张永远是 28px），所以仍然是「固定高度」——
     防抖动不受影响。 */
  height: 38px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.slot-hand {
  display: flex;
  flex-direction: column;
}
.slot-hand .slot-body {
  /* ⚠️ 这里是「门前牌被裁」的现场。原来写死 height: 30px，
     而牌高 = 牌宽 × 4/3 + 3px 边框。
     牌宽从写死的 21px 变成响应式后能到 26px → 牌高 37.67px，
     于是上下各被裁 3.83px（连 1.5px 的硬阴影也一起被吃掉）。

     现在高度**从容器宽度派生**，和牌宽用同一个来源 —— 不可能再错配。
     cqw 是「容器 inline 尺寸的 1%」，容器在 .card-hand 上声明。
     高度只随视口变、不随手牌状态变，所以防抖动仍然成立。 */
  height: 44px; /* 回退：不支持容器查询单位时用 */
  height: calc((min(26px, (100cqw - 18px) / 13) - 3px) * 4 / 3 + 4.5px);
  display: flex;
  align-items: center;
  /* 竖直方向裁掉亚像素溢出（好东西，保留）；
     水平方向改成可滚动 —— 宁可让你滑一下看全，也不要静默少一张。 */
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
}

.slot-notice {
  flex: 0 0 auto;
  min-height: 27px;
  display: flex;
  align-items: center;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  opacity: 0.65;
  margin-bottom: 3px;
  text-transform: uppercase;
}

/* 和牌张：黄色卡片 */
.card-winning {
  background: var(--pop-yellow);
}
.card-winning.awaiting {
  background: var(--pop-pink);
  color: #fff;
  animation: pulse 1.2s ease-in-out infinite;
}
.card-winning.awaiting .card-title {
  color: #fff;
  opacity: 0.9;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: var(--shadow-hard);
  }
  50% {
    box-shadow: 5px 5px 0 var(--ink);
  }
}

/* 门前：白卡 + 容器查询的锚点 */
.card-hand {
  background: var(--card);
  /* ⚠️ 让 .slot-body 的 cqw 单位以**这张卡片的内容宽**为基准。
     这样槽高就能从「实际可用宽度」派生，和牌宽用同一个来源 ——
     不会像以前那样「牌宽改了、槽高没跟着改」。 */
  container-type: inline-size;
}

/* 门前牌：固定 13 列的 grid —— **不换行、也不手算宽度**。
   列宽由浏览器分配，所以「13 张放不下」这件事在数学上不可能发生。
   minmax(16px, 1fr) 的下限是保险：屏幕窄到每张不足 16px 时才溢出，
   那时由 .slot-body 的横向滚动兜底（而不是静默裁掉）。
   固定 13 列还保证了录入过程中牌不会缩放。 */
.tiles {
  display: grid;
  grid-template-columns: repeat(13, minmax(16px, 1fr));
  gap: 1.5px;
  width: 100%;
}

/* grid 的子项要填满自己那一列。
   两层覆盖：
     .tile  —— TileImage 里默认 width:fit-content
     .body  —— TileImage 里默认是**固定宽度**（那是给 flex 场景的），
              在 grid 里必须改回 100% 才能均分列宽。
   特异性 (0,3,0) 高于 TileImage 内部的 (0,2,0)，所以能稳定覆盖。 */
.tiles :deep(.tile),
.picker-row :deep(.tile) {
  width: 100%;
}
/* ⚠️ 这里必须带上中间的 .tile 一层，让特异性高过 TileImage 里的默认值。
 *
 *    默认：`.size-lg .body[data-v-A]`          → 特异性 (0,3,0)
 *    覆盖：`.tiles[data-v-B] .tile .size-lg .body` → (0,4,0)  ✅
 *
 *    如果写成 `.tiles[data-v-B] .size-lg .body` 也是 (0,3,0)，
 *    就和默认值**打平** —— 谁赢只看 CSS 顺序。
 *    那样一旦导入顺序变了，门前的牌会退回固定宽度、重新溢出。
 *    加上 `.tile` 这一层就与顺序无关了。
 */
.tiles :deep(.tile .size-lg .body) {
  width: 100%;
  max-width: 26px;
}
.picker-row :deep(.tile .size-md .body) {
  width: 100%;
  max-width: 34px;
}

.hint {
  font-size: 11px;
  font-weight: 700;
  opacity: 0.55;
  white-space: nowrap;
}
.card-winning.awaiting .hint {
  opacity: 0.95;
}

/* ---------------- 牌表（滚动）---------------- */
.scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 0;
}

/* 牌表：固定 9 列。和门前同一套做法 —— 手算宽度这种事不再存在。 */
.picker-row {
  display: grid;
  grid-template-columns: repeat(9, minmax(22px, 1fr));
  gap: 1.5px;
  width: 100%;
}

/* ---------------- 提示（常驻占位）---------------- */
.notice {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  padding: 5px 8px;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice-warn {
  background: var(--warn-bg);
}
.notice-ok {
  background: var(--ok-bg);
}
.notice-quiet {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--ink-3);
}

/* ---------------- 工具条 ---------------- */
.tools {
  flex: 0 0 auto;
  display: flex;
  gap: 5px;
}
.tools .btn {
  flex: 1;
}
</style>

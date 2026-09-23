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
            show-label
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
  height: 28px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.slot-hand {
  display: flex;
  flex-direction: column;
}
.slot-hand .slot-body {
  height: 30px;
  display: flex;
  align-items: center;
  overflow: hidden;
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

/* 门前：白卡 */
.card-hand {
  background: var(--card);
}

/* 门前牌一行排开不换行（13 张必须放下，320px 屏也不换行） */
.tiles {
  display: flex;
  flex-wrap: nowrap;
  gap: 1.5px;
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

.picker-row {
  display: flex;
  gap: 1.5px;
  justify-content: center;
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

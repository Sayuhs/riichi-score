<script setup lang="ts">
/**
 * 役种速查弹窗 —— 从下方滑出。
 *
 * ## 修过的三个问题
 *
 * 1. **两个标签页高度不一致** —— 原来「没役怎么办」短、「全部役种」长，
 *    切换时弹窗会跳。现在给内容区固定高度（`--body-h`），
 *    两屏同高，内部各自滚动。
 *
 * 2. **标签按钮被裁** —— 原来标签页用了负 margin 压在边框上，
 *    在小屏上会被 overflow 裁掉。现在改成规规矩矩的一行，不越界。
 *
 * 3. **只给了文字判据，没有牌型** —— 现在每个役都有可渲染的麻将图。
 *    牌型**由测试用引擎逐条验证过**（见 __tests__/yaku-guide.test.ts 的【8】），
 *    不是手写的猜测。
 */
import { computed, ref } from "vue";
import {
  NO_YAKU_HINTS,
  YAKU_GROUPS,
  yakuByGroup,
  windHint,
  type YakuInfo,
} from "./yaku-guide.ts";
import type { Seat } from "../score/types.ts";
import TileImage from "./TileImage.vue";

const props = defineProps<{
  roundWind: Seat;
  seatWind: Seat;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const tab = ref<"tips" | "all">("tips");
const expanded = ref<string | null>(null);

const hint = computed(() =>
  windHint(props.roundWind, props.seatWind, props.seatWind === "east"),
);

function hanText(y: YakuInfo): string {
  if (y.group === "役满") return "役满";
  if (y.closedHan === null) return "—";
  if (y.closedHan === y.openHan) return `${y.closedHan} 番`;
  if (y.openHan === null) return `门清 ${y.closedHan} 番`;
  return `门清 ${y.closedHan} / 副露 ${y.openHan}`;
}

function isClosedOnly(y: YakuInfo): boolean {
  return y.openHan === null && y.group !== "役满";
}

function toggle(name: string) {
  expanded.value = expanded.value === name ? null : name;
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <!-- 从下方滑出：整体贴底，带圆角 -->
    <div class="sheet" role="dialog" aria-modal="true" aria-label="役种速查">
      <div class="grabber" aria-hidden="true"></div>

      <header class="head">
        <h2 class="title">役种速查</h2>
        <button type="button" class="close" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <!-- 标签：一行两个，等宽，不越界 -->
      <nav class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ on: tab === 'tips' }"
          @click="tab = 'tips'"
        >
          没役怎么办
        </button>
        <button
          type="button"
          class="tab"
          :class="{ on: tab === 'all' }"
          @click="tab = 'all'"
        >
          全部役种
        </button>
      </nav>

      <!-- 内容区固定高度：两个标签页同高，切换不跳 -->
      <div class="body">
        <!-- ===== 没役怎么办 ===== -->
        <div v-show="tab === 'tips'" class="pane">
          <p class="wind-note">{{ hint }}</p>
          <ol class="tips">
            <li v-for="(t, i) in NO_YAKU_HINTS" :key="i" class="tip">
              <span class="tip-num">{{ i + 1 }}</span>
              <div class="tip-body">
                <strong class="tip-title">{{ t.title }}</strong>
                <p class="tip-text">{{ t.body }}</p>
              </div>
            </li>
          </ol>
        </div>

        <!-- ===== 全部役种 ===== -->
        <div v-show="tab === 'all'" class="pane">
          <section v-for="g in YAKU_GROUPS" :key="g" class="group">
            <h3 class="group-title">{{ g }}</h3>
            <ul class="yaku-list">
              <li
                v-for="y in yakuByGroup(g)"
                :key="y.name"
                class="yaku"
                :class="{ open: expanded === y.name, 'closed-only': isClosedOnly(y) }"
                @click="toggle(y.name)"
              >
                <div class="yaku-head">
                  <span class="yaku-name">{{ y.name }}</span>
                  <span class="yaku-han">{{ hanText(y) }}</span>
                </div>

                <div v-if="expanded === y.name" class="yaku-detail">
                  <p class="how">{{ y.how }}</p>

                  <!-- 示例牌型：真的麻将图 -->
                  <div v-if="y.exampleTiles" class="example-block">
                    <span class="ex-label">例</span>
                    <div class="ex-tiles">
                      <!-- 副露组 -->
                      <template v-for="(m, mi) in y.exampleTiles.melds ?? []" :key="`m${mi}`">
                        <span class="ex-meld">
                          <TileImage v-for="(t, ti) in m.tiles" :key="ti" :tile="t" size="md" />
                        </span>
                      </template>
                      <!-- 门前牌 -->
                      <TileImage
                        v-for="(t, ti) in y.exampleTiles.concealed"
                        :key="`c${ti}`"
                        :tile="t"
                        size="md"
                      />
                      <span class="ex-plus">和</span>
                      <TileImage :tile="y.exampleTiles.winning" size="md" />
                    </div>
                    <p v-if="y.exampleNote" class="ex-note">{{ y.exampleNote }}</p>
                  </div>

                  <p v-if="isClosedOnly(y)" class="warn">
                    ⚠ 副露后不成立 —— 这是「副露了就没役」的常见原因
                  </p>
                  <p class="ja">{{ y.ja }}</p>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <footer class="foot">
        <button
          v-if="tab === 'tips'"
          type="button"
          class="btn btn-yellow foot-btn"
          @click="tab = 'all'"
        >
          查看全部役种 →
        </button>
        <button v-else type="button" class="btn foot-btn" @click="tab = 'tips'">
          ← 回「没役怎么办」
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}

/* 从下方滑出的面板 */
.sheet {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: var(--line-bold) solid var(--ink);
  border-bottom: none;
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -4px 0 var(--ink);
  overflow: hidden;
  animation: slide-up 0.18s ease-out;
}

@keyframes slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.grabber {
  flex: 0 0 auto;
  width: 40px;
  height: 4px;
  margin: 6px auto 0;
  background: var(--ink);
  border-radius: 999px;
  opacity: 0.25;
}

/* ---- 标题栏 ---- */
.head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 8px;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 900;
}

.close {
  border: 1.5px solid var(--ink);
  background: #fff;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 900;
  line-height: 1;
  padding: 5px 9px;
  cursor: pointer;
}

/* ---- 标签：等宽一行，不越界 ---- */
.tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 0 10px 8px;
}

.tab {
  flex: 1;
  font-size: 12px;
  font-weight: 800;
  padding: 8px 6px;
  border: var(--line) solid var(--ink);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink);
  cursor: pointer;
  min-height: 34px;
}
.tab.on {
  background: var(--pop-yellow);
  box-shadow: var(--shadow-hard-sm);
}

/* ---- 内容区：固定高度，两屏一致 ---- */
.body {
  flex: 0 0 auto;
  /* ⭐ 关键：固定高度。两个标签页内容长短差别很大，
     不固定高度的话切换时会跳，而且下方的按钮会跟着上下移动。 */
  height: 52dvh;
  min-height: 240px;
  position: relative;
  border-top: var(--line) solid var(--ink);
  background: var(--bg);
}

/* 每个标签页都是绝对定位铺满，各自滚动 */
.pane {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px;
  /* 网格背景，波普感 */
  background-color: var(--bg);
  background-image: radial-gradient(var(--bg-dot) 1px, transparent 1px);
  background-size: 8px 8px;
}

/* ---- 「没役怎么办」 ---- */
.wind-note {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 8px;
  background: var(--pop-cyan);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
  line-height: 1.45;
}

.tips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tip {
  display: flex;
  gap: 7px;
  padding: 7px 8px;
  background: var(--card);
  border: var(--line) solid var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-hard-sm);
}

.tip-num {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  background: var(--pop-pink);
  color: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
}

.tip-body {
  min-width: 0;
}

.tip-title {
  display: block;
  font-size: 12px;
  margin-bottom: 2px;
}

.tip-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  opacity: 0.78;
}

/* ---- 役种表 ---- */
.group {
  margin-bottom: 10px;
}

.group-title {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  padding: 2px 7px;
  background: var(--ink);
  color: var(--bg);
  border-radius: 999px;
  display: inline-block;
}

.yaku-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.yaku {
  background: var(--card);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  cursor: pointer;
}
.yaku.open {
  background: var(--pop-yellow);
  box-shadow: var(--shadow-hard-sm);
}
.yaku.closed-only {
  border-left-width: 5px;
  border-left-color: var(--pop-pink);
}

.yaku-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.yaku-name {
  font-size: 12px;
  font-weight: 800;
}

.yaku-han {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.7;
  white-space: nowrap;
}

.yaku-detail {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px dashed rgba(26, 26, 26, 0.3);
}

.how {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
}

/* ---- 示例牌型 ---- */
.example-block {
  margin-top: 6px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.72);
  border: 1.5px dashed var(--ink);
  border-radius: var(--radius-sm);
}

.ex-label {
  display: inline-block;
  font-size: 9px;
  font-weight: 900;
  background: var(--ink);
  color: var(--bg);
  padding: 1px 5px;
  border-radius: 3px;
  margin-bottom: 4px;
}

.ex-tiles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
}

/* 副露组：加个底色把它们和门前牌区分开 */
.ex-meld {
  display: inline-flex;
  gap: 1px;
  padding: 1px 2px;
  background: #d3f4f8;
  border: 1px solid var(--ink);
  border-radius: 3px;
}

.ex-plus {
  font-size: 9px;
  font-weight: 900;
  padding: 0 3px;
  opacity: 0.7;
}

.ex-note {
  margin: 5px 0 0;
  font-size: 10px;
  line-height: 1.4;
  opacity: 0.75;
}

.warn {
  margin: 5px 0 0;
  font-size: 10px;
  font-weight: 800;
  color: var(--err-ink);
  line-height: 1.35;
}

.ja {
  margin: 3px 0 0;
  font-size: 10px;
  opacity: 0.5;
}

/* ---- 底部按钮：单独一行，不会被裁 ---- */
.foot {
  flex: 0 0 auto;
  padding: 8px 10px;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: var(--card);
  border-top: var(--line) solid var(--ink);
}

.foot-btn {
  width: 100%;
  min-height: 38px;
  font-size: 13px;
}
</style>

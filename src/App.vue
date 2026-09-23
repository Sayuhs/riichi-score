<script setup lang="ts">
/**
 * 应用外壳。
 *
 * ## M3.3 的三个改动
 *
 * 1. **场况与手牌合并成一个页面** —— 原来分两个标签，但录完牌必然要设场况，
 *    来回切标签是多余的一步。现在同一个滚动页里：录牌 → 场况 → 算番。
 *
 * 2. **结果直接弹窗** —— 算完不必切标签，弹窗直接盖在上面看结果，
 *    关掉就能继续改牌。
 *
 * 3. **错误信息不外露英文** —— 引擎的英文报错只写进 console，
 *    界面上一律是中文明白的说明。
 */
import { computed, ref } from "vue";
import HandInput from "./ui/HandInput.vue";
import GameSettings from "./ui/GameSettings.vue";
import ScoreResultView from "./ui/ScoreResultView.vue";
import YakuGuide from "./ui/YakuGuide.vue";
import { createEmptyHand, isComplete, type HandState } from "./ui/hand-state.ts";
import { createDefaultGameState, validateGameState, type GameState } from "./ui/game-state.ts";
import { buildHandInput } from "./ui/build-input.ts";
import { score } from "./score/index.ts";
import type { ScoreResult } from "./score/types.ts";

/** 弹窗状态 */
type Sheet =
  | { kind: "none" }
  | { kind: "guide" }
  | { kind: "result"; result: ScoreResult }
  | { kind: "fail"; title: string; detail: string; tips: string[] };

const sheet = ref<Sheet>({ kind: "none" });

const hand = ref<HandState>(createEmptyHand());
const game = ref<GameState>(createDefaultGameState());
/** 构造输入失败的原因（手牌没录完之类） */
const buildError = ref<string | null>(null);
const busy = ref(false);
/** 是否处于「算番模式」（收起牌表、显示场况） */
const showSettings = ref(false);

// ---------------- 派生 ----------------
const meldCount = computed(() => hand.value.melds.length);
const isMenzen = computed(() => hand.value.melds.every((m) => m.kind === "ankan"));
const handReady = computed(() => isComplete(hand.value));

const issues = computed(() =>
  validateGameState(game.value, {
    isMenzen: isMenzen.value,
    meldCount: meldCount.value,
  }),
);

const canScore = computed(() => handReady.value && issues.value.length === 0);

// ---------------- 动作 ----------------
function goSettings() {
  showSettings.value = true;
  buildError.value = null;
}

function backToHand() {
  showSettings.value = false;
}

async function doScore() {
  buildError.value = null;

  const built = buildHandInput(hand.value, game.value);
  if (!built.ok) {
    buildError.value = built.reason;
    return;
  }

  busy.value = true;
  try {
    const r = await score(built.input);
    if ("error" in r) {
      console.error("[算番失败]", r.error.kind, r.error.message);
      sheet.value = { kind: "fail", ...humanizeError(r.error.kind) };
      return;
    }
    sheet.value = { kind: "result", result: r };
  } catch (e) {
    console.error("[算番异常]", e);
    sheet.value = { kind: "fail", ...humanizeError("engine-error") };
  } finally {
    busy.value = false;
  }
}

/**
 * 把引擎的错误翻成中文。
 *
 * ⚠️ 这里**刻意不把引擎的英文原文放进 detail** ——
 *    界面是给打牌的朋友看的，一句 `Hand has no yaku` 对他们毫无帮助。
 *    原文写进 console 供排查（见调用处）。
 */
function humanizeError(kind: string): { title: string; detail: string; tips: string[] } {
  switch (kind) {
    case "no-yaku":
      return {
        title: "这手牌没有役，不能和牌",
        detail: "牌形是成立的，但没有任何役种。",
        tips: [
          "门清的话，立直、断幺九、平和、门前清自摸和都是常见的役",
          "有副露的话，看看有没有役牌（白发中 / 场风 / 自风）或断幺九",
          "宝牌不算役 —— 光靠宝牌不能和牌",
          "也可能是牌录错了，关掉弹窗回去核对",
        ],
      };
    case "invalid-hand":
      return {
        title: "手牌不成立",
        detail: "牌形构不成和牌，或者有不合规则的地方。",
        tips: [
          "检查门前牌张数（门清 13 张，每组副露减 3 张）",
          "检查是不是有某种牌超过了 4 张",
          "检查和牌张是否设成了正确的那一张",
        ],
      };
    case "invalid-context":
      return {
        title: "场况有矛盾",
        detail: "这个场面在牌局里不可能出现。",
        tips: [
          "比如「荣和」却勾了「海底摸月」（海底必须自摸）",
          "或者「抢杠」同时勾了「河底捞鱼」（抢杠的牌不是打出的牌）",
          "回去看看场况里有没有标红的地方",
        ],
      };
    default:
      return {
        title: "算番出错",
        detail: "遇到了预期之外的情况。",
        tips: ["可以试试重新录入手牌", "如果一直失败，可能是这手牌有罕见规则，需要手动算"],
      };
  }
}

function nextHand() {
  hand.value = createEmptyHand();
  buildError.value = null;
  showSettings.value = false;
  sheet.value = { kind: "none" };
}

function editHand() {
  sheet.value = { kind: "none" };
  showSettings.value = false;
}

/** 弹窗里改场况 */
function editGame() {
  sheet.value = { kind: "none" };
  showSettings.value = true;
}
</script>

<template>
  <div class="app">
    <!-- ===== 内容 ===== -->
    <main class="content">
      <!-- 录牌 + 场况同一个滚动页；用 showSettings 决定牌表的显隐 -->
      <div class="page">
        <HandInput
          v-model="hand"
          :class="{ hidden: showSettings }"
          @open-guide="sheet = { kind: 'guide' }"
        />

        <!-- 场况：录完牌后展开 -->
        <div v-if="showSettings" class="settings-wrap">
          <GameSettings
            :game="game"
            :is-menzen="isMenzen"
            :meld-count="meldCount"
            :issues="issues"
            @update:game="game = $event"
          />
        </div>
      </div>
    </main>

    <!-- ===== 构造输入失败：就地提示，不用弹窗 ===== -->
    <p v-if="buildError" class="error-bar">
      {{ buildError }}
      <button type="button" class="err-close" @click="buildError = null">✕</button>
    </p>

    <!-- ===== 底部主操作 ===== -->
    <footer class="footer">
      <button
        v-if="!showSettings"
        type="button"
        class="btn btn-primary big"
        :disabled="!handReady"
        @click="goSettings"
      >
        {{ handReady ? "下一步：设场况" : "先把牌录完" }}
      </button>
      <template v-else>
        <button type="button" class="btn" @click="backToHand">改牌</button>
        <button
          type="button"
          class="btn btn-primary flex2"
          :disabled="!canScore || busy"
          @click="doScore"
        >
          {{ busy ? "计算中…" : "算番" }}
        </button>
      </template>
    </footer>

    <!-- ================= 弹窗层 ================= -->

    <!-- 役种速查 -->
    <YakuGuide
      v-if="sheet.kind === 'guide'"
      :round-wind="game.roundWind"
      :seat-wind="game.seatWind"
      @close="sheet = { kind: 'none' }"
    />

    <!-- 结果：直接弹窗 -->
    <div v-else-if="sheet.kind === 'result'" class="overlay" @click.self="sheet = { kind: 'none' }">
      <div class="sheet">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-body">
          <ScoreResultView
            :result="sheet.result"
            :winner-seat="game.seatWind"
            :win-type="game.winType"
          />
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn" @click="editHand">改牌</button>
          <button type="button" class="btn" @click="editGame">改场况</button>
          <button type="button" class="btn btn-primary flex2" @click="nextHand">下一手</button>
        </div>
      </div>
    </div>

    <!-- 算番失败 -->
    <div v-else-if="sheet.kind === 'fail'" class="overlay" @click.self="sheet = { kind: 'none' }">
      <div class="sheet">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-body">
          <section class="fail-card">
            <h2 class="fail-title">{{ sheet.title }}</h2>
            <p class="fail-detail">{{ sheet.detail }}</p>
            <ul class="fail-tips">
              <li v-for="(t, i) in sheet.tips" :key="i">{{ t }}</li>
            </ul>
            <button
              v-if="sheet.title.includes('没有役')"
              type="button"
              class="btn btn-yellow guide-btn"
              @click="sheet = { kind: 'guide' }"
            >
              役种速查：哪种役能凑？
            </button>
          </section>
        </div>
        <div class="sheet-foot">
          <button type="button" class="btn btn-primary flex2" @click="editHand">
            回去检查手牌
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 480px;
  margin: 0 auto;
  overflow: hidden;
}

.content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 整页是一个 flex 列，子项自己决定滚动 */
.page {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 录牌区（HandInput 自带 100% 高度） */
.page > :deep(.app) {
  flex: 1 1 auto;
  min-height: 0;
}

.page > :deep(.app.hidden) {
  display: none;
}

/* 场况区：自己滚动 */
.settings-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ---- 错误条 ---- */
.error-bar {
  flex: 0 0 auto;
  margin: 0;
  padding: 7px 28px 7px 9px;
  position: relative;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  background: var(--pop-pink);
  color: #fff;
  border-top: 2px solid var(--ink);
}

.err-close {
  position: absolute;
  top: 4px;
  right: 4px;
  border: none;
  background: none;
  color: #fff;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
}

/* ---- 底部主操作 ---- */
.footer {
  flex: 0 0 auto;
  display: flex;
  gap: 5px;
  padding: 6px;
  padding-bottom: max(6px, env(safe-area-inset-bottom));
  background: var(--card);
  border-top: var(--line) solid var(--ink);
}

.btn.big {
  width: 100%;
  min-height: 40px;
  font-size: 14px;
}
.footer .btn {
  min-height: 40px;
}
.flex2 {
  flex: 2;
}

/* ================= 弹窗 ================= */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}

.sheet {
  width: 100%;
  max-width: 480px;
  max-height: 88dvh;
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
  margin: 6px auto 2px;
  background: var(--ink);
  border-radius: 999px;
  opacity: 0.25;
}

.sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 10px;
  background-color: var(--bg);
  background-image: radial-gradient(var(--bg-dot) 1px, transparent 1px);
  background-size: 8px 8px;
}

.sheet-foot {
  flex: 0 0 auto;
  display: flex;
  gap: 5px;
  padding: 8px 10px;
  padding-bottom: max(8px, env(safe-area-inset-bottom));
  background: var(--card);
  border-top: var(--line) solid var(--ink);
}
.sheet-foot .btn {
  flex: 1;
  min-height: 38px;
}

/* ---- 失败卡片 ---- */
.fail-card {
  background: var(--card);
  border: var(--line) solid var(--ink);
  border-left-width: 10px;
  border-left-color: var(--pop-pink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-hard);
  padding: 10px;
}

.fail-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 900;
}

.fail-detail {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.8;
}

.fail-tips {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.4;
}
.fail-tips li::marker {
  color: var(--accent);
  font-weight: 900;
}

.guide-btn {
  width: 100%;
  margin-top: 8px;
  min-height: 34px;
}
</style>

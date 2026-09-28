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
import {
  createEmptyHand,
  countKind,
  isComplete,
  type HandState,
} from "./ui/hand-state.ts";
import {
  createDefaultGameState,
  validateGameState,
  type GameState,
} from "./ui/game-state.ts";
import { buildHandInput } from "./ui/build-input.ts";
import { ALL_TILE_KINDS } from "./ui/tile-images.ts";
import { tileLabel } from "./ui/tiles.ts";
import { diagnoseNoYaku, type ContextFix, type TileSwap } from "./ui/no-yaku-advice.ts";
import { diagnoseInvalidHand } from "./ui/invalid-hand-advice.ts";
import { score } from "./score/index.ts";
import type { ScoreResult } from "./score/types.ts";

/** 弹窗状态 */
type Sheet =
  | { kind: "none" }
  | { kind: "guide" }
  | { kind: "result"; result: ScoreResult }
  | {
      kind: "fail";
      title: string;
      detail: string;
      tips: string[];
      /** 无役时：改场况就能有役的方案（空数组 = 没有） */
      fixes: ContextFix[];
      /** 诊断结论（无役 / 牌形不成立都有） */
      verdict: string;
      /** 牌形不成立时：具体问题列表（凑出几组、剩哪几张、是否撞牌） */
      problems: string[];
      /** 无役时：换掉某张牌就有役（含参考役） */
      tileSwaps: TileSwap[];
      /** `context` = 场况问题；`shape` = 牌型真没役；空串 = 不适用 */
      verdictKind: "context" | "shape" | "";
      /**
       * 显式控制「役种速查」按钮的显隐。
       *
       * ⚠️ 以前这里靠 `sheet.title.includes('没有役')` 来判断 ——
       *    改一下标题文案，按钮就会**静默消失**。
       *    所以改成显式字段。
       */
      showGuide: boolean;
    };

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
const isMenzen = computed(() =>
  hand.value.melds.every((m) => m.kind === "ankan"),
);
/** 预检判定「真的没役」—— 这时「下一步」要拦住，换牌是唯一出路 */
const handBlocked = ref(false);

/**
 * 「下一步」能不能点。
 *
 * ⚠️ 只在预检判定 `hopeless`（试遍常见场况都没役）时才拦。
 *    「当前场况没役、但勾立直就有」**不能拦** —— 拦了用户就永远
 *    进不去场况页、永远勾不上立直，那手牌直接卡死。
 */
const handReady = computed(() => isComplete(hand.value) && !handBlocked.value);

const issues = computed(() =>
  validateGameState(game.value, {
    isMenzen: isMenzen.value,
    meldCount: meldCount.value,
  }),
);

const canScore = computed(() => handReady.value && issues.value.length === 0);

/**
 * 「下一步」按钮的文案。
 *
 * 必须分清「还没录完」和「录完了但牌形不成立」—— 后者说「先把牌录完」是错的，
 * 用户会以为自己数错了张数，一个劲儿往牌表里补牌。
 */
const nextLabel = computed(() => {
  if (handReady.value) return "下一步：设场况";
  if (isComplete(hand.value) && handBlocked.value) return "牌形不成立，先改牌";
  return "先把牌录完";
});

/**
 * 手牌 + 副露里每种牌有几张（键是归一后的牌面）。
 *
 * 传给场况面板，用来实现「同一张牌（手牌 + 副露 + 表宝 + 里宝）≤ 4 张」——
 * 引擎会校验这条，但它吐的是英文，所以我们提前把已用满的牌种禁掉。
 */
const handCounts = computed(() => {
  const out: Record<string, number> = {};
  for (const kind of ALL_TILE_KINDS) {
    out[kind] = countKind(hand.value, kind);
  }
  return out;
});

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
      sheet.value = await buildFailSheet(r.error.kind);
      return;
    }
    sheet.value = { kind: "result", result: r };
  } catch (e) {
    console.error("[算番异常]", e);
    sheet.value = await buildFailSheet("engine-error");
  } finally {
    busy.value = false;
  }
}

/**
 * 构造「算番失败」弹窗的数据。
 *
 * 无役时额外跑一次针对性诊断 —— 问的是「改哪个场况就有役」，
 * 因为现实中无役绝大多数是场况没设对（门清忘了勾立直、其实是自摸），
 * 而不是牌型真的没役。
 *
 * ⚠️ 诊断失败**不该挡住错误提示** —— 出异常就退化成原来的通用 tips。
 */
async function buildFailSheet(kind: string): Promise<Extract<Sheet, { kind: "fail" }>> {
  const base = humanizeError(kind);
  const isNoYaku = kind === "no-yaku";

  let fixes: ContextFix[] = [];
  let tileSwaps: TileSwap[] = [];
  let problems: string[] = [];
  let verdict = "";
  let verdictKind: "context" | "shape" | "" = "";

  if (isNoYaku) {
    try {
      const d = await diagnoseNoYaku(hand.value, game.value, {
        isMenzen: isMenzen.value,
      });
      fixes = d.contextFixes;
      tileSwaps = d.tileSwaps;
      verdict = d.verdict;
      verdictKind = d.verdictKind;
    } catch (e) {
      console.error("[无役诊断失败]", e);
    }
  }

  // 牌形不成立：引擎只吐一句英文，用户看完还是不知道改什么。
  // 这里给出确定性的具体问题（换哪张就能和牌 / 是不是撞了宝牌 / 凑出几组）。
  if (kind === "invalid-hand") {
    try {
      const d = await diagnoseInvalidHand(hand.value, game.value);
      verdict = d.verdict;
      problems = d.problems;
      // 换牌建议走和「无役」同一套渲染 —— 它们是同一件事：
      // 「换成这张，牌形成立**而且**有役」。诊断层已经保证过这一点，
      // 不会再把「换完还是无役」的假建议塞进来。
      tileSwaps = d.swaps;
      verdictKind = "shape";
    } catch (e) {
      console.error("[牌形诊断失败]", e);
    }
  }

  return {
    kind: "fail",
    ...base,
    fixes,
    tileSwaps,
    problems,
    verdict,
    verdictKind,
    showGuide: isNoYaku,
  };
}

/**
 * 把引擎的错误翻成中文。
 *
 * ⚠️ 这里**刻意不把引擎的英文原文放进 detail** ——
 *    界面是给打牌的朋友看的，一句 `Hand has no yaku` 对他们毫无帮助。
 *    原文写进 console 供排查（见调用处）。
 */
function humanizeError(kind: string): {
  title: string;
  detail: string;
  tips: string[];
} {
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
        tips: [
          "可以试试重新录入手牌",
          "如果一直失败，可能是这手牌有罕见规则，需要手动算",
        ],
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
          :game="game"
          :class="{ hidden: showSettings }"
          @open-guide="sheet = { kind: 'guide' }"
          @precheck="handBlocked = $event"
        />

        <!-- 场况：录完牌后展开 -->
        <div v-if="showSettings" class="settings-wrap">
          <GameSettings
            :game="game"
            :is-menzen="isMenzen"
            :meld-count="meldCount"
            :hand-counts="handCounts"
            :issues="issues"
            @update:game="game = $event"
          />
        </div>
      </div>
    </main>

    <!-- ===== 构造输入失败：就地提示，不用弹窗 ===== -->
    <p v-if="buildError" class="error-bar">
      {{ buildError }}
      <button type="button" class="err-close" @click="buildError = null">
        ✕
      </button>
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
        {{ nextLabel }}
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
    <div
      v-else-if="sheet.kind === 'result'"
      class="overlay"
      @click.self="sheet = { kind: 'none' }"
    >
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
          <button type="button" class="btn btn-primary flex2" @click="nextHand">
            下一手
          </button>
        </div>
      </div>
    </div>

    <!-- 算番失败 -->
    <div
      v-else-if="sheet.kind === 'fail'"
      class="overlay"
      @click.self="sheet = { kind: 'none' }"
    >
      <div class="sheet">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-body">
          <section class="fail-card">
            <h2 class="fail-title">{{ sheet.title }}</h2>
            <p class="fail-detail">{{ sheet.detail }}</p>

            <!--
              无役时给**针对这一手牌**的诊断，而不是通用 tips：
                · verdict  —— 一句话结论（是场况问题还是牌型问题）
                · fixes    —— 改哪个场况就有役（附上会成立哪些役）
              非无役的错因（手牌不成立 / 场况矛盾）仍然显示通用 tips。
            -->
            <template v-if="sheet.verdict">
              <p
                class="fail-verdict"
                :class="{ shape: sheet.verdictKind === 'shape' }"
              >
                {{ sheet.verdict }}
              </p>

              <!-- 牌形不成立时的具体问题（凑出几组 / 剩哪几张 / 是不是撞了宝牌） -->
              <ul v-if="sheet.problems.length" class="fail-problems">
                <li v-for="(p, i) in sheet.problems" :key="i">{{ p }}</li>
              </ul>

              <!-- 换掉某张牌就有役（含参考役）。
                   和无役诊断的「勾个立直」是两类不同的建议，都展示。 -->
              <ul v-if="sheet.tileSwaps.length" class="fail-swaps">
                <li v-for="(s, i) in sheet.tileSwaps" :key="i" class="fail-swap">
                  <span class="swap-main">
                    把 {{ s.isWinning ? "和牌张" : "" }}{{ tileLabel(s.from) }} 换成
                    <strong>{{ tileLabel(s.to) }}</strong>
                  </span>
                  <span class="swap-yaku">→ {{ s.yaku.join("、") }} {{ s.han }} 番</span>
                </li>
              </ul>

              <ul v-if="sheet.fixes.length" class="fail-fixes">
                <li v-for="(f, i) in sheet.fixes" :key="i" class="fail-fix">
                  <span class="fix-text">{{ f.text }}</span>
                  <span class="fix-yaku">→ {{ f.yaku.join("、") }}</span>
                  <span v-if="f.confidence === 'maybe'" class="fix-maybe">（待确认）</span>
                </li>
              </ul>
            </template>

            <ul v-else class="fail-tips">
              <li v-for="(t, i) in sheet.tips" :key="i">{{ t }}</li>
            </ul>

            <!-- ⚠️ 用显式字段控制显隐，不再靠 title 字符串匹配 ——
                 那样改一下标题文案按钮就会静默消失 -->
            <button
              v-if="sheet.showGuide"
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
  max-width: 96%;
  width: 96%;
  margin: 0 auto;
  overflow: hidden;
  /* ---- 安全区（刘海屏 / 状态栏）----
     index.html 开了 viewport-fit=cover，manifest 又是 display:standalone，
     所以装到手机主屏后内容会**铺到状态栏和刘海底下**。
     之前只处理了底部（.footer 的 safe-area-inset-bottom），
     竖屏时顶部那条就被状态栏盖住了 —— 这才是真正意义上的「顶部被裁」。
     横屏时左右也有安全区，一并补上。 */
  padding-top: env(safe-area-inset-top);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
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

/* 无役诊断的一句话结论 */
.fail-verdict {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.5;
  padding: 7px 9px;
  background: var(--pop-yellow);
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
}
/* 牌型真没役时换个颜色，和「场况问题」区分开 */
.fail-verdict.shape {
  background: var(--pop-cyan);
}

/* 改场况就能有役的方案列表 */
/* 换牌建议：左边「把 X 换成 Y」，右边参考役 */
.fail-swaps {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.fail-swap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-left-width: 6px;
  border-left-color: var(--pop-yellow);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.swap-main {
  min-width: 0;
}
.swap-yaku {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 800;
  opacity: 0.75;
  white-space: nowrap;
}

/* 牌形不成立时的具体问题列表 */
.fail-problems {
  margin: 8px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.45;
}
.fail-problems li::marker {
  color: var(--pop-pink);
  font-weight: 900;
}

.fail-fixes {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fail-fix {
  padding: 6px 8px;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-left-width: 6px;
  border-left-color: var(--pop-green);
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.45;
}

.fix-text {
  display: block;
  font-weight: 700;
}

.fix-yaku {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 800;
  opacity: 0.75;
}

.fix-maybe {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.6;
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

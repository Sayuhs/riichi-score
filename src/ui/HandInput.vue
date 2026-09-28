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
import type { GameState } from "./game-state.ts";
import { buildHandInput } from "./build-input.ts";
import { score } from "../score/index.ts";
import { formatSandboxResult } from "./sandbox-result.ts";
import { precheckBlocks, precheckHand, type PrecheckResult } from "./hand-precheck.ts";
import { isWinningShape } from "./hand-shape.ts";
import { tileLabel } from "./tiles.ts";
import type { ScoreError, ScoreResult, WinType } from "../score/types.ts";
import {
  addTile,
  expectedPhysicalCount,
  kanCandidate,
  physicalTileCount,
  promoteToKan,
  unpromoteKan,
  addMeld,
  checkMeldShape,
  removeMeld,
  setMeldKind,
  type MeldKind,
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
    /**
     * 当前场况 —— 试算模式要用它算番。
     *
     * 试算沙盒（Q11a）就是「拿当前场况 + 随便改的牌，实时看结果」，
     * 所以它需要一个场况来源。没传就不显示试算开关。
     */
    game?: GameState;
  }>(),
  {},
);

const emit = defineEmits<{
  (e: "update:modelValue", value: HandState): void;
  /** 请求打开役种速查弹窗 */
  (e: "openGuide"): void;
  /**
   * 预检结果上报给 App —— 它要据此决定「下一步」按钮能不能点。
   *
   * ⚠️ 只有 `hopeless`（试遍常见场况都没役）才该拦。
   *    「当前场况没役但勾立直就有」**不能拦** —— 拦了用户就永远
   *    进不去场况页，也就永远勾不上立直，那手牌直接卡死。
   */
  (e: "precheck", block: boolean): void;
  /**
   * 在录入页切「荣和 / 自摸」时，把整个场况回传给 App。
   *
   * ⚠️ 和了方式**不是手牌的一部分**，它是场况（`GameState.winType`），
   *    归 App 持有 —— 所以这里不能自己存一份，必须回传。
   *
   *    这么做的**好处**：录入页和场况页改的是同一个字段，
   *    两处天然同步，不存在「这页说自摸、那页说荣和」的可能。
   *    （对比：如果这里存个本地的 ref，就要写同步代码，而同步代码一定会漏。）
   */
  (e: "update:game", game: GameState): void;
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
  // 全清 = 从头开始，之前「这不是杠」的判断也一并忘掉
  declinedKan.value = new Set();
}

/**
 * 切「荣和 / 自摸」—— 和牌张**是怎么来的**，正是这两者的区别。
 *
 * 所以这对按钮长在「和牌张」那张卡片上，而不是只藏在场况页里：
 * 录这张牌的时候你一定知道它是摸的还是别人打的；等走到场况页，你已经忘了。
 *
 * ⚠️ 改的是**场况**（`GameState.winType`），不是手牌 —— 所以要回传给 App，
 *    不能在组件里自己存一份。回传之后场况页里那对同样的按钮会自动跟着变：
 *    两边改的是同一个字段，没有第二份真相可以走偏。
 *
 * 另外这条**必须真的接上**（App 的 @update:game），否则点了没反应 ——
 * 和「暗杠点了没反应」是同一类坑，见 __tests__/win-type.test.ts 的静态断言。
 */
function setWinType(w: WinType) {
  const g = props.game;
  // 同一个值就不回传：免得 App 白建一次 game 对象、触发下游重算
  if (!g || g.winType === w) return;
  emit("update:game", { ...g, winType: w });
}

// ---------------------------------------------------------------- 派生

const expected = computed(() => expectedConcealedCount(state.value.melds));
const remaining = computed(() => remainingSlots(state.value));
const complete = computed(() => isComplete(state.value));
/**
 * 牌形成不成立 —— **只看牌形，不看有没有役**（役是场况的函数，不是牌形的性质）。
 *
 * 「凑齐了」不能只说张数：张数对了而牌形不成立时，那个绿灯就是在骗人 ——
 * 用户会一路走到算番才发现，而引擎那时只吐一句英文。
 */
const shapeOk = computed(() => !complete.value || isWinningShape(state.value));
const hasWinning = computed(() => state.value.winningTile !== null);
const awaitingWinning = computed(
  () => !hasWinning.value && state.value.concealed.length >= expected.value,
);

// ---- 物理张数（界面只展示这个口径）----
//
// 逻辑张数（引擎的 14）会把每个杠折算成 3 张，只用于传给引擎。
// 用户能数出来的牌是物理张数：没有杠时 14，1 个杠时 15，以此类推。
/** 门清 = 没有副露，或只有暗杠（暗杠不破门清） */
const isMenzenHand = computed(() => state.value.melds.every((m) => m.kind === "ankan"));

const physical = computed(() => physicalTileCount(state.value));
const physicalTarget = computed(() => expectedPhysicalCount(state.value.melds));

// ---- 自动追问「这 4 张是杠吗？」----
//
// ⚠️ 为什么必须问，而不能自动推断：
//    「4 张同牌」不等于「杠」。实测反例 ——
//      1111m(杠) + 2222m(不是杠) + 345p + 99s（15 张实体牌）
//    引擎正确地把 2222m 拆成 222m 刻子 + 234m 顺子。
//    看到 4 张就当成杠，这手牌会多算一个杠，番符全错。

/** 用户点过「不是」的牌种。组件本地状态 —— 纯交互记忆，不进领域模型 */
const declinedKan = ref<Set<string>>(new Set());

const normKind = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);

/** 门前凑满 4 张、且用户还没说「不是」的牌（有的话就显示追问） */
const pendingKan = computed(() => {
  const c = kanCandidate(state.value);
  if (!c) return null;
  return declinedKan.value.has(normKind(c)) ? null : c;
});

// 门前掉回 4 张以下时，清掉「不是」的记忆 —— 下次再凑满要重新问。
// 否则用户删一张又加回来，就再也不会被追问了。
watch(
  () => kanCandidate(state.value),
  (c) => {
    if (!c && declinedKan.value.size) declinedKan.value = new Set();
  },
);

function markKan(tile: string, kind: "ankan" | "daiminkan") {
  state.value = promoteToKan(state.value, tile, kind);
  declinedKan.value = new Set();
}

/**
 * 取消一组暗杠 —— 点门前标题行里那组牌。
 *
 * 走 `unpromoteKan` 而不是 `removeMeld`：暗杠那 4 张本来就是自己门前的牌
 * （`promoteToKan` 搬过去的），取消是**撤销**，4 张要退回门前。
 * 吃 / 碰的牌来自别人，删掉就是删掉，不能退回 —— 所以两者不能共用一个动作。
 */
function cancelKan(id: number) {
  state.value = unpromoteKan(state.value, id);
}

/**
 * 「不是」：这 4 张不是杠，**保留它们**，只是不再追问。
 *
 * ⚠️ 这个选项是必需的，不能省 —— 4 张同牌**不等于**杠。
 *    反例：222m 刻子 + 234m 顺子里那张 2m，一共 4 张 2m，
 *    但只有一个刻子，没有杠。
 *    如果「不是」把这 4 张清掉，这种牌就录不进去了。
 */
function declineKan(tile: string) {
  const next = new Set(declinedKan.value);
  next.add(normKind(tile));
  declinedKan.value = next;
}

/**
 * 提示条文本 —— **永远返回非空字符串**。
 * 用 v-if 控制显隐会让提示条高度变化推动下方牌表，那正是抖动的来源。
 *
 * 「还需录入 N 张」用的是**物理**口径，和顶栏的计数保持一致 ——
 * 否则顶栏说 13/15、提示说「还要 1 张」，用户会算不明白。
 */
const noticeText = computed(() => {
  if (state.value.notice) return state.value.notice;
  // 预检的提示优先于「已凑齐」—— 凑齐了但牌形不成立 / 没役，说「已凑齐」是误导
  if (precheck.value.kind !== "idle" && precheck.value.kind !== "ok") {
    return precheck.value.text;
  }
  if (complete.value) return "已凑齐，去下面设置场况后算番";
  if (awaitingWinning.value) return "门前已满，再点的那张会成为和牌张";
  const left = physicalTarget.value - physical.value;
  if (left > 0) return `还需录入 ${left} 张`;
  return "";
});

// ---------------------------------------------------------------- 副露（吃 / 碰 / 杠）
//
// ## 为什么必须有这块
//
// 「这 3 张是自己摸的还是吃来的」是**两个完全不同的概念**，而且影响极大：
// 吃了就破门清 → 立直不能立、平和/一盃口/七对子全不成立。
//
// 实测过的极端例子（牌**完全一样**，只差 234p 是摸的还是吃的）：
//    自己摸的 → 2 番 30 符 → 2000 点（立直 + 平和）
//    吃来的   → 无役，根本不能和牌
//
// ## 为什么不能像杠那样自动追问
//
// 杠能问，是因为「4 张同牌」罕见。但**每组面子都是 3 张牌** ——
// 每一组顺子都可能是吃来的，自动问就是每手牌问 4 次。必须由用户指定。

/** 正在添加哪种副露（null = 没在添加） */
const meldMode = ref<null | "run" | "triplet" | "daiminkan">(null);
/** 正在选的牌 */
const meldPick = ref<string[]>([]);
/** 形态不对时的提示 */
const meldNotice = ref<string | null>(null);

const MELD_LABEL: Record<string, string> = {
  run: "吃",
  triplet: "碰",
  ankan: "暗杠",
  daiminkan: "明杠",
  shouminkan: "加杠",
};

/**
 * 区分「鸣牌副露」和「暗杠」—— 这是**两个概念**。
 *
 *   鸣牌副露（吃 / 碰 / 明杠）→ 从别人那里要了牌，**破门清**
 *   暗杠                     → 4 张全在自己手里，**不破门清**
 *
 * 引擎内部把两者都存成 meld（`ConcealedKan`），但显示时不能混在一起：
 * 把暗杠摆在「副露」下面会让人以为它也破门清 —— 那是错的。
 * 所以暗杠跟着「门前」显示。
 */
const calledMelds = computed(() => state.value.melds.filter((m) => m.kind !== "ankan"));
const ankanMelds = computed(() => state.value.melds.filter((m) => m.kind === "ankan"));

const meldNeed = computed(() => (meldMode.value === "daiminkan" ? 4 : 3));

function startMeld(kind: "run" | "triplet" | "daiminkan") {
  meldMode.value = kind;
  meldPick.value = [];
  meldNotice.value = null;
}

/**
 * 点右侧按钮：切换选中状态。
 *
 * **同时只能选一个** —— 再点另一个会直接换过去；
 * 再点当前选中的那个则取消。
 */
function toggleMeld(kind: "run" | "triplet" | "daiminkan") {
  if (meldMode.value === kind) {
    cancelMeld();
    return;
  }
  startMeld(kind);
}

function cancelMeld() {
  meldMode.value = null;
  meldPick.value = [];
  meldNotice.value = null;
}

const normTile = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);



/** 点牌表里的某张牌来选副露 */
function pickMeldTile(tile: string) {
  if (meldPick.value.length >= meldNeed.value) return;
  meldNotice.value = null;
  const next = [...meldPick.value, tile];
  meldPick.value = next;
  if (next.length === meldNeed.value) confirmMeld();
}

function confirmMeld() {
  const kind = meldMode.value;
  if (!kind) return;
  const tiles = meldPick.value;

  const err = checkMeldShape(kind as MeldKind, tiles);
  if (err) {
    meldNotice.value = err;
    meldPick.value = [];
    return;
  }

  state.value = addMeld(state.value, tiles);
  // addMeld 会按形态猜类型（4 张猜成暗杠），这里用用户选的那一种覆盖
  const last = state.value.melds[state.value.melds.length - 1];
  if (last) state.value = setMeldKind(state.value, last.id, kind as MeldKind);

  cancelMeld();
}

function deleteMeld(id: number) {
  state.value = removeMeld(state.value, id);
  meldNotice.value = null;
}

// ---------------------------------------------------------------- 试算沙盒
//
// 打开后每改一次牌就重算一次，结果直接显示在底部 ——
// 不用走「下一步 → 设场况 → 算番」。
//
// 价值在于「试」：改一张立刻看到有没有役、变多少点。
// 正式流程做不到（要来回切页面）。

// ---------------------------------------------------------------- 预检
//
// 录满 14 张时算一遍：当前场况有没有役？没有的话，勾个立直/自摸有没有？
// 试遍都没有 → 这手牌真的没役，拦住「下一步」，并给换牌建议。
const precheck = ref<PrecheckResult>({ kind: "idle", text: "", swaps: [] });

watch(
  [state, () => props.game],
  async () => {
    if (!props.game) return;
    // 只在录完时才跑 —— 没录完时预检没有意义，也不该浪费算力
    if (!isComplete(state.value)) {
      precheck.value = { kind: "idle", text: "", swaps: [] };
      emit("precheck", false);
      return;
    }
    try {
      const r = await precheckHand(state.value, props.game, {
        isMenzen: isMenzenHand.value,
      });
      precheck.value = r;
      emit("precheck", precheckBlocks(r.kind));
    } catch (e) {
      console.error("[预检失败]", e);
      precheck.value = { kind: "ok", text: "", swaps: [] };
      emit("precheck", false); // 预检出问题不该拦住用户
    }
  },
  { deep: true, immediate: true },
);

const trial = ref(false);
const trialResult = ref<ScoreResult | null>(null);
const trialError = ref<ScoreError | null>(null);

watch(
  [state, () => props.game],
  async () => {
    if (!trial.value || !props.game) return;
    const built = buildHandInput(state.value, props.game);
    if (!built.ok) {
      // 还没录完 —— 不算，也不显示错误（那是正常的中间状态）
      trialResult.value = null;
      trialError.value = null;
      return;
    }
    try {
      const r = await score(built.input);
      if ("error" in r) {
        trialError.value = r.error;
        trialResult.value = null;
      } else {
        trialResult.value = r;
        trialError.value = null;
      }
    } catch (e) {
      console.error("[试算失败]", e);
      trialResult.value = null;
      trialError.value = null;
    }
  },
  { deep: true, immediate: true },
);

/** 沙盒那一行要显示的文字（永远非空，保证固定高度不抖） */
const sandbox = computed(() => {
  // 牌形不成立 / 没役时优先显示换牌建议 —— 它比试算结果更该看
  // （而且复用同一个固定高度的槽）
  if (precheck.value.swaps.length) {
    const s = precheck.value.swaps[0]!;
    return {
      text: `试：把 ${tileLabel(s.from)} 换成 ${tileLabel(s.to)} → ${s.yaku.join("、")} ${s.han} 番`,
      tone: "bad" as const,
    };
  }
  return formatSandboxResult(trialResult.value, trialError.value, isComplete(state.value));
});

const noticeClass = computed(() => {
  if (state.value.notice) return "notice-warn";
  if (precheck.value.kind === "hopeless" || precheck.value.kind === "invalid-shape") {
    return "notice-warn";
  }
  if (precheck.value.kind === "context-hint") return "notice-ok";
  if (complete.value) return "notice-ok";
  return "notice-quiet";
});
</script>

<template>
  <div class="app">
    <!-- ============ 顶栏 ============ -->
    <header class="bar">
      <div class="progress">
        <!-- ⚠️ 只展示**物理张数**（用户能数出来的牌）。
             逻辑张数（引擎的 14，把每个杠折算成 3 张）不显示 ——
             给用户看只会造成困惑，之前那句「录满了（14 张）」就是这么把他绕进去的。 -->
        <span class="count">{{ physical }}<i>/{{ physicalTarget }}</i></span>
        <span v-if="complete && shapeOk" class="tag tag-ok">凑齐了</span>
        <span v-else-if="complete" class="tag tag-bad">牌形不成立</span>
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
        <span class="card-title">
          和牌张
          <!--
            和了方式（荣和 / 自摸）就放在这儿 —— 它决定的正是这张牌的**来源**，
            没有比「和牌张」旁边更贴切的位置了。

            ⚠️ 切的是场况（GameState.winType），所以 emit 给 App 而不是本地存。
               场况页里那对一模一样的按钮改的是同一个字段 ⇒ 自动同步。

            `game` 是可选 prop（组件要能单独渲染），没传就不显示这两个按钮 ——
            不猜默认值，也别在没场况的时候假装有。
          -->
          <span v-if="game" class="win-type-seg">
            <button
              type="button"
              class="wt-btn"
              :class="{ on: game.winType === 'ron' }"
              title="别人打出来的那张牌"
              @click="setWinType('ron')"
            >
              荣和
            </button>
            <button
              type="button"
              class="wt-btn"
              :class="{ on: game.winType === 'tsumo' }"
              title="自己摸到的这张牌"
              @click="setWinType('tsumo')"
            >
              自摸
            </button>
          </span>
        </span>
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
        <span class="card-title">
          门前
          <!--
            暗杠显示在**门前**，不显示在副露区 ——
            因为暗杠不破门清，它不是「鸣牌」。
            放在副露下面会让人以为它也破门清。
          -->
          <span v-if="ankanMelds.length" class="ankan-strip">
            <span class="ankan-label">暗杠</span>
            <!--
              **一张牌面 + ×4**，而不是 4 张牌图 ——
              门前那一行本来就是按 13 格排的，塞 4 张会把标题行撑高、挤到牌表。
              留一张牌面是为了还能一眼认出是哪张牌；右边用「×4」说明是杠。
            -->
            <!--
              **整组可点 = 取消这个暗杠**，和副露的「点一下删掉这组」保持一致。
              但取消是撤销（4 张退回门前），不是删除 —— 理由见
              hand-state.ts 的 unpromoteKan。
            -->
            <span
              v-for="m in ankanMelds"
              :key="m.id"
              class="ankan-group"
              title="点一下取消这个暗杠（4 张退回门前）"
              @click="cancelKan(m.id)"
            >
              <TileImage :tile="m.tiles[0]!" size="lg" />
              <span class="ankan-count">×4</span>
            </span>
          </span>
        </span>
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

    <!-- ============ 副露（吃 / 碰 / 杠）============ -->
    <!--
      「这 3 张是自己摸的还是吃来的」是两回事，影响极大：
        自己摸的 → 门清，立直/平和都成立
        吃来的   → 破门清，这些役全没了
      所以必须能标注。用不到时它就是一行「门清（没有吃碰杠）」。
    -->
    <section class="card card-meld slot-meld">
      <div class="meld-main">
        <span class="card-title">副露</span>

      <div class="slot-body meld-body">
        <div v-if="calledMelds.length" class="melds">
          <!--
            点这组牌就删掉它 —— 和「门前」的操作一致（门前也是点一下删一张）。
            原来要靠右边那个 ✕，既占地方、竖排按钮后也不好点。
          -->
          <div
            v-for="m in calledMelds"
            :key="m.id"
            class="meld"
            title="点一下删掉这组"
            @click="deleteMeld(m.id)"
          >
            <span class="meld-tiles">
              <TileImage v-for="(t, i) in m.tiles" :key="i" :tile="t" size="lg" />
            </span>
            <span class="meld-kind">{{ MELD_LABEL[m.kind] }}</span>
          </div>
        </div>
        <div v-else-if="meldMode" class="meld-picking">
          <span class="meld-picked">
            <TileImage v-for="(t, i) in meldPick" :key="i" :tile="t" size="sm" />
          </span>
          <span class="hint">在下面点 {{ meldNeed - meldPick.length }} 张</span>
        </div>
        <span v-else class="hint">门清（没有吃碰）</span>
      </div>

        <p v-if="meldNotice" class="meld-notice">{{ meldNotice }}</p>
      </div>

      <!--
        右侧固定的按钮区：三个按钮**垂直排列**。
        选中的那个会「按进去」（位移 2px + 阴影归零），而且**同时只能选一个**；
        录完一组副露后自动弹回（见 confirmMeld → cancelMeld）。
      -->
      <div class="meld-btns">
        <button
          type="button"
          class="meld-add-btn kind-run"
          :class="{ on: meldMode === 'run' }"
          @click="toggleMeld('run')"
        >
          吃
        </button>
        <button
          type="button"
          class="meld-add-btn kind-triplet"
          :class="{ on: meldMode === 'triplet' }"
          @click="toggleMeld('triplet')"
        >
          碰
        </button>
        <button
          type="button"
          class="meld-add-btn kind-daiminkan"
          :class="{ on: meldMode === 'daiminkan' }"
          @click="toggleMeld('daiminkan')"
        >
          明杠
        </button>
      </div>
    </section>

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
          @pick="meldMode ? pickMeldTile(tile) : pick(tile)"
        />
      </div>
    </div>

    <!-- ============ 提示（固定高度）============ -->
    <!-- 提示条（固定高度）。
         凑满 4 张同牌时，这里**原地变成**「这 4 张是杠吗？」+ 三个按钮 ——
         不弹出新面板、不改变高度，所以不会把下方的牌表推开。
         （下方牌表正是用户刚点过的地方，一推开就可能误触。） -->
    <div class="notice slot-notice" :class="noticeClass">
      <!-- title 只是兜底：条内能舒服地放两行，更长的文案在桌面端悬浮可见 -->
      <span class="notice-text" :title="noticeText">{{ noticeText }}</span>
    </div>

    <!-- ============ 试算结果（固定高度）============ -->
    <!-- 开着试算时才有内容；关着就是一条空占位，不会让上面的牌表跳。 -->
    <div v-if="game" class="trial-strip" :class="sandbox.tone">
      <span class="trial-text">{{ sandbox.text }}</span>
    </div>

    <!-- ============ 工具条 ============ -->
    <div class="tools">
      <!-- 试算开关（Q11a 的「沙盒」）：改一张牌就实时重算 -->
      <button
        v-if="game"
        type="button"
        class="btn"
        :class="{ 'btn-cyan': trial }"
        :title="trial ? '关掉试算' : '开着时每改一张牌就实时重算'"
        @click="trial = !trial"
      >
        {{ trial ? "试算中" : "试算" }}
      </button>
      <button type="button" class="btn btn-yellow" @click="emit('openGuide')">役种速查</button>
      <button type="button" class="btn" @click="reset">全清</button>
    </div>
    <!-- ============ 「是杠吗？」追问弹窗 ============
    <!--
      用**全屏遮罩**，而不是内联在提示条里（Q2 的要求）：
        内联的话，追问还开着的时候你仍能去点牌表 ——
        而此时恰好有 4 张同牌，再点一张就是误操作。
      遮罩保证必须先把这个问题回答掉。
    -->
    <div v-if="pendingKan" class="kan-overlay">
      <div class="kan-card">
        <p class="kan-q">这 4 张是杠吗？</p>
        <div class="kan-tiles">
          <TileImage :tile="pendingKan" size="sm" />
          <TileImage :tile="pendingKan" size="sm" />
          <TileImage :tile="pendingKan" size="sm" />
          <TileImage :tile="pendingKan" size="sm" />
        </div>
        <div class="kan-actions">
          <button type="button" class="btn btn-primary" @click="markKan(pendingKan, 'ankan')">
            暗杠
          </button>
          <button type="button" class="btn btn-primary" @click="markKan(pendingKan, 'daiminkan')">
            明杠
          </button>
          <button type="button" class="btn" @click="declineKan(pendingKan)">不是</button>
        </div>
      </div>
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
/* 「张数够了、但牌形不成立」—— 绿灯不能亮，也不该用代表「还要录」的粉 */
.tag-bad {
  background: var(--pop-orange);
  color: #fff;
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

/*
 * 「荣和 / 自摸」小切换 —— 长在「和牌张」标题行的右侧。
 *
 * ⚠️ 高度必须压在 15px 以内。
 *
 *    .card-title 原来是按 9px 字排的（≈11.7px 高）。这对按钮要是让它长太多，
 *    整张卡片就变高，而牌面区（.pinned）是钉住的 —— 多出来的高度只能从
 *    下面的牌表（flex:1）身上扣。
 *    15px = 9px 字 + 1.5px×2 内边距 + 1.5px×2 边框，已经是还能点得中的最小尺寸，
 *    所以这张卡片实测只高了约 3px —— 一次性变化，不是运行时抖动。
 */
.win-type-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  /* 覆盖 .card-title 的 letter-spacing：那是给标题字排的，按钮上会散开 */
  letter-spacing: normal;
}

.wt-btn {
  font: inherit;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  padding: 1.5px 5px;
  color: var(--ink-3);
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  cursor: pointer;
}

/* 选中态用「实心深底 + 白字」而不是浅色描边：
   父级 .card-title 带 opacity: 0.65（整个子树都被淡化，子元素没法自己救回来），
   所以只有强对比在淡化后还能一眼看出选的是哪个。 */
.wt-btn.on {
  color: #fff;
  background: var(--ink);
}

.wt-btn:active {
  transform: translate(1px, 1px);
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
  /* ⚠️ 是 **min-height**，不是固定 height。
     原来写死 height: 36px，再配上 .notice-text 的 nowrap + ellipsis，
     结果长文案被静默截成「牌形不成立（凑不成 4 组面子 + 1 对雀头）—— 换成下…」，
     而且没有 tooltip —— 用户**根本看不到完整提示**（实测报上来的 bug）。

     38px = 3px 边框 + 8px 内边距 + 2 × 13.5px 行高 —— 正好是**两行**的高度。
       · 单行文案：文字盒 24.5px，靠 min-height 补到 38px（上下留白，和原来一样）；
       · 两行文案：文字盒正好 38px。
     ⇒ 一行和两行的槽高**完全相同**，防抖动这条设计原则依然成立。
        只有超过两行的极端文案才会把下面的牌表（flex:1 的滚动区）压缩几像素 ——
        那也比让人看不见强。

     （比原来的 36px 高 2px，是刻意取「两行高度」的结果，不是笔误。） */
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 4px;
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
  padding: 4px;
  /*
   * ⚠️ 需要一圈边框。
   *    没有边框时，这块看起来和上面的卡片是同一种东西 ——
   *    完全意识不到它是**可以滚动**的区域（牌表有 5 行，小屏要滑）。
   *    边框把它框成一个独立的「面板」，滚动的暗示就出来了。
   */
  border: 2px solid var(--ink);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.55);
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
  padding: 4px 8px;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-hard-sm);
  /* 改成 flex 容器：文字和「暗杠/明杠/不是」三个按钮并排一行 */
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  width: 100%;
}

/* 普通文案：占满剩余宽度；超长时**换行**，不再截成「…」
   —— nowrap + ellipsis 会让用户永远读不到完整提示，没有 tooltip 可救。 */
.notice-text {
  flex: 1 1 auto;
  min-width: 0;
  /* 行高写死（不是 normal），这样行数→高度是可算的：
     两行 = 27px，配上边框和内边距正好 38px，也就是 .slot-notice 的 min-height
     —— 所以「一行」和「两行」的提示条高度完全相同，下方内容不会被推动。 */
  line-height: 13.5px;
  overflow-wrap: anywhere;
}

/* ---------------- 「是杠吗？」追问弹窗 ---------------- */
/* ⚠️ 全屏遮罩：追问开着的时候必须挡住其他操作。
   内联在提示条里的话，你仍能去点牌表 ——
   而此时恰好有 4 张同牌，再点一张就是误操作。 */
.kan-overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
  padding: 16px;
}

.kan-card {
  width: 100%;
  max-width: 300px;
  background: var(--bg);
  border: var(--line-bold) solid var(--ink);
  border-radius: var(--radius);
  box-shadow: var(--shadow-hard);
  padding: 12px;
}

.kan-q {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 900;
}

.kan-tiles {
  display: flex;
  gap: 3px;
  justify-content: center;
  margin-bottom: 8px;
}

.kan-actions {
  display: flex;
  gap: 5px;
}
.kan-actions .btn {
  flex: 1;
  min-height: 36px;
  font-size: 12px;
  padding: 4px 2px;
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

/*
 * 暗杠：跟在「门前」的标题行里。
 *
 * ⚠️ 这一行必须**固定高度**。
 *
 *    暗杠条是有/无都可能的状态 —— 如果高度随它变化，
 *    那么每次标了暗杠、或者删掉暗杠，下面的牌表都会被推动一下。
 *    而牌表正是用户刚点过的地方，一推开就可能误触。
 *
 *    所以：标题行给固定的 min-height，暗杠牌面也缩小到刚好放得下。
 */
.slot-hand .card-title {
  /* 30px = 暗杠牌面 24px + 内边距 2px + 边框 3px + 余量 */
  min-height: 30px;
  align-items: center;
}

.ankan-strip {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 1;
  text-transform: none;
  letter-spacing: 0;
}

/* 暗杠的牌面缩小到 18×24（保持 3:4 的牌面比例），
   这样固定高度不用给太大 */
.ankan-group :deep(.body) {
  width: 18px;
  height: 24px;
}
.ankan-label {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 5px;
  background: var(--pop-yellow);
  border: 1.5px solid var(--ink);
  border-radius: 999px;
  white-space: nowrap;
}
/* 一组暗杠：一张牌面 + ×4。**整组可点 = 取消这个暗杠** */
.ankan-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px 3px 1px 1px;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

/*
 * ⚠️ 牌图必须**不接收指针事件**。
 *
 *   TileImage 渲染的是一个 `<button>`，这里没传 `clickable` ⇒ 它是 **disabled** 的，
 *   而浏览器里**点击 disabled button 事件不会冒泡到父元素** ——
 *   点「牌面那部分」时父元素的 @click 根本收不到，看起来就是「点了没反应」。
 *   （副露的 .meld 踩过同一个坑，见那边的注释。）
 *
 *   「暗杠点了没反应」有两个成因，这是第二个；第一个是压根没绑 @click。
 *   两个一起改才算真的能点。
 */
.ankan-group :deep(.tile) {
  pointer-events: none;
}

/*
 * 按下反馈。只做位移，**一个尺寸都不改** ——
 * 这个标题行是固定高度（见 .slot-hand .card-title）：一改尺寸，
 * 下面的牌表就会被推动，而牌表正是用户刚点过的地方。
 */
.ankan-group:active {
  transform: translate(1.5px, 1.5px);
}

.ankan-count {
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

/* ---------------- 副露 ---------------- */
/* 平时只有一行「门清」；用不到吃碰时完全不占注意力 */
.card-meld {
  background: #e3f6f9;
  /* 横向：左边是内容，右边是固定的按钮列 */
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 6px;
}

.meld-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/*
 * 副露区：**换行，不横向滚动**。
 *
 * 右边被按钮列占掉之后，左边只剩窄窄一条 ——
 * 横向滚动在这里很糟（看不到后面还有多少、又容易误触）。
 * 所以副露组多了就往下换行，最多两行。
 *
 * 高度：一行起、两行封顶。不写死成两行高是因为
 * 「没有副露」是最常见的情况，那样会白占掉一大块。
 */
.slot-meld .meld-body {
  min-height: 34px;
  /* 两行封顶（一行约 35px + 间隙） */
  max-height: 74px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

/*
 * 右侧固定的按钮列：垂直排列。
 *
 * ⚠️ 和左边的内容区之间有一条**竖线分割** ——
 *    不加的话，三个按钮看起来像是混在「门清」那行文字里的，
 *    分不清哪块是信息、哪块是能点的。
 */
.meld-btns {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  /* 分割线 */
  border-left: 2px solid var(--ink);
  padding-left: 7px;
  margin-left: 1px;
}

/*
 * ⚠️ 点击目标不能太小。
 *    原来写的是 font-size:9px + padding:1px 6px —— 实际高度只有约 14px，
 *    远低于可点击的舒服尺寸（30px 上下），点起来很难受。
 *    现在给了 min-height:30px + 更大内边距，并强制等宽（三个按钮一样宽）。
 */
.meld-add-btn {
  font-size: 11px;
  font-weight: 800;
  padding: 6px 4px;
  min-height: 30px;
  /* 三个按钮等宽，竖排时整齐 */
  width: 52px;
  border: 2px solid var(--ink);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
  /* 硬阴影 —— 按下去时它归零，形成「压进去」的手感 */
  box-shadow: 2px 2px 0 var(--ink);
  transition: transform 0.06s ease, box-shadow 0.06s ease;
}

/*
 * 三个按钮各自的颜色 —— 一眼能分清「吃 / 碰 / 明杠」。
 * 绿色系 = 吃（顺子）、粉色 = 碰（刻子）、橙色 = 明杠。
 * 这三个动作在规则上差别很大（碰/杠破门清的程度、符数都不同），
 * 所以值得用颜色区分，而不是三个一样的白按钮。
 */
.meld-add-btn.kind-run {
  background: var(--pop-green);
}
.meld-add-btn.kind-triplet {
  background: var(--pop-pink);
  color: #fff;
}
.meld-add-btn.kind-daiminkan {
  background: var(--pop-yellow);
}

/* 选中：牌被按进去（位移 + 阴影消失），和牌表的按压效果一致。
   颜色不变 —— 位移本身就够清楚，再改颜色反而和「按钮含义色」打架。 */
.meld-add-btn.on {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 var(--ink);
  /* 底色压暗一点，配合位移一起表达「按住了」 */
  filter: brightness(0.94);
}
.meld-add-btn.cancel {
  background: var(--pop-pink);
  color: #fff;
}

.melds {
  display: flex;
  /* 换行，不横向滚动 */
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  align-content: center;
  /* 让每一组按自身宽度排，不要被拉伸 */
  width: 100%;
}

/*
 * 一组副露。**整组可点** —— 点一下就删掉（和门前的操作一致）。
 *
 * ⚠️ 里面的牌图必须 `pointer-events: none`。
 *
 *    TileImage 渲染的是一个 `<button>`，而这里的牌没传 `clickable`，
 *    所以那个 button 是 **disabled** 的。
 *    **浏览器里点击 disabled button，事件不会冒泡到父元素** ——
 *    于是点「牌面那部分」时父元素的 @click 根本收不到，
 *    看起来就是「点了没反应」。
 *
 *    让牌图不接收指针事件，点击就落到整组上了。
 */
.meld {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 1px 3px;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  flex: 0 0 auto;
  cursor: pointer;
}
.meld:active {
  transform: translate(1.5px, 1.5px);
}

/* 牌图不接收点击，让点击落到整组上（见上面对 disabled button 的说明） */
.meld :deep(.tile) {
  pointer-events: none;
}

.meld-tiles,
.meld-picked {
  display: flex;
  gap: 1px;
}

.meld-kind {
  font-size: 10px;
  font-weight: 900;
}


.meld-picking {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meld-notice {
  margin: 3px 0 0;
  font-size: 10px;
  font-weight: 800;
  color: var(--err-ink);
}

/* ---------------- 试算结果条 ----------------
   ⚠️ 固定高度 —— 它随每次点牌变化，高度一变就会把上方的牌表推动，
      而那里正是用户刚点过的位置。 */
.trial-strip {
  flex: 0 0 auto;
  height: 30px;
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border: 1.5px solid var(--ink);
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 800;
  overflow: hidden;
}
.trial-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 没录完：低调的中性色 */
.trial-strip.idle {
  background: transparent;
  border-color: transparent;
  color: var(--ink-3);
}
/* 有役：绿 */
.trial-strip.ok {
  background: var(--ok-bg);
  box-shadow: var(--shadow-hard-sm);
}
/* 无役 / 不成立：粉 */
.trial-strip.bad {
  background: var(--warn-bg);
  box-shadow: var(--shadow-hard-sm);
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

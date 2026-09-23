<script setup lang="ts">
/**
 * 单张牌的显示。
 *
 * ## 为什么牌面要用 Red 套素材（踩过的坑）
 *
 * 素材三套配色的**文字颜色是反的**：Black 用白字（配深色牌面），
 * Red/Yellow 用深色字（配浅色牌面）。我用 Black 配浅色底，
 * 结果东西南北白发中和「萬」字全看不见（白字写白底）。
 * 详见 tile-images.ts 的说明。
 *
 * ## 为什么底板要用白色
 *
 * FluffyStuff 的单张牌 SVG **不带牌身底板** —— 实测 Haku.svg（白）
 * 没有任何白色像素，因为实物里的「白」本来就是空牌面加个边框。
 * 所以底板必须由 CSS 补。
 *
 * ## 波普风处理
 *
 * 牌身：白色底板 + **粗黑描边** + 硬阴影，像贴纸一样从背景上立起来。
 * 不加圆角（或只加极小圆角），保持印刷品的硬边感。
 */
import { computed } from "vue";
import { tileLabel } from "./tiles.ts";
import { tileSvgPath } from "./tile-images.ts";

const props = withDefaults(
  defineProps<{
    /** 天凤记法的牌，如 `1m` / `0p` / `5z` */
    tile: string;
    /** 是否显示中文牌名（放牌下方） */
    showLabel?: boolean;
    /** 是否可点击 */
    clickable?: boolean;
    /** 变淡（该种牌已用满 4 张） */
    dim?: boolean;
    /** 尺寸档位 */
    size?: "sm" | "md" | "lg";
  }>(),
  {
    showLabel: false,
    clickable: false,
    dim: false,
    size: "md",
  },
);

const emit = defineEmits<{ (e: "pick"): void }>();

const src = computed(() => tileSvgPath(props.tile));
const label = computed(() => tileLabel(props.tile));
const isRed = computed(() => props.tile[0] === "0");
</script>

<template>
  <button
    type="button"
    class="tile"
    :class="[`size-${size}`, { clickable, dim }]"
    :disabled="!clickable"
    :aria-label="label"
    @click="emit('pick')"
  >
    <!--
      三层结构（修「牌面偏移」的关键）：
        .body  —— 只管尺寸 / 边框 / 阴影 / 圆角
        .frame —— 只管裁剪（overflow:hidden）+ 严格比例
        img    —— 绝对定位 + translate(-50%,-50%) 做数学精确居中

      为什么必须分层：
        1. 边框会污染 aspect-ratio。`.body` 若同时有 border 和 aspect-ratio，
           且 box-sizing:border-box，则 aspect-ratio 作用在**边框框**上，
           内容框变成 (w-3)×(h-3)、比例从 0.75 掉到 0.72 ——
           图片在这个比例不对的框里 contain，必然出现 letterbox，看起来就是偏的。
           所以裁剪层 `.frame` 必须**没有边框**。
        2. `img` 默认是 inline 元素，会带基线间隙造成垂直偏移。
           改成绝对定位 + translate(-50%,-50%) 后，水平垂直都是精确居中，
           不依赖 flex 的 align/justify，也不受字体行高影响。
    -->
    <span class="body" :class="{ red: isRed }">
      <span class="frame">
        <img :src="src" :alt="label" draggable="false" />
      </span>
    </span>
    <span v-if="showLabel" class="label">{{ label }}</span>
  </button>
</template>

<style scoped>
.tile {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--ink);
  /* 行高压成 1 避免按钮高度被字体撑开 */
  line-height: 1;
  /* 按钮的 appearance 重置 —— 某些浏览器会给 button 默认的内边距/边框 */
  appearance: none;
  -webkit-appearance: none;
  /* 宽度由内容（.body）决定，不被父容器拉伸 */
  width: fit-content;
  /* 不因内容变化而改尺寸 */
  box-sizing: border-box;
}

/* 牌身：只管尺寸 / 边框 / 阴影 / 圆角。
   ⚠️ 不要让这里承担裁剪 —— 见 .frame 的说明。 */
.body {
  display: block;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 3px;
  /* 硬阴影：实心、无模糊 */
  box-shadow: 1.5px 1.5px 0 var(--ink);
  /* ⚠️ content-box 而不是 border-box —— 这是修「偏移」的关键之一。
     用 border-box 时，`aspect-ratio: 3/4` 会作用在**边框框**上，
     于是内容框变成 (w-3)×(h-3)，比例从 0.75 掉到约 0.72，
     图片在里面 contain 就会出现 letterbox，看起来就是偏的。
     改用 content-box 后，aspect-ratio 作用在**内容框**上，
     内容框严格 3:4，与 SVG 一致，图片正好铺满、无留白。
     代价：元素总宽 = 设定值 + 3px（边框），所以在尺寸计算里预留了这点。 */
  box-sizing: content-box;
  aspect-ratio: 3 / 4;
  position: relative;
}

/* 裁剪层：严格 3:4，不含边框（它就是内容框本身） */
.frame {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
}

/* ============ 图片：绝对定位 + translate 精确居中 ============
 *
 * ## 为什么不用 flex 居中
 *
 * 之前用 `object-fit: contain` + flex 居中，看起来应该没问题，但实际偏左。
 * 原因有两个：
 *
 * 1. **边框污染了比例** —— `.body` 有 1.5px 边框且 box-sizing:border-box，
 *    于是 `aspect-ratio: 3/4` 作用在**边框框**上，内容框实际是
 *    `(w-3) × (h-3)`，比例从 0.75 掉到约 0.72。
 *    图片在这个比例不对的框里 `contain`，必然出现 letterbox ——
 *    而 letterbox 的留白在视觉上就是"偏移"。
 *
 * 2. **img 是 inline 元素** —— 默认按基线对齐，行高会带来额外的垂直间隙。
 *
 * ## 改成绝对定位 + translate 后
 *
 *   position: absolute; left: 50%; top: 50%;
 *   transform: translate(-50%, -50%);
 *
 * 这是**数学上精确**的居中：把图片的左上角移到容器中心，
 * 再按图片自身尺寸的 50% 回移 —— 结果与容器/图片尺寸无关，永远居中。
 * 不依赖 flex 的 align-items、不依赖行高、不受 inline 基线影响。
 */
.frame img {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  /* 保证不变形地铺满裁剪区。
     因为 .frame 与 SVG 都是 3:4，所以实际是正好铺满、没有 letterbox。 */
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 消除 inline 元素可能带来的基线间隙（双保险） */
  display: block;
  vertical-align: middle;
}

/* 赤 5：换一圈亮色描边，一眼能认出 */
.body.red {
  border-color: var(--pop-pink);
  box-shadow: 1.5px 1.5px 0 var(--pop-pink);
}

/* ============ 尺寸（响应式）============
 *
 * ## 宽度是怎么算出来的
 *
 * `.body` 用 `box-sizing: content-box`（见上，为了让 aspect-ratio 作用在内容框上），
 * 所以 **总宽 = 这里设的 width + 3px 边框**。
 * 布局计算要把边框算进去。
 *
 * 布局开销（不含牌本身）：
 *   app padding(6×2) + 卡片边框(1.5×2) + 卡片 padding(8×2) = 31px
 *
 * 门前 13 张一行的约束：13 × (w + 3) + 12 × 1.5 ≤ 可用宽
 *   → w ≤ (可用宽 - 18 - 39) / 13 = (可用宽 - 57) / 13
 * 把 31 的开销也算进去，整体写成 `(100vw - 46px) / 13`：
 *
 * ┌──────────┬──────────┬────────────────────┐
 * │ 屏宽     │ 公式结果 │ 牌总宽             │
 * ├──────────┼──────────┼────────────────────┤
 * │ 320px    │ 21.1px   │ 24.1px             │
 * │ 360px    │ 24.2px   │ 27.2px             │
 * │ 393px+   │ 26.0px   │ 29.0px（触顶）      │
 * └──────────┴──────────┴────────────────────┘
 *
 * 用 `min()` 是为了**双向自适应**：小屏自动缩到放得下，大屏触顶后不再变大
 * （免得牌大得离谱）。
 */
.size-md .body {
  /* 牌表：一行 9 张，空间宽裕 */
  width: min(34px, calc((100vw - 46px) / 9));
}
.size-lg .body {
  /* 门前：13 张一行的硬约束 —— 上限 26px 是权衡出来的，
     再大就会在 393px 以下的屏上换行 */
  width: min(26px, calc((100vw - 46px) / 13));
}
.size-sm .body {
  /* 副露：一组最多 4 张，有大量余量，用固定值即可 */
  width: 28px;
}

/* 牌名标签 */
.label {
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: -0.04em;
  /* 固定行高，避免不同字体的度量差异造成垂直偏移 */
  line-height: 1.1;
  display: block;
}

.clickable {
  cursor: pointer;
}
.clickable .body {
  transition: transform 0.06s ease, box-shadow 0.06s ease;
}
.clickable:active .body {
  transform: translate(1.5px, 1.5px);
  box-shadow: 0 0 0 var(--ink);
}

.tile:disabled {
  cursor: default;
}

.dim .body {
  opacity: 0.35;
}
</style>

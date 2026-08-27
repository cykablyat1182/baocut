// BaoCut Subtitle Studio — 叠加元素的画布层（文本 / 图片 / 水印 + 全 kind 的交互）。
//
// 几何全部来自 element-geometry.js（烧录端 render_plan.rs 的孪生），本文件只负责
// 把它翻译成 Konva 节点、接选中/拖动/双击编辑。层次上元素在字幕之上、主画面之上
// （§3.6：字幕不占轨道，垫在所有 overlay 轨之下），所以 canvas-stage 把这一层加在
// 字幕层后面。
//
// **P6b 起本层不再是唯一的像素来源**：shape / visualizer / progress 的真像素由
// wasm overlay（wasm-overlay.jsx）用与导出同一份 Rust 光栅器画在一张垫在本层之下
// 的画布上，本层对这些元素只建透明命中盒。交互（选中框、拖拽、⌫）始终留在这里
// —— 选中框必须压在真像素之上。text / image 与水印路径零变化。
//
// 文本元素的排版与外观复用字幕内核（`BCS_SUBTITLE` + canvas-stage 的
// lineMetrics/textAttrs）：元素 `style` 就是字幕样式 schema 的子集，两端零漂移。
// 与字幕的两处有意差异（都是烧录端 render_text_element 的现状）：
//   · 换行宽是 place.w（缺省画布宽 90%），不减内边距，也不吃 style.width；
//   · 每行都居中于印章中心（元素没有 textAlign 分支），底板圆角取 padH。
(() => {
const K = window.Konva;
const R = window.BCS_SUBTITLE;
const EG = window.BCS_ELEMENT_GEOMETRY;
const CANVAS = window.BCSCanvas;

if (!K) throw new Error('Konva failed to load');
if (!R) throw new Error('subtitle-rendering.js failed to load');
if (!EG) throw new Error('element-geometry.js failed to load');
if (!CANVAS) throw new Error('canvas-stage.jsx must load before elements-stage.jsx');

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const SELECTION_STROKE = '#3b63fb';

// ---------- 图片解码缓存 ----------
// 同一个 srcId 在时间轴上可能出现多次、也会随播放头每帧重建节点，所以
// HTMLImageElement 按 URL 缓存；加载完成再通知调用方重画一次该层。
const imageCache = new Map();

function imageEntry(url, onSettled) {
  const cached = imageCache.get(url);
  if (cached) {
    if (cached.state === 'loading' && onSettled) cached.waiters.push(onSettled);
    return cached;
  }
  const image = new Image();
  const entry = { state: 'loading', image, waiters: onSettled ? [onSettled] : [] };
  imageCache.set(url, entry);
  const settle = (state) => () => {
    entry.state = state;
    entry.waiters.splice(0).forEach((fn) => fn(entry));
  };
  image.onload = settle('ready');
  image.onerror = settle('error');
  image.src = url;
  return entry;
}

// ---------- 文本元素 ----------
// 注意**不吃 place.flipX/flipY**：烧录端 `render_text_element` 的 `group_transform`
// 里没有镜像分支（只有 media 与 shape 两条路径读 `flip_signs`），预览跟着不翻。
// 这是有意与烧录端一致，不是漏了。
function buildTextStamps(element, options) {
  const { width, height } = options;
  const style = (element.style && typeof element.style === 'object') ? element.style : {};
  const metrics = CANVAS.lineMetrics(style, width, height, false, false);
  const attrs = CANVAS.textAttrs(metrics);
  const text = R.transformText(String(element.text == null ? '' : element.text), metrics.lineStyle);
  const probe = new K.Text(attrs);
  const measure = (value) => {
    probe.text(value);
    return Math.ceil(probe.getTextWidth() * 100) / 100;
  };
  const wrapped = EG.textWrap(text, EG.textWrapWidth(element, width), measure);
  probe.destroy();
  const lineHeightPx = metrics.fontSize * metrics.lineHeight;
  const contentHeight = wrapped.lines.length * lineHeightPx;
  const placement = EG.textPlacement(element, {
    frameWidth: width,
    frameHeight: height,
    contentWidth: wrapped.width,
    contentHeight,
    padV: metrics.padV,
  });
  const boxWidth = wrapped.width + metrics.padH * 2;
  const boxHeight = contentHeight + metrics.padV * 2;
  const nodes = placement.stamps.map((stamp) => {
    const group = new K.Group({
      x: stamp.x,
      y: stamp.y,
      rotation: stamp.rotation,
      scaleX: placement.scaleX,
      scaleY: placement.scaleY,
      opacity: placement.opacity,
      listening: false,
    });
    if (metrics.backgroundOn) {
      group.add(new K.Rect({
        x: -boxWidth / 2,
        y: placement.topOffset - metrics.padV,
        width: boxWidth,
        height: boxHeight,
        // 圆角取 padH：元素底板走 render_plan 的 fill_round_rect(…, background_pad_h)，
        // 与字幕底板的 borderRadius 不是同一个来源，别在这里"顺手统一"。
        cornerRadius: metrics.padH,
        fill: CANVAS.canvasColor(metrics.lineStyle.backgroundColor, '#000000cc'),
        listening: false,
      }));
    }
    wrapped.lines.forEach((line, index) => {
      group.add(new K.Text({
        ...attrs,
        x: -line.width / 2,
        y: placement.topOffset + index * lineHeightPx + (lineHeightPx - metrics.fontSize) / 2,
        text: line.text,
      }));
    });
    return group;
  });
  return {
    nodes,
    placement,
    metrics,
    // 命中面 / 选中框：一枚透明矩形，钉在**锚点**（place.x/y）上，尺寸为含内边距的
    // 文本盒。平铺时印章有几百枚，它们只负责显示；可点、可拖、被选中框圈住的始终
    // 是锚点这一个对象 —— 拖动写回的也正是它那一维。
    anchor: anchorBox(placement, {
      x: -boxWidth / 2,
      y: placement.topOffset - metrics.padV,
      width: boxWidth,
      height: boxHeight,
    }),
  };
}

// 锚点命中面：位置取 placement.anchor，旋转只吃 place.rot（不含 tile.angle —— 那是
// 印章各自的花纹角度，不是这个对象的朝向）。
function anchorBox(placement, box) {
  const group = new K.Group({
    x: placement.anchor.x,
    y: placement.anchor.y,
    rotation: placement.rotation,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
  });
  group.add(new K.Rect({ ...box, fill: 'rgba(0,0,0,0.001)', listening: true }));
  return group;
}

// ---------- 图片元素 ----------
function buildImageStamps(element, options) {
  const { width, height, mediaURL, onSettled } = options;
  const url = mediaURL(element.srcId);
  const entry = imageEntry(url, onSettled);
  if (entry.state !== 'ready') return null;
  const natural = { width: entry.image.naturalWidth || 1, height: entry.image.naturalHeight || 1 };
  const placement = EG.imagePlacement(element, {
    frameWidth: width,
    frameHeight: height,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
  });
  const boxWidth = placement.boxWidth;
  const boxHeight = placement.boxHeight;
  // fit：cover 取长边铺满并裁切，contain 完整放入。contain 的留边填充只做 black
  // （bg: 'blur' 的高斯留边本轮省略，见报告）。
  const ratio = placement.fit === 'contain'
    ? Math.min(boxWidth / natural.width, boxHeight / natural.height)
    : Math.max(boxWidth / natural.width, boxHeight / natural.height);
  const drawWidth = natural.width * ratio;
  const drawHeight = natural.height * ratio;
  const nodes = placement.stamps.map((stamp) => {
    const group = new K.Group({
      x: stamp.x,
      y: stamp.y,
      rotation: stamp.rotation,
      // 镜像只进这一层的缩放（烧录端 render_media_element 的 `post_scale(
      // uniform_scale * flip_x, …)`）：平铺点阵用的是**未镜像**的 scaleX，
      // 已经在 imagePlacement 里算完了，别把 flip 折回去。
      scaleX: placement.scaleX * placement.flipX,
      scaleY: placement.scaleY * placement.flipY,
      opacity: placement.opacity,
      offsetX: boxWidth / 2,
      offsetY: boxHeight / 2,
      listening: false,
      clipFunc: (context) => {
        const radius = Math.max(0, Math.min(placement.radius, Math.min(boxWidth, boxHeight) / 2));
        context.beginPath();
        if (radius <= 0) {
          context.rect(0, 0, boxWidth, boxHeight);
        } else {
          context.moveTo(radius, 0);
          context.arcTo(boxWidth, 0, boxWidth, boxHeight, radius);
          context.arcTo(boxWidth, boxHeight, 0, boxHeight, radius);
          context.arcTo(0, boxHeight, 0, 0, radius);
          context.arcTo(0, 0, boxWidth, 0, radius);
        }
        context.closePath();
      },
    });
    if (placement.fit === 'contain') {
      group.add(new K.Rect({ width: boxWidth, height: boxHeight, fill: '#000', listening: false }));
    }
    group.add(new K.Image({
      image: entry.image,
      x: (boxWidth - drawWidth) / 2,
      y: (boxHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
      listening: false,
    }));
    return group;
  });
  return {
    nodes,
    placement,
    metrics: null,
    anchor: anchorBox(placement, {
      x: -boxWidth / 2,
      y: -boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
    }),
  };
}

// ---------- 形状元素 ----------
// 几何与参数全部来自 EG.shapePlacement（`element_draw.rs::push_shape_ops` 孪生），
// 本函数只把它翻成 Konva 节点。两条纪律照抄烧录端：
//   · 配方的 `params` 是封闭词汇表 —— 椭圆不吃 cornerRadius，线段不吃 fill；
//   · 盒子已含 place.scale，所以组上的缩放只剩镜像符号（placement.scaleX = flipX）。
function shapeNodes(placement) {
  const box = placement.box;
  const nodes = [];
  const strokeAttrs = (color) => ({
    stroke: color,
    strokeWidth: placement.strokeWidth,
    // Konva 缺省会把描边宽度也跟着节点缩放，元素盒这条已经把 scale 烘进尺寸了，
    // 再缩一次描边就和成片对不上。
    strokeScaleEnabled: false,
    listening: false,
  });
  if (placement.path === 'rect') {
    nodes.push(new K.Rect({
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      // Konva 的四角顺序与 core / VEED 一致：[左上, 右上, 右下, 左下]。
      cornerRadius: placement.cornerRadius,
      fill: placement.fill || undefined,
      ...(placement.stroke && placement.strokeWidth > 0 ? strokeAttrs(placement.stroke) : {}),
      listening: false,
    }));
  } else if (placement.path === 'ellipse') {
    nodes.push(new K.Ellipse({
      x: placement.centerX,
      y: placement.centerY,
      radiusX: box.w / 2,
      radiusY: box.h / 2,
      fill: placement.fill || undefined,
      ...(placement.stroke && placement.strokeWidth > 0 ? strokeAttrs(placement.stroke) : {}),
      listening: false,
    }));
  } else if (placement.path === 'segment') {
    if (placement.strokeWidth > 0) {
      nodes.push(new K.Line({
        points: [placement.start.x, placement.start.y, placement.end.x, placement.end.y],
        ...strokeAttrs(placement.strokeColor),
      }));
    }
    if (placement.headPoints) {
      const flat = [];
      placement.headPoints.forEach((point) => { flat.push(point.x, point.y); });
      nodes.push(new K.Line({
        points: flat,
        closed: true,
        fill: placement.strokeColor,
        listening: false,
      }));
    }
  }
  return nodes;
}

function buildShapeStamps(element, options) {
  const placement = EG.shapePlacement(element, {
    frameWidth: options.width,
    frameHeight: options.height,
  });
  // 未登记的形状：不画。与烧录端 `push_shape_element` 的 `preset-unknown` 跳过
  // 同口径 —— 预览里看不见，而不是画成一个别的东西。
  if (!placement) return null;
  // `outline`（P7a 登记的 20 个形状）的点列只存在于渲染端：设计明令浏览器不手抄
  // 那张表（§13 P7a 偏离6；P7b 的生成器只出 apps/mac 与 designs/baocut-mac 两份）。
  // 所以这里不自绘，而是走占位：wasm overlay 没接手时（没有 OffscreenCanvas、
  // 模块加载失败、元素不在 `planOverlay().rendered` 里）仍然有像素、有命中盒、
  // 选得中、拖得动 —— 正是 wasm-overlay.jsx 承诺的那个回落。返回 null 会让元素
  // 整个从层里消失（不只是看不见，而是选不中、拖不动、没有选中框）。
  if (placement.path === 'outline') {
    return buildPlaceholderStamps(element, { ...options, placement });
  }
  const nodes = shapeNodes(placement);
  if (!nodes.length) return null;
  // 绕盒中心的仿射：x = offsetX = centerX ⇒ 子节点用画布绝对坐标，与
  // `element_transform` 的 `T(-c) · S · R · T(c)` 同序（Konva 也是先缩放后旋转）。
  const group = new K.Group({
    x: placement.centerX,
    y: placement.centerY,
    offsetX: placement.centerX,
    offsetY: placement.centerY,
    rotation: placement.rotation,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
    opacity: placement.opacity,
    listening: false,
  });
  nodes.forEach((node) => group.add(node));
  return {
    nodes: [group],
    placement,
    metrics: null,
    anchor: anchorBox(placement, {
      x: -placement.box.w / 2,
      y: -placement.box.h / 2,
      width: placement.box.w,
      height: placement.box.h,
    }),
  };
}

// ---------- 只留命中盒（真像素归 wasm overlay） ----------
// P6b 起 shape / visualizer / progress 由 wasm overlay 出**与导出同一份光栅器**的
// 真像素（wasm-overlay.jsx，画布垫在本层之下）。这一层于是只剩交互：一枚透明的
// 锚点矩形，负责选中、拖拽与选中框。像素与命中盒因此各有唯一来源，不会打架。
//
// shape 走 `shapePlacement` 而不是 `boxPlacement`：未登记的形状 wasm 也不画
// （`preset-unknown` 跳过），这里跟着不给命中盒 —— 画面上看不见的东西不该点得中。
function buildHitBoxOnly(element, options) {
  // `aspect` 来自 wasm 的 `elementAspects()`（配方注册表的真相），不是 JS 猜的：
  // `donut` / `circle` / `formation_circle` 是方盒，不给 aspect 就会退到横条类
  // 的默认高度——画出来是个圆、点得中的是一条横杠。
  const geometry = {
    frameWidth: options.width, frameHeight: options.height, aspect: options.aspect,
  };
  const placement = element.kind === 'shape'
    ? EG.shapePlacement(element, geometry)
    : EG.boxPlacement(element, geometry);
  if (!placement) return null;
  const box = placement.box;
  if (!(box.w > 0) || !(box.h > 0)) return null;
  return {
    nodes: [],
    placement,
    metrics: null,
    anchor: anchorBox(placement, {
      x: -box.w / 2, y: -box.h / 2, width: box.w, height: box.h,
    }),
  };
}

// ---------- 占位（visualizer / progress / 模板贴纸 / outline 形状） ----------
// wasm overlay 起不来时的回落（产物没同步进 skill、浏览器没有 OffscreenCanvas、
// 频谱还在算或算不出来）。留空会让"我加的波形没画出来"和"这一层画不了"在画面上
// 无法区分，所以画占位而不是什么都不画。
// **模板贴纸自 P7b 起在 overlay 里是真渲染的**（内置模板库是归一化 path，与
// shape 同一条矢量通路），这里只剩非 overlay 兜底那一支。
// 半透明系数 0.35 与烧录端 `push_element_placeholder` 同值，两边一眼看得出是同一块。
const PLACEHOLDER_ALPHA = 0.35;
const PLACEHOLDER_LABELS = {
  visualizer: '音频波形 · 频谱准备中，导出可见',
  progress: '进度条 · 预览暂不渲染，导出可见',
  sticker: '模板贴纸 · 预览暂不渲染，导出可见',
  shape: '形状 · 轮廓预览暂不可用，导出可见',
};

// 占位色取元素自己的主色：一帧里几块占位并排时还认得出谁是谁。
// 形状没有 mainColor，用它自己的 fill（只设了描边就退到 stroke）。
function placeholderColor(element) {
  const props = (element.kind === 'shape'
    ? element.shape
    : (element.kind === 'visualizer' ? element.visualizer : element.progress)) || {};
  const color = element.kind === 'shape' ? (props.fill || props.stroke) : props.mainColor;
  return typeof color === 'string' ? color : '#ffffff';
}

function buildPlaceholderStamps(element, options) {
  // 形状那条路已经算过 `shapePlacement`（它比 boxPlacement 多一道"未登记就不画"
  // 的门），直接复用，不再算第二遍。
  const placement = options.placement || EG.boxPlacement(element, {
    frameWidth: options.width,
    frameHeight: options.height,
  });
  const box = placement.box;
  if (!(box.w > 0) || !(box.h > 0)) return null;
  const color = placeholderColor(element);
  const group = new K.Group({
    x: placement.centerX,
    y: placement.centerY,
    offsetX: placement.centerX,
    offsetY: placement.centerY,
    rotation: placement.rotation,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
    // 元素自身的不透明度再乘 0.35：颜色带 alpha 时两端的乘积一致。
    opacity: placement.opacity * PLACEHOLDER_ALPHA,
    listening: false,
  });
  group.add(new K.Rect({
    x: box.x, y: box.y, width: box.w, height: box.h, fill: color, listening: false,
  }));
  group.add(new K.Rect({
    x: box.x, y: box.y, width: box.w, height: box.h,
    stroke: color, strokeWidth: 1, dash: [6, 4], strokeScaleEnabled: false, listening: false,
  }));
  const fontSize = Math.max(10, Math.round(Math.min(options.width, options.height) * 0.026));
  const label = PLACEHOLDER_LABELS[element.kind] || '该元素暂不在预览中渲染';
  if (box.h >= fontSize * 1.6) {
    group.add(new K.Text({
      x: box.x,
      y: placement.centerY - fontSize / 2,
      width: box.w,
      align: 'center',
      text: label,
      fontSize,
      fontFamily: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
      fill: '#ffffff',
      listening: false,
    }));
  }
  return {
    nodes: [group],
    placement,
    metrics: null,
    anchor: anchorBox(placement, {
      x: -box.w / 2, y: -box.h / 2, width: box.w, height: box.h,
    }),
  };
}

// ---------- 分派 ----------
// **显式分派 + 明确的 default**：以前这里是个二元三目，"不是 image 就当 text"，
// 于是 core 每扩一个 kind，studio 就多一种被静默画成文字的元素。现在每个 kind
// 各有一臂，认不出来的一律 return null（不画），与 EG.RENDERABLE_KINDS 的白名单
// 是同一条纪律的两端。
//
// `options.wasmIds` 是本轮由 wasm overlay 出真像素的元素 id 集合（来自
// wasm-overlay.js 的 `planOverlay().rendered`）。命中即只建命中盒 —— 判据按
// **元素**而不是按 kind：同一份 timeline 里，频谱已到货的 visualizer 归 wasm，
// 还在拉的那一个继续显示占位，两者可以并存。
function buildElement(element, options) {
  const { width, height, mediaURL, onSettled, wasmIds, wasmAspects } = options;
  if (wasmIds && wasmIds.has(element.id)) {
    return buildHitBoxOnly(element, {
      width, height, aspect: wasmAspects ? wasmAspects[element.id] : undefined,
    });
  }
  switch (element.kind) {
    case 'text':
      return buildTextStamps(element, { width, height });
    case 'image':
      return buildImageStamps(element, { width, height, mediaURL, onSettled });
    case 'shape':
      return buildShapeStamps(element, { width, height });
    case 'sticker':
      // 资产贴纸（有 srcId）走图片那条路 —— 烧录端 `render_media_element` 对
      // **静态**资产贴纸也是这么做的。动态贴纸（源自述 `kind: "video"` 的
      // alpha WebM）在导出里是逐帧视频层，这一层当静帧画，与 `video` 元素
      // 在非 overlay 兜底下的处理同级。
      // 模板贴纸没有 srcId：overlay 起得来时由 wasm 真渲染（P7b），起不来才
      // 落到这块占位。
      return element.srcId
        ? buildImageStamps(element, { width, height, mediaURL, onSettled })
        : buildPlaceholderStamps(element, { width, height });
    case 'visualizer':
    case 'progress':
      return buildPlaceholderStamps(element, { width, height });
    default:
      return null;
  }
}

// ---------- 层装配 ----------
// 一次性重建整层：元素数量以个位数计，逐帧 diff 不值得。返回 { anchors } 供调用方
// 需要时定位（当前只有内部使用）。
function renderElements(options) {
  const {
    layer, stage, elements, width, height, selectedId, editingId, playing, mediaURL, actions,
    wasmIds, wasmAspects,
  } = options;
  layer.destroyChildren();
  if (!elements || !elements.length) {
    layer.draw();
    return { count: 0 };
  }

  const guideAttrs = { stroke: SELECTION_STROKE, strokeWidth: 1, visible: false, listening: false };
  const vGuide = new K.Line({ points: [width / 2, 0, width / 2, height], ...guideAttrs });
  const hGuide = new K.Line({ points: [0, height / 2, width, height / 2], ...guideAttrs });
  const transformer = new K.Transformer({
    nodes: [],
    enabledAnchors: [],
    rotateEnabled: false,
    borderStroke: SELECTION_STROKE,
    borderStrokeWidth: 2,
    padding: 6,
    visible: false,
    listening: false,
  });

  let selectedAnchor = null;
  elements.forEach((element) => {
    const built = buildElement(element, {
      width, height, mediaURL, onSettled: actions.onImageReady, wasmIds, wasmAspects,
    });
    // `nodes` 可以是空的：wasm overlay 出像素的元素在这一层只剩命中盒。
    if (!built) return;
    const selected = selectedId === element.id;
    const editing = editingId === element.id;
    const container = new K.Group({ listening: !editing });
    built.nodes.forEach((node) => container.add(node));
    const anchorNode = built.anchor;
    container.add(anchorNode);
    if (editing) container.visible(false);
    layer.add(container);
    const anchorCenter = { x: built.placement.anchor.x, y: built.placement.anchor.y };

    container.on('click tap', (event) => {
      event.cancelBubble = true;
      const action = actions.press({
        hasTarget: true,
        targetSelected: selected,
        select: () => actions.select(element),
      });
      if (action === 'passThrough') actions.select(element);
    });
    // 文本元素双击进内联编辑（图片没有可编辑的文本）。与字幕同款前提：已选中、
    // 已暂停 —— 播放中双击只会连击到播放/暂停策略上。
    if (element.kind === 'text') {
      container.on('dblclick dbltap', (event) => {
        event.cancelBubble = true;
        if (playing || !selected) return;
        actions.edit(
          element,
          anchorNode.getClientRect({ relativeTo: stage, skipShadow: true }),
          built.metrics,
        );
      });
    }
    container.on('mouseenter', () => {
      stage.container().style.cursor = selected && !playing ? 'grab' : 'default';
    });
    container.on('mouseleave', () => { stage.container().style.cursor = 'default'; });

    const draggable = selected && !playing && !editing;
    container.draggable(draggable);
    if (draggable) {
      container.dragBoundFunc((pos) => {
        // 吸附中线、钳制在画面内：判据作用在**锚点**上（平铺水印移动的就是锚点），
        // 与写回 place.x/y 的那一维一致。
        const rawX = anchorCenter.x + pos.x;
        const rawY = anchorCenter.y + pos.y;
        const centerX = clamp(Math.abs(rawX - width / 2) < 8 ? width / 2 : rawX,
          width * 0.02, width * 0.98);
        const centerY = clamp(Math.abs(rawY - height / 2) < 8 ? height / 2 : rawY,
          height * 0.02, height * 0.98);
        vGuide.visible(Math.abs(centerX - width / 2) < 1);
        hGuide.visible(Math.abs(centerY - height / 2) < 1);
        return { x: centerX - anchorCenter.x, y: centerY - anchorCenter.y };
      });
      container.on('dragstart', () => { stage.container().style.cursor = 'grabbing'; });
      container.on('dragend', () => {
        vGuide.hide();
        hGuide.hide();
        stage.container().style.cursor = 'grab';
        actions.move(element, container.x(), container.y());
        layer.batchDraw();
      });
    }
    if (selected && !editing) selectedAnchor = anchorNode;
  });

  layer.add(vGuide);
  layer.add(hGuide);
  layer.add(transformer);
  if (selectedAnchor) {
    transformer.nodes([selectedAnchor]);
    transformer.visible(true);
  }
  layer.draw();
  return { count: elements.length };
}

// `buildElement` 也导出：kind 分派是这一层最容易悄悄退化的地方（它正是从一个
// 二元三目长出来的），单测直接钉住它比钉整层重建便宜得多。
window.BCSElements = { renderElements, imageEntry, buildElement };
})();

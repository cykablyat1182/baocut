// elements-stage.jsx 的 kind 分派与 Konva 翻译。
//
// 这一层没有 JSX，只是个往 window 上挂 API 的 IIFE，所以用一套极薄的 Konva 替身把
// 源文件求值出来，直接问 `buildElement` 每种 kind 画了什么。钉的是三件事：
//   · 分派表本身（它正是从"不是 image 就当 text"那个二元三目长出来的）；
//   · 形状指令与 element_draw.rs 的对应（矩形/椭圆/线段/箭头 × fill/stroke）；
//   · 镜像加在**画印章的那一层**，而不是折进几何。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EG = require('./element-geometry.js');

// ---------- Konva 替身 ----------
// 只记录「建了什么类型的节点、带哪些属性、挂在谁下面」，不画一个像素。
class Node {
  constructor(type, attrs) {
    this.type = type;
    this.attrs = { ...attrs };
    this.children = [];
  }

  add(child) { this.children.push(child); return this; }

  destroy() { this.destroyed = true; }

  text(value) { this.attrs.text = value; return this; }

  getTextWidth() { return String(this.attrs.text || '').length * 10; }

  visible(value) { this.attrs.visible = value; return this; }
}

const konvaClass = (type) => class extends Node {
  constructor(attrs) { super(type, attrs); }
};

const K = {
  Group: konvaClass('Group'),
  Rect: konvaClass('Rect'),
  Ellipse: konvaClass('Ellipse'),
  Line: konvaClass('Line'),
  Text: konvaClass('Text'),
  Image: konvaClass('Image'),
  Transformer: konvaClass('Transformer'),
};

// 文本那条路要经过字幕内核与画布层，这里给最小可用的替身（几何由
// element-geometry.js 真算，样式一律走缺省）。
const SUBTITLE = { transformText: (text) => text };
const CANVAS = {
  lineMetrics: () => ({
    fontSize: 40, lineHeight: 1.2, padH: 10, padV: 8, backgroundOn: false, lineStyle: {},
  }),
  textAttrs: () => ({ fontSize: 40 }),
  canvasColor: (value, fallback) => value || fallback,
};

function loadStage() {
  const source = fs.readFileSync(path.join(__dirname, 'elements-stage.jsx'), 'utf8');
  const scope = {
    Konva: K,
    BCS_SUBTITLE: SUBTITLE,
    BCS_ELEMENT_GEOMETRY: EG,
    BCSCanvas: CANVAS,
  };
  const window = new Proxy(scope, {
    get: (target, key) => target[key],
    set: (target, key, value) => { target[key] = value; return true; },
    has: () => true,
  });
  // `new Image()` 是浏览器全局，node 里没有：给一个只记 src 的替身。
  const ImageStub = class { set src(value) { this._src = value; } };
  // eslint-disable-next-line no-new-func
  new Function('window', 'Image', source)(window, ImageStub);
  return scope.BCSElements;
}

const STAGE = loadStage();
const W = 960;
const H = 540;
const OPTIONS = { width: W, height: H, mediaURL: (id) => '/media/' + id, onSettled: () => {} };

const flatten = (node, out = []) => {
  out.push(node);
  node.children.forEach((child) => flatten(child, out));
  return out;
};
const typesOf = (built) => flatten(built.nodes[0]).map((node) => node.type);

test('buildElement 的分派表：每个 kind 一臂，认不出来的一律不画', () => {
  // 未知 kind **不再**落进文本分支：core 每扩一个 kind，studio 以前就多一种被
  // 静默画成文字的元素。
  assert.strictEqual(STAGE.buildElement({ kind: 'motion', id: 'm1' }, OPTIONS), null);
  assert.strictEqual(STAGE.buildElement({ kind: 'video', id: 'v1', srcId: 's' }, OPTIONS), null);
  assert.strictEqual(STAGE.buildElement({ kind: undefined, id: 'x1', text: '嗨' }, OPTIONS), null);
  // 已登记的 kind 各自有产出。
  const text = STAGE.buildElement({ kind: 'text', id: 't1', text: '嗨' }, OPTIONS);
  assert.ok(text && text.nodes.length);
  const shape = STAGE.buildElement(
    { kind: 'shape', id: 's1', shape: { shape: 'rect', fill: '#ff0000' } }, OPTIONS,
  );
  assert.ok(shape && shape.nodes.length);
  ['visualizer', 'progress'].forEach((kind) => {
    const built = STAGE.buildElement(
      { kind, id: kind, [kind]: { style: 'x' } }, OPTIONS,
    );
    assert.ok(built && built.nodes.length, kind);
  });
  // 未登记的形状：不画，而不是画成别的形状。判据用一个真正不存在的名字 ——
  // `star` 自 P7a 起已登记（element-geometry.js order 20，path `outline`）。
  assert.strictEqual(
    STAGE.buildElement({ kind: 'shape', id: 's2', shape: { shape: 'hexagon' } }, OPTIONS), null,
  );
  // 反过来：登记了的 outline 形状必须有产出（回落占位），不能整个从层里掉出去。
  const star = STAGE.buildElement(
    { kind: 'shape', id: 's2b', shape: { shape: 'star', fill: '#ff00ff' } }, OPTIONS,
  );
  assert.ok(star && star.nodes.length);
  // 既没有 fill 也没有 stroke 的矩形画不出任何东西 —— 与烧录端的 warn + 零指令一致。
  const blank = STAGE.buildElement({ kind: 'shape', id: 's3', shape: { shape: 'rect' } }, OPTIONS);
  assert.strictEqual(flatten(blank.nodes[0]).filter((node) => node.type === 'Rect').length, 1);
  assert.strictEqual(flatten(blank.nodes[0])[1].attrs.fill, undefined);
});

test('buildElement：资产贴纸走图片那条路，模板贴纸画占位', () => {
  // 资产贴纸有 srcId，走 buildImageStamps —— 图还没解码完时它返回 null（等
  // onSettled 回调重画），这正是"走了图片那条路"的证据。
  assert.strictEqual(
    STAGE.buildElement({ kind: 'sticker', id: 'k1', srcId: 'src-a', sticker: { source: 'asset' } }, OPTIONS),
    null,
  );
  // 模板贴纸没有 srcId，画占位（烧录端 P0 也还没实现模板贴纸）。
  const template = STAGE.buildElement(
    { kind: 'sticker', id: 'k2', sticker: { source: 'template', templateId: 'box' }, place: { w: 40 } },
    OPTIONS,
  );
  assert.ok(template);
  // 盒比走 core 的 0.62（`STICKER_BOX_HEIGHT_RATIO`）。
  assert.strictEqual(template.placement.box.h, template.placement.box.w * 0.62);
});

test('buildShapeStamps：矩形 / 椭圆 / 线段 / 箭头的节点与 element_draw.rs 对应', () => {
  const rect = STAGE.buildElement({
    kind: 'shape',
    id: 's1',
    place: { x: 50, y: 50, w: 40 },
    shape: { shape: 'rect', fill: '#ff0000', stroke: '#00ff00', cornerRadius: [12, 12, 12, 12] },
  }, OPTIONS);
  assert.deepStrictEqual(typesOf(rect), ['Group', 'Rect']);
  const node = rect.nodes[0].children[0];
  assert.deepStrictEqual(
    [node.attrs.x, node.attrs.y, node.attrs.width, node.attrs.height],
    [W / 2 - W * 0.2, H / 2 - W * 0.2, W * 0.4, W * 0.4],
  );
  assert.deepStrictEqual(node.attrs.cornerRadius, [12, 12, 12, 12]);
  assert.strictEqual(node.attrs.fill, '#ff0000');
  assert.strictEqual(node.attrs.stroke, '#00ff00');
  // 描边宽度不跟节点缩放：盒子已经把 place.scale 烘进尺寸了。
  assert.strictEqual(node.attrs.strokeScaleEnabled, false);

  // 椭圆的配方不声明 cornerRadius，所以那个字段根本不进节点。
  const ellipse = STAGE.buildElement({
    kind: 'shape', id: 's2', place: { w: 40 },
    shape: { shape: 'ellipse', fill: '#00ff00', cornerRadius: [40, 40, 40, 40] },
  }, OPTIONS);
  assert.deepStrictEqual(typesOf(ellipse), ['Group', 'Ellipse']);
  const oval = ellipse.nodes[0].children[0];
  assert.deepStrictEqual([oval.attrs.radiusX, oval.attrs.radiusY], [W * 0.2, W * 0.2]);
  assert.strictEqual(oval.attrs.cornerRadius, undefined);

  // 线段一条 Line；箭头多一条闭合三角。
  const line = STAGE.buildElement({
    kind: 'shape', id: 's3', place: { w: 40 }, shape: { shape: 'line', stroke: '#ffffff' },
  }, OPTIONS);
  assert.deepStrictEqual(typesOf(line), ['Group', 'Line']);
  const arrow = STAGE.buildElement({
    kind: 'shape', id: 's4', place: { w: 40 }, shape: { shape: 'arrow', stroke: '#ffffff' },
  }, OPTIONS);
  assert.deepStrictEqual(typesOf(arrow), ['Group', 'Line', 'Line']);
  const head = arrow.nodes[0].children[1];
  assert.strictEqual(head.attrs.closed, true);
  assert.strictEqual(head.attrs.fill, '#ffffff');
  assert.strictEqual(head.attrs.points.length, 6);
  // head: "none" 关掉端头。
  const headless = STAGE.buildElement({
    kind: 'shape', id: 's5', place: { w: 40 },
    shape: { shape: 'arrow', stroke: '#ffffff', head: 'none' },
  }, OPTIONS);
  assert.deepStrictEqual(typesOf(headless), ['Group', 'Line']);
});

test('镜像加在印章那一层：形状组只带 ±1，place.scale 不再乘第二次', () => {
  const element = {
    kind: 'shape', id: 's1', place: { w: 40, scale: 2, flipX: true },
    shape: { shape: 'rect', fill: '#ff0000' },
  };
  const built = STAGE.buildElement(element, OPTIONS);
  const group = built.nodes[0];
  assert.strictEqual(group.attrs.scaleX, -1);
  assert.strictEqual(group.attrs.scaleY, 1);
  // scale 只在盒子尺寸里出现一次。
  assert.strictEqual(built.placement.box.w, W * 0.4 * 2);
  // 绕盒中心：x === offsetX。
  assert.strictEqual(group.attrs.x, group.attrs.offsetX);
  assert.strictEqual(group.attrs.y, group.attrs.offsetY);
});

test('visualizer / progress 占位：半透明块 + 提示，与烧录端同一个 0.35', () => {
  const built = STAGE.buildElement({
    kind: 'visualizer', id: 'v1',
    place: { w: EG.VISUALIZER_BAR_W, opacity: 0.5 },
    visualizer: { style: 'formation', mainColor: '#00ffff' },
  }, OPTIONS);
  const group = built.nodes[0];
  // 元素自身不透明度 × 0.35（`push_element_placeholder` 的同一个系数）。
  assert.ok(Math.abs(group.attrs.opacity - 0.5 * 0.35) < 1e-9);
  const kinds = typesOf(built);
  assert.deepStrictEqual(kinds, ['Group', 'Rect', 'Rect', 'Text']);
  assert.strictEqual(group.children[0].attrs.fill, '#00ffff');
  assert.ok(group.children[2].attrs.text.indexOf('导出可见') >= 0);
  // 贴底的横条：盒子按 core 的默认表（100 × 20%，y=85）。
  assert.deepStrictEqual([built.placement.box.w, built.placement.box.h], [W, H * 0.2]);
  assert.strictEqual(built.placement.centerY, H * 0.85);
  // 缺 mainColor 退回白色。
  const bare = STAGE.buildElement({
    kind: 'progress', id: 'p1', progress: { style: 'normal' },
  }, OPTIONS);
  assert.strictEqual(bare.nodes[0].children[0].attrs.fill, '#ffffff');
  assert.deepStrictEqual(typesOf(bare), ['Group', 'Rect', 'Rect', 'Text']);
  // 盒子塞不下一行字时只留色块，不塞一条被裁掉一半的提示（progress 缺省高 5%，
  // 小画布上就是这种情形）。
  const thin = STAGE.buildElement(
    { kind: 'progress', id: 'p2', progress: { style: 'normal' } },
    { ...OPTIONS, width: 320, height: 180 },
  );
  assert.deepStrictEqual(typesOf(thin), ['Group', 'Rect', 'Rect']);
});

// P7a 起 SHAPE_RECIPES 有 24 条，其中 20 条是 `outline`。它们的点列只在渲染端，
// studio 不手抄（§13 P7a 偏离6），所以自绘那一支画不出它们 —— 但"画不出"必须是
// 占位，而不是 `buildElement` 返回 null：返回 null 的元素连 anchor 都没有，
// renderElements 的 `if (!built) return` 会把它整个从 Konva 层里丢掉，
// 于是既看不见、也选不中、拖不动、没有选中框。
test('outline 形状回落占位：wasm 没接手时仍看得见、选得中', () => {
  const star = {
    kind: 'shape', id: 's1', place: { x: 50, y: 50, w: 40, opacity: 0.5 },
    shape: { shape: 'star', fill: '#ff00ff' },
  };
  const built = STAGE.buildElement(star, OPTIONS);
  assert.ok(built, 'outline 形状不能整个从层里掉出去');
  // 与 visualizer / progress 同一块占位：半透明色块 + 虚线框 + 提示。
  assert.deepStrictEqual(typesOf(built), ['Group', 'Rect', 'Rect', 'Text']);
  const group = built.nodes[0];
  assert.ok(Math.abs(group.attrs.opacity - 0.5 * 0.35) < 1e-9);
  // 占位色取形状自己的 fill，不是白板。
  assert.strictEqual(group.children[0].attrs.fill, '#ff00ff');
  assert.ok(group.children[2].attrs.text.indexOf('导出可见') >= 0);
  // 几何仍是形状那条路算的：盒子、命中盒、path 都在，拖拽写回的是同一维。
  assert.strictEqual(built.placement.path, 'outline');
  assert.strictEqual(built.placement.box.w, W * 0.4);
  assert.strictEqual(built.anchor.children[0].attrs.width, W * 0.4);
  // 只设描边的形状退到 stroke；两个都没有才用白色。
  const outlined = STAGE.buildElement(
    { kind: 'shape', id: 's2', place: { w: 40 }, shape: { shape: 'love', stroke: '#00ff00' } },
    OPTIONS,
  );
  assert.strictEqual(outlined.nodes[0].children[0].attrs.fill, '#00ff00');
  const bare = STAGE.buildElement(
    { kind: 'shape', id: 's3', place: { w: 40 }, shape: { shape: 'chevron' } }, OPTIONS,
  );
  assert.strictEqual(bare.nodes[0].children[0].attrs.fill, '#ffffff');
  // 自绘的那四条（rect / ellipse / line / arrow）不受影响，照旧出真节点。
  const rect = STAGE.buildElement(
    { kind: 'shape', id: 's4', place: { w: 40 }, shape: { shape: 'rect', fill: '#ff0000' } },
    OPTIONS,
  );
  assert.deepStrictEqual(typesOf(rect), ['Group', 'Rect']);
  // 未登记的形状仍然什么都不给 —— 占位是给"画得出但这一层画不了"的，
  // 不是给"文档引用了不存在的形状"的。
  assert.strictEqual(
    STAGE.buildElement({ kind: 'shape', id: 's5', shape: { shape: 'hexagon' } }, OPTIONS), null,
  );
  // wasm 接手后回到只剩命中盒：像素只有一个来源，占位不会和真像素叠一起。
  const taken = STAGE.buildElement(star, { ...OPTIONS, wasmIds: new Set(['s1']) });
  assert.deepStrictEqual(taken.nodes, []);
});

// ---------- wasm overlay 接管后的这一层 ----------
// P6b：shape / visualizer / progress 的真像素归 wasm（wasm-overlay.jsx），本层
// 只剩透明命中盒。判据按**元素 id**而不是 kind —— 频谱还在拉的那个 visualizer
// 继续显示占位，同一帧里两种形态并存。
test('wasmIds 命中的元素只剩命中盒，没命中的照旧自绘 / 占位', () => {
  const shape = {
    kind: 'shape', id: 's1', place: { x: 50, y: 50, w: 40 },
    shape: { shape: 'rect', fill: '#ff0000' },
  };
  const wave = {
    kind: 'visualizer', id: 'v1',
    place: { w: EG.VISUALIZER_BAR_W }, visualizer: { style: 'formation', mainColor: '#00ffff' },
  };
  const wasmIds = new Set(['s1', 'v1']);
  const drawn = STAGE.buildElement(shape, { ...OPTIONS, wasmIds });
  // 一个可见节点都不建 —— 像素只有一个来源，两边不会各画一份。
  assert.deepStrictEqual(drawn.nodes, []);
  // 命中盒仍在锚点上、仍是含 place.scale 的那个盒（拖拽写回的是同一维）。
  assert.strictEqual(drawn.anchor.type, 'Group');
  assert.strictEqual(drawn.anchor.children[0].attrs.width, W * 0.4);
  assert.strictEqual(drawn.placement.box.w, W * 0.4);
  const deferred = STAGE.buildElement(wave, { ...OPTIONS, wasmIds: new Set(['s1']) });
  // 没被 wasm 接管的 visualizer 回落 P0 占位（频谱还在拉、或 overlay 起不来）。
  assert.deepStrictEqual(typesOf(deferred), ['Group', 'Rect', 'Rect', 'Text']);
  // wasmIds 缺席 = overlay 整体没起来：分派表逐条回到 P0 行为。
  assert.deepStrictEqual(typesOf(STAGE.buildElement(shape, OPTIONS)), ['Group', 'Rect']);
});

test('wasmAspects：命中盒按配方的 aspect 算，不再拿横条兜底', () => {
  const donut = {
    kind: 'progress', id: 'ring', place: { x: 50, y: 30, w: 30 },
    progress: { style: 'donut', mainColor: '#3CADFF' },
  };
  const wasmIds = new Set(['ring']);
  // 不给 aspect（wasm 没起来 / 元素还在等频谱）：退到 progress 的横条默认高度。
  const guessed = STAGE.buildElement(donut, { ...OPTIONS, wasmIds });
  assert.strictEqual(guessed.placement.box.h, H * EG.PROGRESS_BAR_H / 100);
  // `donut` 的配方声明 aspect=square（由 wasm 的 elementAspects() 报上来）：
  // 盒子变成方的，命中盒这才盖得住画出来的那个圆。
  const truthful = STAGE.buildElement(donut, {
    ...OPTIONS, wasmIds, wasmAspects: { ring: 'square' },
  });
  assert.strictEqual(truthful.placement.box.h, H * EG.PROGRESS_SQUARE_H / 100);
  assert.notStrictEqual(guessed.placement.box.h, truthful.placement.box.h);
});

test('wasmIds：未登记的形状连命中盒都不给（画面上看不见的东西不该点得中）', () => {
  // `hexagon` 不在 VEED NameEnum 里，注册表也没有 —— P7a 之后 `star` 有了，
  // 所以判据换成一个真正不存在的名字，而不是"还没实现的那一个"。
  const built = STAGE.buildElement(
    { kind: 'shape', id: 's2', shape: { shape: 'hexagon' } },
    { ...OPTIONS, wasmIds: new Set(['s2']) },
  );
  assert.strictEqual(built, null);
  // 反过来：P7a 登记的 outline 形状由 wasm 出像素，命中盒必须建得起来。
  const star = STAGE.buildElement(
    { kind: 'shape', id: 's3', shape: { shape: 'star' } },
    { ...OPTIONS, wasmIds: new Set(['s3']) },
  );
  assert.ok(star && star.placement.path === 'outline');
});

test('wasmIds 不碰 text / image 这两条路；模板贴纸自 P7b 起归 wasm', () => {
  const wasmIds = new Set(['t1', 'k2']);
  // 分派前的 wasmIds 命中只对 wasm 承担的元素有意义；这里故意塞了 text 的 id
  // 来钉住"命中判据 + 认领判据"两道门都在：planOverlay 从不把 text 放进
  // rendered，所以这一步在真实接线里不会发生，但真发生了也不该画出一个空壳。
  const text = STAGE.buildElement({ kind: 'text', id: 't1', text: '嗨' }, OPTIONS);
  assert.ok(text.nodes.length, '不带 wasmIds 的 text 照旧自绘');
  const template = STAGE.buildElement(
    { kind: 'sticker', id: 'k2', sticker: { source: 'template' }, place: { w: 40 } },
    { ...OPTIONS, wasmIds },
  );
  // 模板贴纸归 wasm 之后 buildHitBoxOnly 对它走 boxPlacement，只出命中盒。
  const OVERLAY = require('./wasm-overlay.js');
  assert.deepStrictEqual(OVERLAY.WASM_KINDS, ['shape', 'sticker', 'visualizer', 'progress']);
  assert.ok(template);
  assert.strictEqual(template.nodes.length, 0, '归 wasm 的元素只留命中盒');
});

// P7b：sticker 是唯一**按 props 而不是按 kind** 认领的元素。三处孪生
// （Rust 的 push_element、wasm 的 host_rasterized_elements、这里）必须一致。
test('claimsElement：模板贴纸归 wasm，资产贴纸留给 Konva', () => {
  const OVERLAY = require('./wasm-overlay.js');
  const claims = (element) => OVERLAY.claimsElement(element);
  assert.ok(claims({ kind: 'sticker', sticker: { source: 'template', templateId: 'heart' } }));
  assert.ok(!claims({ kind: 'sticker', sticker: { source: 'asset', path: 'media/a.png' } }));
  // props 缺席 = 契约被绕过，按"画不了"处理，不猜。
  assert.ok(!claims({ kind: 'sticker' }));
  // 其余 kind 仍然只看白名单。
  assert.ok(claims({ kind: 'shape' }) && claims({ kind: 'progress' }));
  assert.ok(!claims({ kind: 'text' }) && !claims({ kind: 'image' }) && !claims({ kind: 'video' }));
});

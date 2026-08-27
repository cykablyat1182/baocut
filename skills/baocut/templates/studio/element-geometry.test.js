const test = require('node:test');
const assert = require('node:assert');
const EG = require('./element-geometry.js');

// 画布：960×540（短边 540 = REFERENCE_SHORT_EDGE，radius 换算恒等，便于对拍）。
const W = 960;
const H = 540;
// 测量器：每个字 10px 宽，行内断行判据因此可以手算。
const measure = () => 10;

test('visibleElements 按轨道序 × 轨内序过滤半开区间与 hidden', () => {
  const tracks = [
    { id: 'overlay', elements: [
      { id: 'el-1', kind: 'text', text: 'a', start: 0, end: 5 },
      { id: 'el-2', kind: 'text', text: 'b', start: 5, end: 10 },
      { id: 'el-3', kind: 'text', text: 'c', start: 0, end: 10, hidden: true },
      { id: 'el-4', kind: 'video', srcId: 'src-a', start: 0, end: 10 },
      { id: 'el-5', kind: 'audio', srcId: 'src-b', start: 0, end: 10 },
    ] },
    { id: 'hidden-track', hidden: true, elements: [{ id: 'el-6', kind: 'text', text: 'd', start: 0, end: 10 }] },
    { id: 'wm', elements: [{ id: 'el-7', kind: 'text', role: 'watermark', text: 'w', start: 0, end: 12 }] },
  ];
  assert.deepStrictEqual(EG.visibleElements(tracks, 0, 12).map((el) => el.id), ['el-1', 'el-7']);
  // 区间是 [start, end)：5.0 属于第二条，不属于第一条。
  assert.deepStrictEqual(EG.visibleElements(tracks, 5, 12).map((el) => el.id), ['el-2', 'el-7']);
  assert.deepStrictEqual(EG.visibleElements(tracks, 11, 12).map((el) => el.id), ['el-7']);
  assert.deepStrictEqual(EG.visibleElements(tracks, 12, 12).map((el) => el.id), []);
  // trackId 随元素带出，供面板/时间轴显示归属。
  assert.strictEqual(EG.visibleElements(tracks, 0, 12)[1].trackId, 'wm');
});

test('visibleElements 用 duration 兜 end 缺失，并丢掉非法窗口', () => {
  const tracks = [{ id: 'wm', elements: [
    { id: 'el-1', kind: 'text', text: 'w', start: 0 },
    { id: 'el-2', kind: 'text', text: 'x', start: 4, end: 4 },
    { id: 'el-3', kind: 'text', text: 'y' },
  ] }];
  assert.deepStrictEqual(EG.visibleElements(tracks, 7.5, 8).map((el) => el.id), ['el-1']);
  assert.strictEqual(EG.visibleElements(tracks, 0, 8)[0].end, 8);
});

test('textWrapWidth：place.w 是画布宽百分比，缺席退回 90%', () => {
  assert.strictEqual(EG.textWrapWidth({ place: { w: 50 } }, W), 480);
  assert.strictEqual(EG.textWrapWidth({ place: {} }, W), 864);
  assert.strictEqual(EG.textWrapWidth({}, W), 864);
  // 下限 1%（Rust 的 width.max(1.0)）。
  assert.strictEqual(EG.textWrapWidth({ place: { w: 0 } }, W), 9.6);
});

test('textWrap 逐字断行、丢行首空白、retain 空行', () => {
  const wrapped = EG.textWrap('abcde', 30, measure);
  assert.deepStrictEqual(wrapped.lines.map((line) => line.text), ['abc', 'de']);
  assert.strictEqual(wrapped.width, 30);
  // 行首空白不进新行（Rust 的 `line.width == 0 && piece.trim().is_empty()` 分支）；
  // 行尾空白照旧留在上一行并计入行宽 —— 这是烧录端 layout_text 的现状，字幕那条
  // 路径（canvas-stage 的 wrapRuns）才会把行尾空白弹掉，两者有意不同。
  assert.deepStrictEqual(EG.textWrap('ab cd', 20, measure).lines.map((line) => line.text), ['ab ', 'cd']);
  // 显式换行保留，空行被 retain 掉。
  assert.deepStrictEqual(EG.textWrap('a\n\nb', 100, measure).lines.map((line) => line.text), ['a', 'b']);
  // 空文本仍给一行零宽，调用方不必分情况。
  assert.deepStrictEqual(EG.textWrap('', 100, measure).lines, [{ text: '', width: 0 }]);
});

// 投影里的 place / tile 是 serde 直出：Option 字段缺席时序列化成 **null**，不是省略。
// `Number(null) === 0` 会把缺席读成 0（换行宽 1%、锚点贴边、缩放归零），而烧录端
// as_f64() 对 null 是 None → 走缺省。这一组把两端钉在一起。
test('null 值的 place / tile 字段等于缺席，不等于 0', () => {
  const projected = {
    id: 'el-1',
    kind: 'text',
    place: { x: 50, y: 40, w: null, scale: null, scaleY: null, rot: null, opacity: null, radius: null },
    tile: { on: true, angle: null, gapX: null, gapY: null, stagger: null },
  };
  assert.strictEqual(EG.textWrapWidth(projected, W), W * 0.9);
  assert.deepStrictEqual(EG.transformOf(projected),
    { scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipX: 1, flipY: 1 });
  const stamps = EG.textStamps(projected, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  assert.strictEqual(stamps[0].rotation, -30);
  const stepY = 60 + H * 10 / 100;
  const anchorY = H * 40 / 100;
  const row1 = stamps.filter((stamp) => Math.abs(stamp.y - (anchorY + stepY)) < 1e-9).map((stamp) => stamp.x);
  assert.ok(Math.min(...row1.map((x) => Math.abs(x - (480 + (200 + W * 8 / 100) / 2)))) < 1e-9);
  const image = EG.imagePlacement(
    { kind: 'image', place: { x: null, y: null, w: null, radius: null } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.strictEqual(image.boxWidth, Math.round(W * 0.34));
  assert.strictEqual(image.centerX, W / 2);
  assert.strictEqual(image.centerY, H / 2);
  assert.strictEqual(image.radius, 0);
  assert.deepStrictEqual(EG.movedPlace(projected, { dx: 0, dy: 0, frameWidth: W, frameHeight: H }),
    { x: 50, y: 40 });
});

test('transformOf：scaleY 缺席跟随 scale，opacity 钳制到 0…1', () => {
  assert.deepStrictEqual(EG.transformOf({ place: { scale: 1.5 } }), {
    scaleX: 1.5, scaleY: 1.5, rotation: 0, opacity: 1, flipX: 1, flipY: 1,
  });
  assert.deepStrictEqual(EG.transformOf({ place: { scale: 2, scaleY: 0.5, rot: -12, opacity: 0.4 } }), {
    scaleX: 2, scaleY: 0.5, rotation: -12, opacity: 0.4, flipX: 1, flipY: 1,
  });
  assert.strictEqual(EG.transformOf({ place: { opacity: 3 } }).opacity, 1);
  assert.strictEqual(EG.transformOf({}).scaleX, 1);
});

// 镜像是**独立通道**（Rust `Place::flip_signs`）：不预乘进 scaleX/scaleY，因为烧录端
// 的平铺点阵用的是未镜像的 uniform_scale，折进去整张点阵会跟着翻。
test('transformOf：flipX/flipY 是 ±1 独立通道，只有 true 才翻', () => {
  assert.deepStrictEqual(EG.transformOf({ place: { flipX: true } }), {
    scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipX: -1, flipY: 1,
  });
  assert.deepStrictEqual(EG.transformOf({ place: { flipY: true } }), {
    scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipX: 1, flipY: -1,
  });
  // 镜像不改缩放这一维：scale 仍然原样，两者在画节点时才相乘。
  const both = EG.transformOf({ place: { scale: 2, scaleY: 0.5, flipX: true, flipY: true } });
  assert.deepStrictEqual(both, {
    scaleX: 2, scaleY: 0.5, rotation: 0, opacity: 1, flipX: -1, flipY: -1,
  });
  // serde 直出的 null / 缺席 / false 都不翻（Rust `flip_x.unwrap_or(false)`）。
  [null, undefined, false, 0, 'true'].forEach((value) => {
    assert.strictEqual(EG.transformOf({ place: { flipX: value } }).flipX, 1);
  });
  // 图片平铺的点阵仍按未镜像的 scaleX 铺：镜像不该改变印章之间的间距/位置。
  const options = { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 };
  const plain = EG.imagePlacement(
    { kind: 'image', place: { w: 10 }, tile: { on: true, angle: 0 } }, options,
  );
  const flipped = EG.imagePlacement(
    { kind: 'image', place: { w: 10, flipX: true }, tile: { on: true, angle: 0 } }, options,
  );
  assert.deepStrictEqual(
    flipped.stamps.map((stamp) => [stamp.x, stamp.y]),
    plain.stamps.map((stamp) => [stamp.x, stamp.y]),
  );
  assert.strictEqual(flipped.flipX, -1);
});

test('textPlacement：缺省 place 居中，锚点换算出字形顶边', () => {
  const placement = EG.textPlacement({}, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.deepStrictEqual(placement.stamps, [{ x: 480, y: 270, rotation: 0 }]);
  // center：含 padding 的盒子（60 + 20）居中 → 顶边 -40，再进 padV → -30。
  assert.strictEqual(placement.topOffset, -30);
  assert.strictEqual(placement.verticalAlign, 'center');
  const top = EG.textPlacement({ verticalAlign: 'top' }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.strictEqual(top.topOffset, 10);
  const bottom = EG.textPlacement({ verticalAlign: 'bottom' }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60, padV: 10,
  });
  assert.strictEqual(bottom.topOffset, -70);
  // 非白名单值一律视为缺席（与内核 verticalAlignValue 同纪律）。
  assert.strictEqual(EG.verticalAlignValue('Top'), null);
});

test('textStamps 平铺：step、行列数、奇数行错开半步、角度缺省 -30', () => {
  const element = { place: { x: 50, y: 50 }, tile: { on: true } };
  const stamps = EG.textStamps(element, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  const stepX = 200 + W * 8 / 100;    // 276.8
  const stepY = 60 + H * 10 / 100;    // 114
  const columns = Math.ceil(W / stepX) + 3;   // 4 + 3 = 7
  const rows = Math.ceil(H / stepY) + 3;      // 5 + 3 = 8
  assert.strictEqual(stamps.length, (columns * 2 + 1) * (rows * 2 + 1));
  const anchor = stamps.find((stamp) => stamp.y === 270);
  assert.ok(anchor);
  assert.strictEqual(stamps[0].rotation, -30);
  // 锚点所在行（row 0）不错开；相邻行错开半步。
  const row0 = stamps.filter((stamp) => Math.abs(stamp.y - 270) < 1e-9).map((stamp) => stamp.x);
  const row1 = stamps.filter((stamp) => Math.abs(stamp.y - (270 + stepY)) < 1e-9).map((stamp) => stamp.x);
  assert.ok(row0.includes(480));
  assert.ok(Math.min(...row1.map((x) => Math.abs(x - (480 + stepX / 2)))) < 1e-9);
  // stagger 关掉后两行对齐。
  const straight = EG.textStamps({ place: {}, tile: { on: true, stagger: false } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  });
  const straightRow1 = straight.filter((stamp) => Math.abs(stamp.y - (270 + stepY)) < 1e-9);
  assert.ok(straightRow1.some((stamp) => Math.abs(stamp.x - 480) < 1e-9));
  // tile.on 为假 = 整对象不生效（schema 也不落盘）。
  assert.strictEqual(EG.textStamps({ place: {}, tile: { on: false } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  }).length, 1);
  // rot 与 tile.angle 相加。
  assert.strictEqual(EG.textStamps({ place: { rot: 15 }, tile: { on: true, angle: -45 } }, {
    frameWidth: W, frameHeight: H, contentWidth: 200, contentHeight: 60,
  })[0].rotation, -30);
});

// 平铺时"这个对象在哪"必须仍是 place.x/y：文本网格从 -rows/-cols 起铺、图片网格以
// 画布中心为原点，拿第一枚印章当锚点会把命中面和选中框甩到画面外（水印因此点不中）。
test('平铺元素的锚点是 place.x/y，不是第一枚印章', () => {
  const watermark = { kind: 'text', role: 'watermark', place: { x: 85, y: 10, w: 22 }, tile: { on: true } };
  const placement = EG.textPlacement(watermark, {
    frameWidth: W, frameHeight: H, contentWidth: 100, contentHeight: 24, padV: 4,
  });
  assert.deepStrictEqual(placement.anchor, { x: W * 0.85, y: H * 0.10, rotation: 0 });
  // 第一枚印章在画面外（网格左上角），锚点不受它影响。
  assert.ok(placement.stamps[0].x < 0 && placement.stamps[0].y < 0);
  // 锚点不吃 tile.angle（那是印章花纹角度），但吃 place.rot。
  assert.strictEqual(EG.textPlacement({ ...watermark, place: { ...watermark.place, rot: 12 } }, {
    frameWidth: W, frameHeight: H, contentWidth: 100, contentHeight: 24, padV: 4,
  }).anchor.rotation, 12);
  const image = EG.imagePlacement(
    { kind: 'image', place: { x: 85, y: 10, w: 10 }, tile: { on: true } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.deepStrictEqual(image.anchor, { x: W * 0.85, y: H * 0.10, rotation: 0 });
  assert.deepStrictEqual(EG.anchorPoint({ place: { x: 25, y: 75 } }, W, H), { x: W * 0.25, y: H * 0.75 });
});

test('imagePlacement pip：宽按 w%、高按自然比例、中心按 x/y%', () => {
  const placement = EG.imagePlacement(
    { kind: 'image', place: { x: 71, y: 29, w: 34, radius: 28 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 800, naturalHeight: 400 },
  );
  assert.strictEqual(placement.boxWidth, Math.round(W * 0.34));       // 326
  assert.strictEqual(placement.boxHeight, Math.round(W * 0.34 / 2));  // 163
  assert.ok(Math.abs(placement.centerX - W * 0.71) < 1e-9);
  assert.ok(Math.abs(placement.centerY - H * 0.29) < 1e-9);
  // 短边正好 540 时 radius 是恒等换算。
  assert.strictEqual(placement.radius, 28);
  assert.strictEqual(placement.mode, 'pip');
  assert.strictEqual(placement.fit, 'cover');
  assert.strictEqual(placement.stamps.length, 1);
  assert.deepStrictEqual(placement.stamps[0], placement.anchor);
  // w 缺席退回 34%。
  assert.strictEqual(
    EG.imagePlacement({ kind: 'image', place: {} }, { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 }).boxWidth,
    Math.round(W * 0.34),
  );
});

test('imagePlacement radius 随短边缩放，fullscreen 铺满且不吃 radius', () => {
  const half = EG.imagePlacement(
    { kind: 'image', place: { radius: 28 } },
    { frameWidth: 480, frameHeight: 270, naturalWidth: 100, naturalHeight: 100 },
  );
  assert.ok(Math.abs(half.radius - 28 * 270 / 540) < 1e-9);
  const full = EG.imagePlacement(
    { kind: 'image', mode: 'fullscreen', fit: 'contain', bg: 'black', place: { radius: 28 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 400 },
  );
  assert.strictEqual(full.boxWidth, W);
  assert.strictEqual(full.boxHeight, H);
  assert.strictEqual(full.centerX, W / 2);
  assert.strictEqual(full.centerY, H / 2);
  assert.strictEqual(full.radius, 0);
  assert.strictEqual(full.fullscreen, true);
  assert.strictEqual(full.background, 'black');
});

test('imagePlacement 平铺：fullscreen 也退回 pip 盒，点阵绕画布中心旋转', () => {
  const tiled = EG.imagePlacement(
    { kind: 'image', mode: 'fullscreen', place: { w: 10 }, tile: { on: true, angle: 0, gapX: 100, gapY: 100 } },
    { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 },
  );
  // 平铺时即便 mode 是 fullscreen 也按 pip 盒盖印（render_media_element 的
  // `(true, Fullscreen)` 分支）。
  assert.strictEqual(tiled.fullscreen, false);
  assert.strictEqual(tiled.boxWidth, 96);
  assert.strictEqual(tiled.tiled, true);
  // angle 0 时点阵不旋转：同一行的印章 y 相同、x 间距恰好一个 step（点阵原点在
  // 画布中心加上 -对角线/2 的起点偏移，所以不必落在正中）。
  const stepX = 96 + W;      // gapX 100% → 960
  const row = tiled.stamps.filter((stamp) => Math.abs(stamp.y - tiled.stamps[0].y) < 1e-9)
    .map((stamp) => stamp.x)
    .sort((left, right) => left - right);
  assert.ok(row.length >= 2);
  assert.ok(Math.abs(row[1] - row[0] - stepX) < 1e-9);
  // 未旋转时印章行仍平行于画面：第一行的 y 就是点阵起点。
  assert.ok(Math.abs(tiled.stamps[0].y - (H / 2 - Math.hypot(W, H) / 2)) < 1e-9);
  // 锚点仍是 place.x/y（拖动写它，选中框画它）。
  assert.deepStrictEqual(tiled.anchor, { x: W * 0.5, y: H * 0.5, rotation: 0 });
});

test('tileStampPoints：gap 有 2% 下限，stagger 只错开奇数行', () => {
  const points = EG.tileStampPoints(400, 300, 40, 30, { on: true, gapX: 0, gapY: 0 });
  const stepX = 40 + 400 * 2 / 100;   // gap 下限 2% → 48
  const stepY = 30 + 300 * 2 / 100;   // → 36
  const first = points[0];
  const diagonal = Math.hypot(400, 300);
  assert.ok(Math.abs(first.y + diagonal / 2) < 1e-9);
  assert.ok(Math.abs(first.x - (-diagonal / 2 - stepX)) < 1e-9);
  const row1 = points.filter((point) => Math.abs(point.y - (-diagonal / 2 + stepY)) < 1e-9);
  assert.ok(Math.abs(row1[0].x - (-diagonal / 2 - stepX + stepX / 2)) < 1e-9);
});

test('movedPlace：位移换成一位小数百分比并钳制在 2…98', () => {
  const element = { place: { x: 50, y: 40 } };
  assert.deepStrictEqual(EG.movedPlace(element, { dx: 96, dy: 54, frameWidth: W, frameHeight: H }),
    { x: 60, y: 50 });
  assert.deepStrictEqual(EG.movedPlace(element, { dx: -W, dy: -H, frameWidth: W, frameHeight: H }),
    { x: 2, y: 2 });
  assert.deepStrictEqual(EG.movedPlace(element, { dx: W, dy: H, frameWidth: W, frameHeight: H }),
    { x: 98, y: 98 });
  // 缺省锚点是 50/50。
  assert.deepStrictEqual(EG.movedPlace({}, { dx: 0, dy: 0, frameWidth: W, frameHeight: H }),
    { x: 50, y: 50 });
});

// ---------- 元素盒（core `bcut-timeline/src/geometry.rs` 孪生） ----------
// 下面这批数字与 `geometry.rs` 的表驱动测试
// `the_height_table_is_the_single_source_of_truth` 是**同一批**：改这张表就是改契约，
// 两边必须同任务一起改。
test('elementHeight 逐行对照 ADR-E01 的高度表', () => {
  const FH = 1080;
  const cases = [
    // [kind, geometry, width, scale, expected]
    ['shape', { shape: {} }, 400, 1, 400],                          // h 缺省 = 正方
    ['shape', { shape: { h: 25 } }, 400, 2, 1080 * 0.25 * 2],       // h 显式：帧高 % × scale
    ['sticker', { sticker: { templateId: 'box' } }, 400, 1, 400 * 0.62],
    ['sticker', { sticker: { source: 'asset' } }, 400, 1, 400],     // 非 box 模板 = 正方
    ['visualizer', {}, 400, 1, 1080 * 0.20],                        // 横条类缺省
    ['visualizer', { aspect: 'square' }, 400, 1, 1080 * 0.30],
    ['progress', {}, 400, 1, 1080 * 0.05],
    ['progress', { aspect: 'square' }, 400, 1, 1080 * 0.30],
    ['progress', { aspect: 'frame' }, 400, 1, 1080],
    ['image', {}, 400, 1, 400],                                     // 其余 kind = 正方
    ['text', {}, 400, 1, 400],
  ];
  cases.forEach(([kind, geometry, width, scale, expected]) => {
    assert.strictEqual(EG.elementHeight(kind, geometry, FH, width, scale), expected, kind);
  });
  // 高度公式吃的是 `place.scale`，不是 scaleY —— 与 static_box 同一个 scale。
  assert.strictEqual(EG.elementHeight('visualizer', {}, FH, 400, 2), 1080 * 0.20 * 2);
  // 废弃的 waveform 子类型（原 width*0.28）不该在任何分支里复活。
  assert.strictEqual(
    EG.elementHeight('sticker', { sticker: { type: 'waveform' } }, FH, 400, 1), 400,
  );
});

test('defaultPlace：横条贴底、圆形正方、border 铺满', () => {
  assert.deepStrictEqual(EG.defaultPlace('visualizer', null), { w: 100, h: 20, y: 85 });
  assert.deepStrictEqual(EG.defaultPlace('visualizer', 'square'), { w: 30, h: 30, y: 50 });
  assert.deepStrictEqual(EG.defaultPlace('progress', null), { w: 80, h: 5, y: 50 });
  assert.deepStrictEqual(EG.defaultPlace('progress', 'square'), { w: 30, h: 30, y: 50 });
  assert.deepStrictEqual(EG.defaultPlace('progress', 'frame'), { w: 100, h: 100, y: 50 });
  // 未知 aspect 退回各自的横条类兜底（Rust 的 `unwrap_or(Free/Bar)`）。
  assert.deepStrictEqual(EG.defaultPlace('visualizer', 'nope'), { w: 100, h: 20, y: 85 });
  // 其余 kind：w=20、正方、居中。
  assert.deepStrictEqual(EG.defaultPlace('shape', null), { w: 20, h: null, y: 50 });
});

test('elementWidth / staticBox：w ?? 20，scale 同时进宽高', () => {
  const frame = { frameWidth: 1920, frameHeight: 1080 };
  assert.strictEqual(EG.elementWidth({}, 1920, 1), 1920 * 20 / 100);
  assert.strictEqual(EG.elementWidth({ w: 50 }, 1920, 2), 1920 * 0.5 * 2);
  // 缺省 place：正方、居中。
  const box = EG.staticBox('shape', { shape: {} }, null, frame);
  assert.strictEqual(box.w, 1920 * 20 / 100);
  assert.strictEqual(box.h, box.w);
  assert.strictEqual(box.x, 1920 / 2 - box.w / 2);
  assert.strictEqual(box.y, 1080 / 2 - box.h / 2);
  // scale 烘进盒子尺寸（所以画节点时不能再乘一次）。
  const scaled = EG.staticBox('shape', { shape: {} }, { w: 50, scale: 2 }, frame);
  assert.strictEqual(scaled.w, 1920 * 0.5 * 2);
  assert.strictEqual(scaled.h, scaled.w);
  // null 值的 place 字段 = 缺席，不等于 0。
  const nulled = EG.staticBox('shape', { shape: {} }, { x: null, y: null, w: null, scale: null }, frame);
  assert.deepStrictEqual([nulled.w, nulled.centerX, nulled.centerY], [384, 960, 540]);
});

test('staticBox：visualizer 横条贴底，缺省 y 走配方默认表', () => {
  const box = EG.staticBox('visualizer', {}, null, { frameWidth: 1920, frameHeight: 1080 });
  assert.strictEqual(box.h, 1080 * 0.2);
  assert.strictEqual(box.y, 1080 * 0.85 - box.h / 2);
  // 显式 place.y 覆盖默认表。
  const moved = EG.staticBox('visualizer', {}, { y: 50 }, { frameWidth: 1920, frameHeight: 1080 });
  assert.strictEqual(moved.centerY, 540);
});

test('progressAt：钳制在 0…1，退化区间读 0', () => {
  assert.strictEqual(EG.progressAt(2, 2, 6), 0);
  assert.strictEqual(EG.progressAt(4, 2, 6), 0.5);
  assert.strictEqual(EG.progressAt(9, 2, 6), 1);
  assert.strictEqual(EG.progressAt(-1, 2, 6), 0);
  assert.strictEqual(EG.progressAt(4, 6, 6), 0);
});

// ---------- 形状（`element_draw.rs::push_shape_ops` 孪生） ----------
test('shapeRecipe：目录是 core/presets/builtin/shape/*.json 的镜像，params 是封闭词汇表', () => {
  // P7a：VEED NameEnum 全集 23 + BaoCut 自有的 line，order 是 VEED 网格序。
  const ids = Object.keys(EG.SHAPE_RECIPES);
  assert.strictEqual(ids.length, 24);
  assert.deepStrictEqual(
    ids.slice().sort((a, b) => EG.SHAPE_RECIPES[a].order - EG.SHAPE_RECIPES[b].order),
    ['rect', 'ellipse', 'triangle', 'rombus', 'pentagon', 'hex', 'octagon', 'squig', 'squig2',
      'line', 'arrow', 'tick', 'tick2', 'chevron', 'chevron2', 'cross2', 'cross', 'love2',
      'love', 'diamond', 'star', 'sharp', 'star2', 'sharp2'],
  );
  // 20 份 outline 的像素由 wasm overlay 出，这张表只登记 id / order / path / params。
  assert.strictEqual(ids.filter((id) => EG.SHAPE_RECIPES[id].path === 'outline').length, 20);
  assert.deepStrictEqual(EG.shapeRecipe('rect').params, ['fill', 'stroke', 'strokeWidth', 'cornerRadius']);
  assert.deepStrictEqual(EG.shapeRecipe('ellipse').params, ['fill', 'stroke', 'strokeWidth']);
  assert.deepStrictEqual(EG.shapeRecipe('line').params, ['stroke', 'strokeWidth', 'endpoints']);
  assert.deepStrictEqual(EG.shapeRecipe('arrow').params, ['stroke', 'strokeWidth', 'endpoints', 'head']);
  assert.deepStrictEqual(EG.shapeRecipe('star').params, ['fill', 'stroke', 'strokeWidth']);
  assert.strictEqual(EG.shapeRecipe('line').defaultHead, 'none');
  assert.strictEqual(EG.shapeRecipe('arrow').defaultHead, 'arrow');
  // 星形现在**在**目录里，于是命中盒也建得起来（P7a 之前这里是 null）。
  assert.ok(
    EG.shapePlacement({ kind: 'shape', shape: { shape: 'star' } }, { frameWidth: W, frameHeight: H }),
  );
  // 注册表里没有 = preset-unknown：不画，而不是画成别的形状。
  assert.strictEqual(EG.shapeRecipe('hexagon'), null);
  assert.strictEqual(EG.shapeRecipe('toString'), null);
  assert.strictEqual(
    EG.shapePlacement({ kind: 'shape', shape: { shape: 'hexagon' } }, { frameWidth: W, frameHeight: H }),
    null,
  );
  // 没有 shape props 的 shape 元素同样不画。
  assert.strictEqual(
    EG.shapePlacement({ kind: 'shape' }, { frameWidth: W, frameHeight: H }), null,
  );
});

test('shapeStrokeWidth / shapeCornerRadius 随画布短边换算（口径同 element_draw.rs）', () => {
  // 缺省 2（schema 的 SHAPE_STROKE_WIDTH_DEFAULT），参考短边 540 上是恒等换算。
  assert.strictEqual(EG.shapeStrokeWidth({}, 540), 2);
  assert.strictEqual(EG.shapeStrokeWidth({}, 1080), 4);
  assert.strictEqual(EG.shapeStrokeWidth({ strokeWidth: 6 }, 270), 3);
  const box = { w: 400, h: 200 };
  // 半径夹在半边长以内：相邻两角不会互相吃掉。
  assert.deepStrictEqual(EG.shapeCornerRadius({ cornerRadius: [999, 999, 999, 999] }, box, 540),
    [100, 100, 100, 100]);
  // 跟画布短边走：4K 上的 12 不会退化成几乎直角。
  assert.deepStrictEqual(EG.shapeCornerRadius({ cornerRadius: [12, 12, 12, 12] }, box, 1080),
    [24, 24, 24, 24]);
  // 四角独立，顺序是 [左上, 右上, 右下, 左下]（core / VEED / Konva 同序）。
  assert.deepStrictEqual(EG.shapeCornerRadius({ cornerRadius: [0, 20, 0, 20] }, box, 540),
    [0, 20, 0, 20]);
  // 缺席 = 直角；长度不对的数组一律当缺席（schema 只允许四元组）。
  assert.deepStrictEqual(EG.shapeCornerRadius({}, box, 540), [0, 0, 0, 0]);
  assert.deepStrictEqual(EG.shapeCornerRadius({ cornerRadius: [8, 8] }, box, 540), [0, 0, 0, 0]);
});

test('shapePlacement rect：盒子、圆角、fill/stroke 四元组', () => {
  const element = {
    kind: 'shape',
    place: { x: 50, y: 50, w: 40 },
    shape: { shape: 'rect', fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, cornerRadius: [12, 12, 12, 12] },
  };
  const placement = EG.shapePlacement(element, { frameWidth: W, frameHeight: H });
  assert.strictEqual(placement.path, 'rect');
  assert.strictEqual(placement.box.w, W * 0.4);          // 384
  assert.strictEqual(placement.box.h, placement.box.w);  // h 缺省 = 正方
  assert.deepStrictEqual([placement.centerX, placement.centerY], [W / 2, H / 2]);
  assert.strictEqual(placement.fill, '#ff0000');
  assert.strictEqual(placement.stroke, '#00ff00');
  assert.strictEqual(placement.strokeWidth, 4);          // 短边 540 = 恒等换算
  assert.deepStrictEqual(placement.cornerRadius, [12, 12, 12, 12]);
  // place.scale 已经烘进盒子：节点上的缩放只剩镜像符号，别再乘一次。
  const scaled = EG.shapePlacement(
    { ...element, place: { ...element.place, scale: 2 } }, { frameWidth: W, frameHeight: H },
  );
  assert.strictEqual(scaled.box.w, W * 0.4 * 2);
  assert.strictEqual(scaled.scaleX, 1);
  const flipped = EG.shapePlacement(
    { ...element, place: { ...element.place, flipX: true } }, { frameWidth: W, frameHeight: H },
  );
  assert.deepStrictEqual([flipped.scaleX, flipped.scaleY], [-1, 1]);
  // 显式 h 走帧高 %。
  const tall = EG.shapePlacement(
    { ...element, shape: { ...element.shape, h: 25 } }, { frameWidth: W, frameHeight: H },
  );
  assert.strictEqual(tall.box.h, H * 0.25);
});

test('shapePlacement ellipse：配方没声明 cornerRadius，就不读它', () => {
  const placement = EG.shapePlacement(
    { kind: 'shape', shape: { shape: 'ellipse', fill: '#00ff00', cornerRadius: [40, 40, 40, 40] } },
    { frameWidth: W, frameHeight: H },
  );
  assert.strictEqual(placement.path, 'ellipse');
  assert.deepStrictEqual(placement.cornerRadius, [0, 0, 0, 0]);
  assert.strictEqual(placement.fill, '#00ff00');
});

test('shapePlacement line / arrow：端点、颜色兜底与箭头端头', () => {
  const base = { kind: 'shape', place: { x: 50, y: 50, w: 40 } };
  const line = EG.shapePlacement(
    { ...base, shape: { shape: 'line', stroke: '#ffffff' } }, { frameWidth: W, frameHeight: H },
  );
  // 端点缺省是盒子的水平中线（0,50 → 100,50）。
  assert.deepStrictEqual(EG.shapeEndpoints({}), [0, 50, 100, 50]);
  assert.deepStrictEqual(line.start, { x: line.box.x, y: line.box.y + line.box.h / 2 });
  assert.deepStrictEqual(line.end, { x: line.box.x + line.box.w, y: line.box.y + line.box.h / 2 });
  assert.strictEqual(line.strokeColor, '#ffffff');
  // 线段类没有填充：配方的 params 里没有 fill，所以 props.fill **完全不被读**——
  // 烧录端的 `stroke.or(fill)` 兜底链里那个 `fill` 同样是被 `supports(Fill)` 门过的
  // None，于是也退到白色。这条对当前四个配方是死路径，留着是为将来同时支持
  // fill + stroke 的形状；两端一起留，别在这边"顺手优化掉"。
  const filled = EG.shapePlacement(
    { ...base, shape: { shape: 'line', fill: '#123456' } }, { frameWidth: W, frameHeight: H },
  );
  assert.strictEqual(filled.fill, null);
  assert.strictEqual(filled.strokeColor, '#ffffff');
  // 两个都没有 → 白色。
  assert.strictEqual(
    EG.shapePlacement({ ...base, shape: { shape: 'line' } }, { frameWidth: W, frameHeight: H }).strokeColor,
    '#ffffff',
  );
  // line 的配方不支持 head：即便文档写了 arrow 也恒用配方缺省 none。
  assert.strictEqual(
    EG.shapePlacement({ ...base, shape: { shape: 'line', head: 'arrow' } }, { frameWidth: W, frameHeight: H }).headPoints,
    null,
  );
  // arrow 缺省带端头；head:"none" 关掉；非法值退回配方缺省。
  const arrow = EG.shapePlacement(
    { ...base, shape: { shape: 'arrow', stroke: '#ffffff' } }, { frameWidth: W, frameHeight: H },
  );
  assert.strictEqual(arrow.head, 'arrow');
  assert.strictEqual(arrow.headPoints.length, 3);
  assert.strictEqual(
    EG.shapePlacement({ ...base, shape: { shape: 'arrow', head: 'none' } }, { frameWidth: W, frameHeight: H }).headPoints,
    null,
  );
  assert.strictEqual(
    EG.shapePlacement({ ...base, shape: { shape: 'arrow', head: 'wat' } }, { frameWidth: W, frameHeight: H }).head,
    'arrow',
  );
  // 自定义端点按元素盒内 % 换算。
  const diagonal = EG.shapePlacement(
    { ...base, shape: { shape: 'line', x1: 0, y1: 0, x2: 100, y2: 100 } },
    { frameWidth: W, frameHeight: H },
  );
  assert.deepStrictEqual(diagonal.start, { x: diagonal.box.x, y: diagonal.box.y });
  assert.deepStrictEqual(diagonal.end,
    { x: diagonal.box.x + diagonal.box.w, y: diagonal.box.y + diagonal.box.h });
});

test('arrowHeadPoints：以线段方向为轴的等腰三角形，尺寸跟随描边宽度', () => {
  const points = EG.arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 5);
  const head = 5 * 4;   // min(strokeWidth * 4, length)
  assert.deepStrictEqual(points, [
    { x: 100, y: 0 },
    { x: 100 - head, y: head / 2 },
    { x: 100 - head, y: -head / 2 },
  ]);
  // 端头不长过线段本身。
  assert.strictEqual(EG.arrowHeadPoints({ x: 0, y: 0 }, { x: 4, y: 0 }, 5)[1].x, 0);
  // 退化输入不画端头。
  assert.strictEqual(EG.arrowHeadPoints({ x: 0, y: 0 }, { x: 0, y: 0 }, 5), null);
  assert.strictEqual(EG.arrowHeadPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0), null);
});

// ---------- 白名单 ----------
test('visibleElements 放行 core 0.2 的新 kind，未知 kind 不再落进文本分支', () => {
  assert.deepStrictEqual([...EG.RENDERABLE_KINDS],
    ['text', 'image', 'shape', 'sticker', 'visualizer', 'progress']);
  assert.strictEqual(EG.isRenderableKind('video'), false);
  assert.strictEqual(EG.isRenderableKind('audio'), false);
  assert.strictEqual(EG.isRenderableKind('motion'), false);
  const tracks = [{ id: 'overlay', elements: [
    { id: 'sh', kind: 'shape', shape: { shape: 'rect' }, start: 0, end: 5 },
    { id: 'st', kind: 'sticker', sticker: { source: 'asset' }, start: 0, end: 5 },
    { id: 'vz', kind: 'visualizer', visualizer: { style: 'formation' }, start: 0, end: 5 },
    { id: 'pg', kind: 'progress', progress: { style: 'normal' }, start: 0, end: 5 },
    { id: 'vd', kind: 'video', srcId: 'src-a', start: 0, end: 5 },
    { id: 'ad', kind: 'audio', srcId: 'src-b', start: 0, end: 5 },
    { id: 'xx', kind: 'motion', start: 0, end: 5 },
  ] }];
  assert.deepStrictEqual(EG.visibleElements(tracks, 1, 5).map((el) => el.id),
    ['sh', 'st', 'vz', 'pg']);
});

test('imagePlacement：sticker 走 core 的缺省宽 20%，B-roll 仍是 34%', () => {
  const options = { frameWidth: W, frameHeight: H, naturalWidth: 100, naturalHeight: 100 };
  assert.strictEqual(EG.imagePlacement({ kind: 'sticker', place: {} }, options).boxWidth,
    Math.round(W * 0.20));
  assert.strictEqual(EG.imagePlacement({ kind: 'image', place: {} }, options).boxWidth,
    Math.round(W * 0.34));
  // 显式 w 两边一致。
  assert.strictEqual(EG.imagePlacement({ kind: 'sticker', place: { w: 50 } }, options).boxWidth,
    Math.round(W * 0.5));
});

test('boxPlacement：模板贴纸的 box 比与 visualizer 的贴底落位', () => {
  const options = { frameWidth: W, frameHeight: H };
  const boxSticker = EG.boxPlacement(
    { kind: 'sticker', sticker: { source: 'template', templateId: 'box' }, place: { w: 40 } }, options,
  );
  assert.strictEqual(boxSticker.box.w, W * 0.4);
  assert.strictEqual(boxSticker.box.h, W * 0.4 * 0.62);
  const plain = EG.boxPlacement(
    { kind: 'sticker', sticker: { source: 'template', templateId: 'star' }, place: { w: 40 } }, options,
  );
  assert.strictEqual(plain.box.h, plain.box.w);
  // 缺 place 时**宽**走 DEFAULT_ELEMENT_W(20)、**高**走 aspect 默认表(20% 帧高)、
  // **y** 走默认表(85 贴底)——这正是 core `element_width` / `element_height` /
  // `static_box` 的三条不同来源，不是笔误：`default_place().w` 只在**新建**元素时
  // 填进 Place，读取期不参与宽度。真实文档里 visualizer 的 place.w 一定是写死的。
  const viz = EG.boxPlacement({ kind: 'visualizer', visualizer: { style: 'formation' } }, options);
  assert.deepStrictEqual([viz.box.w, viz.box.h], [W * 0.2, H * 0.2]);
  assert.strictEqual(viz.centerY, H * 0.85);
  assert.deepStrictEqual(viz.anchor, { x: W / 2, y: H * 0.85, rotation: 0 });
  // 新建时按默认表填了 w=100 就铺满画幅宽。
  const created = EG.boxPlacement(
    { kind: 'visualizer', visualizer: { style: 'formation' }, place: { w: EG.VISUALIZER_BAR_W } },
    options,
  );
  assert.deepStrictEqual([created.box.w, created.box.h], [W, H * 0.2]);
});

// ---------- 模板贴纸目录（P7c 选择器的数据源） ----------
test('stickerRecipe：目录是 core/presets/builtin/sticker/*.json 的镜像，且**不带几何**', () => {
  const rows = EG.stickerRecipes();
  assert.strictEqual(rows.length, 10);
  assert.deepStrictEqual(rows.map((r) => r.id), [
    'badge_check', 'badge_cross', 'star_burst', 'speech_bubble', 'heart',
    'bolt', 'pin', 'sparkle', 'arrow_curved', 'crown',
  ]);
  // order 是 0..9 的连号（选择器网格顺序 = manifest 的 order）
  assert.deepStrictEqual(rows.map((r) => r.order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  rows.forEach((row) => {
    assert.ok(row.name && row.name.trim().length, row.id + ' 没有显示名');
    assert.ok(row.layers >= 1, row.id + '.layers');
    assert.ok(row.colors.length >= 1 && row.colors.length <= row.layers * 2, row.id + '.colors');
    row.colors.forEach((c) => assert.match(c, /^#[0-9A-F]{6}$/, row.id + ' 的配色不是 #RRGGBB'));
    // 几何**不**进这张表：点列只在渲染端（wasm overlay 与导出同一份光栅器）。
    assert.strictEqual(row.segments, undefined, row.id + ' 不该带点列');
    assert.strictEqual(row.path, undefined, row.id + ' 不该带点列');
  });
  assert.strictEqual(new Set(rows.map((r) => r.name)).size, rows.length, '显示名重复');
  // 未登记的模板：返回 null，调用方不画（同 shapeRecipe / `preset-unknown`）。
  assert.strictEqual(EG.stickerRecipe('no-such-sticker'), null);
  assert.strictEqual(EG.stickerRecipe(undefined), null);
  // 历史上原型自带的两份动画模板不在注册表里，这张表也不该有它们。
  assert.strictEqual(EG.stickerRecipe('box'), null);
  assert.strictEqual(EG.stickerRecipe('arrow'), null);
});

test('stickerSource / stickerLoop：0.2 的 source 拼写，三个 loop 面值', () => {
  assert.strictEqual(EG.stickerSource({ source: 'template' }), 'template');
  // 更早的原型写 `type`：只读不写（同 shapeCornerRadius 对标量 radius 的待遇）
  assert.strictEqual(EG.stickerSource({ type: 'asset' }), 'asset');
  assert.strictEqual(EG.stickerSource({ source: 'template', type: 'asset' }), 'template');
  assert.strictEqual(EG.stickerSource(null), null);
  assert.deepStrictEqual(EG.STICKER_LOOPS.slice(), ['loop', 'once', 'hold']);
  assert.strictEqual(EG.stickerLoop(null), 'loop');
  assert.strictEqual(EG.stickerLoop({}), 'loop');
  assert.strictEqual(EG.stickerLoop({ loop: 'once' }), 'once');
  // 第四种面值不存在：读成缺省，而不是当成一种没实现的行为
  assert.strictEqual(EG.stickerLoop({ loop: 'pingpong' }), 'loop');
});

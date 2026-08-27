// BaoCut Subtitle Studio — 叠加元素几何内核（文本 / 图片 / 形状 / 贴纸 / 波形 / 进度）。
//
// 真相分两段，都不在本文件：
//   · **元素盒尺寸与落位**（`elementWidth` / `elementHeight` / `staticBox` /
//     `defaultPlace` / `progressAt` 与它们的全部常量）的唯一来源是
//     `core/crates/bcut-timeline/src/geometry.rs`（ADR-E01）。那边的高度表就是
//     契约本身——舞台选中框、命中框与导出像素必须画在同一个盒子里——所以本文件
//     逐条镜像它，函数名与常量名刻意与 Rust 侧同名，好让漂移一 grep 就看得见。
//   · **绘制与摆放**（文本排版、图片平铺、形状指令、镜像）的真相是烧录端
//     `apps/cli/src/cmd/studio_export/render_plan.rs`（`render_text_element` /
//     `render_media_element`）、`element_draw.rs`（`element_transform` /
//     `push_shape_ops`）与 `raster.rs::tile_stamp_points`。
// 缺省值也逐个对齐（缺省不一致 = 预览与成片错位）。
// 无 React / Konva 依赖：画布层、单测与将来的导出预览消费同一份决策。
//
// 记三条容易踩的不对称（都是烧录端现状，不是笔误）：
//   0. `place.scale` 对**元素盒类**（shape / sticker 模板 / visualizer / progress）
//      已经烘进盒子尺寸（`elementWidth`/`elementHeight` 都乘了 scale），节点上不能
//      再乘一次；对文本/图片则相反，盒子不含 scale，缩放走仿射。
//   1. 文本平铺与图片平铺**不是同一套网格**。文本按内容盒 step 在锚点 (x,y) 周围
//      铺 ±(ceil(边/step)+3) 行列；图片走 `tile_stamp_points`，在**画布中心**周围
//      按对角线长铺，再把整张点阵旋转到 tile.angle。
//   2. 文本的 gapX/gapY 只有 `unwrap_or(8/10)`，图片那条还有 `.max(2.0)` 下限。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_ELEMENT_GEOMETRY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 与 studio_export.rs 的 REFERENCE_SHORT_EDGE 同值：radius 等「画布参考单位」
  // 字段按短边比例换算。
  const REFERENCE_SHORT_EDGE = 540;
  const VERTICAL_ALIGNS = ['top', 'center', 'bottom'];
  // 元素缺省值（render_plan.rs 收集元素时的 unwrap_or 链）。
  const DEFAULTS = Object.freeze({
    x: 50, y: 50, scale: 1, rot: 0, opacity: 1,
    textWidthRatio: 0.9,     // place.w 缺席时换行宽 = 画布宽 × 0.9
    imageWidthPct: 34,       // pip 缺席宽度百分比
    tileAngle: -30, tileGapX: 8, tileGapY: 10, tileStagger: true,
    mode: 'pip', fit: 'cover', bg: 'black',
  });

  // ---------- core 几何常量（`bcut-timeline/src/geometry.rs` 逐条镜像） ----------
  // 名字刻意与 Rust 侧同名：漂移一 grep 就看得见。改这里等于改契约。
  const DEFAULT_ELEMENT_W = 20;    // Mac 的 `el.w ?? 20`
  const DEFAULT_ELEMENT_X = 50;
  const DEFAULT_ELEMENT_Y = 50;
  // `template == "box"` 贴纸的高宽比（原 stage_pose.rs 的 `width*0.62`）。
  const STICKER_BOX_HEIGHT_RATIO = 0.62;
  const STICKER_BOX_TEMPLATE = 'box';
  // visualizer 横条类（VEED 的 1.0 × 0.2，贴底）与圆形类（强制正方）。
  const VISUALIZER_BAR_W = 100;
  const VISUALIZER_BAR_H = 20;
  const VISUALIZER_BAR_Y = 85;
  const VISUALIZER_SQUARE_W = 30;
  const VISUALIZER_SQUARE_H = 30;
  // progress 横条类 / 圆形类 / `*border` 铺满边框类。
  const PROGRESS_BAR_W = 80;
  const PROGRESS_BAR_H = 5;
  const PROGRESS_SQUARE_W = 30;
  const PROGRESS_SQUARE_H = 30;
  const PROGRESS_FRAME_W = 100;
  const PROGRESS_FRAME_H = 100;
  // `ShapeProps.strokeWidth` 缺省（schema.rs 的 SHAPE_STROKE_WIDTH_DEFAULT）。
  const SHAPE_STROKE_WIDTH_DEFAULT = 2;
  // 画布上真的画得出来的 kind。video 要解码第二条媒体流（B-roll，D16 省略），
  // audio 没有画面 —— 两者继续不进这一层。
  const RENDERABLE_KINDS = Object.freeze([
    'text', 'image', 'shape', 'sticker', 'visualizer', 'progress',
  ]);

  // 只认真正的有限数值（typeof 纪律，同 subtitle-rendering.js 的 linePosition）：
  // 投影里的 `place` / `tile` 是 serde 直出，**缺席字段序列化成 null 而不是省略**
  // （Place/Tile 的 Option 字段没有 skip_serializing_if）。`Number(null) === 0`
  // 会把"缺席"读成 0：place.w 缺席就变成 1% 换行宽、place.x 缺席就贴到左边缘，
  // 而烧录端的 as_f64() 对 null 是 None → 走缺省。宽松的换算在这里就是错的。
  const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback);
  const isBlank = (text) => !String(text).trim();
  const isRenderableKind = (kind) => RENDERABLE_KINDS.indexOf(kind) >= 0;
  const roundPercent = (value) => Math.round(finite(value, 0) * 10) / 10;

  function verticalAlignValue(value) {
    return typeof value === 'string' && VERTICAL_ALIGNS.indexOf(value) >= 0 ? value : null;
  }

  // 锚点 anchor 是这块内容的哪条边，返回顶边坐标（镜像 raster.rs::anchor_block）。
  function anchorBlock(anchor, height, align) {
    if (align === 'top') return anchor;
    if (align === 'bottom') return anchor - height;
    return anchor - height / 2;
  }

  function placeOf(element) {
    const place = (element && element.place) || {};
    return place && typeof place === 'object' ? place : {};
  }

  function tileOf(element) {
    const tile = element && element.tile;
    return tile && typeof tile === 'object' && tile.on ? tile : null;
  }

  // 通用变换：scale / scaleY / rot / opacity / 镜像（缺省与烧录端一致；scaleY 缺席跟随 scale）。
  //
  // `flipX` / `flipY` 是**独立通道**（±1 符号），不预先乘进 scaleX/scaleY —— 因为
  // 烧录端 `render_media_element` 的平铺点阵用的是**未镜像**的 `uniform_scale`
  // （`scaled_x = point_x * uniform_scale`），镜像只进最后的 `post_scale`。折进
  // scaleX 会让整张点阵跟着翻，和成片对不上。调用方在**画印章的那一层**乘 flip。
  //
  // 只有 `true` 才翻（Rust `flip_x.unwrap_or(false)`）：serde 直出的 null 不是翻。
  function transformOf(element) {
    const place = placeOf(element);
    const scale = finite(place.scale, DEFAULTS.scale);
    return {
      scaleX: scale,
      scaleY: finite(place.scaleY, scale),
      rotation: finite(place.rot, DEFAULTS.rot),
      opacity: Math.max(0, Math.min(1, finite(place.opacity, DEFAULTS.opacity))),
      flipX: place.flipX === true ? -1 : 1,
      flipY: place.flipY === true ? -1 : 1,
    };
  }

  // ---------- 元素盒（`bcut-timeline/src/geometry.rs` 孪生） ----------
  // 这一段的每个数字都在 geometry.rs 里有同名常量，公式逐行对照。文本与图片**不走
  // 这里**：它们的盒子分别由排版结果与素材自然宽高比决定（烧录端同理）。

  // 一种 kind + aspect 组合的默认落位（帧百分比）。`h === null` = 正方形（取像素宽）。
  // `aspect` 来自目录型配方（ADR-E05）的 `aspect` 字段；P2 登记注册表之前一律传
  // null，按各自的横条类兜底 —— 与烧录端 `element_frame` 的 `aspect: None` 同步。
  function defaultPlace(kind, aspect) {
    if (kind === 'visualizer') {
      if (aspect === 'square') {
        return { w: VISUALIZER_SQUARE_W, h: VISUALIZER_SQUARE_H, y: DEFAULT_ELEMENT_Y };
      }
      return { w: VISUALIZER_BAR_W, h: VISUALIZER_BAR_H, y: VISUALIZER_BAR_Y };
    }
    if (kind === 'progress') {
      if (aspect === 'square') {
        return { w: PROGRESS_SQUARE_W, h: PROGRESS_SQUARE_H, y: DEFAULT_ELEMENT_Y };
      }
      if (aspect === 'frame') {
        return { w: PROGRESS_FRAME_W, h: PROGRESS_FRAME_H, y: DEFAULT_ELEMENT_Y };
      }
      return { w: PROGRESS_BAR_W, h: PROGRESS_BAR_H, y: DEFAULT_ELEMENT_Y };
    }
    return { w: DEFAULT_ELEMENT_W, h: null, y: DEFAULT_ELEMENT_Y };
  }

  // 元素几何输入：kind 对应的那一组 props，其余给 null（互斥规则见 schema.rs 的
  // `element-props-mismatch`）。
  function geometryOf(element, aspect) {
    const source = element && typeof element === 'object' ? element : {};
    return {
      shape: source.shape && typeof source.shape === 'object' ? source.shape : null,
      sticker: source.sticker && typeof source.sticker === 'object' ? source.sticker : null,
      aspect: typeof aspect === 'string' ? aspect : null,
    };
  }

  // 元素盒宽度（像素）：`frame_w * w% * scale`。注意没有 `.max(1)` —— 那是文本换行宽
  // 与图片盒的下限，元素盒这条不带。
  function elementWidth(place, frameWidth, scale) {
    const source = place && typeof place === 'object' ? place : {};
    return Math.max(0, finite(frameWidth, 0))
      * finite(source.w, DEFAULT_ELEMENT_W) / 100
      * finite(scale, 1);
  }

  // 元素盒高度（像素）。ADR-E01 的高度表，逐分支对应 `geometry.rs::element_height`：
  //   · Shape：`h` 显式给出用 `frame_h * h/100 * scale`；缺省正方（= 像素宽）。
  //   · Sticker：`templateId == "box"` 用 `width * 0.62`；其余正方。
  //     历史上的 `type == "waveform"`（`width * 0.28`）**已废弃**（§5.4）。
  //   · Visualizer / Progress：没有显式 `h`，高度来自 `aspect` 的默认表。
  //   · 其余 kind：正方。
  function elementHeight(kind, geometry, frameHeight, width, scale) {
    const source = geometry && typeof geometry === 'object' ? geometry : {};
    const height = Math.max(0, finite(frameHeight, 0));
    const pixels = Math.max(0, finite(width, 0));
    const zoom = finite(scale, 1);
    if (kind === 'shape') {
      const shape = source.shape && typeof source.shape === 'object' ? source.shape : {};
      return typeof shape.h === 'number' && Number.isFinite(shape.h)
        ? height * shape.h / 100 * zoom
        : pixels;
    }
    if (kind === 'sticker') {
      const sticker = source.sticker && typeof source.sticker === 'object' ? source.sticker : {};
      return sticker.templateId === STICKER_BOX_TEMPLATE
        ? pixels * STICKER_BOX_HEIGHT_RATIO
        : pixels;
    }
    if (kind === 'visualizer' || kind === 'progress') {
      const percent = defaultPlace(kind, source.aspect).h;
      return percent === null ? pixels : height * percent / 100 * zoom;
    }
    return pixels;
  }

  // 元素的静态盒（左上原点、像素）：舞台选中框、命中框与导出几何共用同一个函数，
  // 「环画在一处、像素画在另一处」因此不可能发生。
  //
  // `place.scale` 在这里**烘进盒子尺寸**（宽高都乘），所以画节点时不能再乘一次
  // （烧录端 `element_transform` 的注释：再乘就是双重缩放）。
  function staticBox(kind, geometry, place, options) {
    const frameWidth = Math.max(0, finite(options && options.frameWidth, 0));
    const frameHeight = Math.max(0, finite(options && options.frameHeight, 0));
    const source = place && typeof place === 'object' ? place : {};
    const scale = finite(source.scale, 1);
    const width = elementWidth(source, frameWidth, scale);
    const height = elementHeight(kind, geometry, frameHeight, width, scale);
    const centerX = frameWidth * finite(source.x, DEFAULT_ELEMENT_X) / 100;
    const centerY = frameHeight
      * finite(source.y, defaultPlace(kind, (geometry || {}).aspect).y) / 100;
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      w: width,
      h: height,
      centerX,
      centerY,
    };
  }

  // `progress = clamp((t - start) / (end - start), 0, 1)`（ADR-E04）。progress 元素
  // 不需要 VisualSource：内容完全由播放头推导，是纯函数。
  function progressAt(time, start, end) {
    const from = finite(start, 0);
    const to = finite(end, 0);
    if (!(to > from)) return 0;
    return Math.max(0, Math.min(1, (finite(time, 0) - from) / (to - from)));
  }

  // ---------- 投影消费 ----------
  // `studio/data.json.timeline.tracks[]`：元素窗口已求值为时间轴秒（词锚点已解析），
  // `end` 缺席时投影already填成片尾。可见判据是半开区间 [start, end)。
  // 顺序 = 轨道数组序 × 轨内数组序（§3.6：没有隐式 canonicalRank），字幕层垫在
  // 所有 overlay 轨之下由画布的图层顺序表达，不在这里排。
  function visibleElements(tracks, time, duration) {
    const t = finite(time, 0);
    const end = finite(duration, 0);
    const out = [];
    (Array.isArray(tracks) ? tracks : []).forEach((track) => {
      if (!track || track.hidden === true) return;
      (Array.isArray(track.elements) ? track.elements : []).forEach((element) => {
        if (!element || element.hidden === true) return;
        // 白名单是**显式**的：不在 RENDERABLE_KINDS 里的一律丢弃，而不是"落到 else
        // 就当文本画"。video 元素要解码第二条媒体流（B-roll，D16 省略），audio 没有
        // 画面；将来 core 再扩 kind 时，这里不放行就等于预览看不见 —— 那是可见的
        // 缺失，比静默画成一段文字好。
        if (!isRenderableKind(element.kind)) return;
        const start = finite(element.start, NaN);
        const stop = finite(element.end, end);
        if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return;
        if (t < start || t >= stop) return;
        out.push({ ...element, trackId: track.id || null, start, end: stop });
      });
    });
    return out;
  }

  // ---------- 文本元素 ----------
  // 镜像 raster.rs::layout_text 在 `words` 为空时的行为：逐 grapheme 断行
  // （元素没有词时间，timed_runs 只吐一条无词 run，于是每个字都是独立断点），
  // 行首空白丢弃，最后 retain 掉没有任何 chunk 的空行。
  function textWrap(text, wrapWidth, measure) {
    const limit = Math.max(1, finite(wrapWidth, 1));
    const lines = [{ text: '', width: 0 }];
    Array.from(String(text == null ? '' : text)).forEach((piece) => {
      if (piece === '\n') {
        lines.push({ text: '', width: 0 });
        return;
      }
      const width = finite(measure(piece), 0);
      let line = lines[lines.length - 1];
      if (line.width > 0 && line.width + width > limit && !isBlank(piece)) {
        lines.push({ text: '', width: 0 });
        line = lines[lines.length - 1];
      }
      if (line.width === 0 && isBlank(piece)) return;
      line.text += piece;
      line.width += width;
    });
    const kept = lines.filter((line) => line.text.length > 0);
    if (!kept.length) kept.push({ text: '', width: 0 });
    return { lines: kept, width: kept.reduce((max, line) => Math.max(max, line.width), 0) };
  }

  // 换行宽：place.w 是画布宽百分比（下限 1%），缺席退回画布宽的 90%。
  function textWrapWidth(element, frameWidth) {
    const width = Math.max(0, finite(frameWidth, 0));
    const w = placeOf(element).w;
    return typeof w === 'number' && Number.isFinite(w)
      ? width * Math.max(1, w) / 100
      : width * DEFAULTS.textWidthRatio;
  }

  // 元素锚点：place.x/y 换算成画面像素中心（缺省 50/50）。这是"这个对象在哪"的
  // 唯一答案 —— 拖动写它、选中框画它。平铺元素**不能**拿第一枚印章当锚点：文本的
  // 网格从 -rows/-cols 起铺，第一枚在画面外；图片的网格更是以画布中心为原点。
  function anchorPoint(element, frameWidth, frameHeight) {
    const place = placeOf(element);
    return {
      x: Math.max(0, finite(frameWidth, 0)) * finite(place.x, DEFAULTS.x) / 100,
      y: Math.max(0, finite(frameHeight, 0)) * finite(place.y, DEFAULTS.y) / 100,
    };
  }

  // 平铺印章中心（文本）：step = 内容尺寸 + 画布尺寸 × gap%，行列 ±(ceil(边/step)+3)，
  // 奇数行错开半步，每个印章旋转 rot + tile.angle。
  function textStamps(element, options) {
    const { frameWidth, frameHeight, contentWidth, contentHeight } = options;
    const transform = transformOf(element);
    const { x, y } = anchorPoint(element, frameWidth, frameHeight);
    const tile = tileOf(element);
    if (!tile) return [{ x, y, rotation: transform.rotation }];
    const gapX = finite(tile.gapX, DEFAULTS.tileGapX);
    const gapY = finite(tile.gapY, DEFAULTS.tileGapY);
    const stepX = Math.max(1, finite(contentWidth, 0) + frameWidth * gapX / 100);
    const stepY = Math.max(1, finite(contentHeight, 0) + frameHeight * gapY / 100);
    const columns = Math.ceil(frameWidth / stepX) + 3;
    const rows = Math.ceil(frameHeight / stepY) + 3;
    const rotation = transform.rotation + finite(tile.angle, DEFAULTS.tileAngle);
    const stagger = tile.stagger == null ? DEFAULTS.tileStagger : Boolean(tile.stagger);
    const stamps = [];
    for (let row = -rows; row <= rows; row += 1) {
      // Rust 的 `row.rem_euclid(2) != 0`：负数行也按正余数判奇偶。
      const offset = stagger && Math.abs(row % 2) === 1 ? stepX / 2 : 0;
      for (let column = -columns; column <= columns; column += 1) {
        stamps.push({ x: x + column * stepX + offset, y: y + row * stepY, rotation });
      }
    }
    return stamps;
  }

  // 文本元素的完整摆放：印章列表 + 块级垂直锚点换算出的字形顶边（相对印章中心）。
  //
  // 锚点钉的是**含内边距的盒子**（render_plan.rs 的注释：先按 height + 2×pad_v
  // 挂块，再进 pad_v 得到字形顶边），缺省 center。
  function textPlacement(element, options) {
    const contentWidth = Math.max(0, finite(options.contentWidth, 0));
    const contentHeight = Math.max(0, finite(options.contentHeight, 0));
    const padV = Math.max(0, finite(options.padV, 0));
    const align = verticalAlignValue(element && element.verticalAlign) || 'center';
    const transform = transformOf(element);
    const stamps = textStamps(element, {
      frameWidth: options.frameWidth,
      frameHeight: options.frameHeight,
      contentWidth,
      contentHeight,
    });
    const anchor = anchorPoint(element, options.frameWidth, options.frameHeight);
    return {
      ...transform,
      stamps,
      // 锚点带 place.rot（不含 tile.angle —— 那是印章各自的花纹角度）。
      anchor: { ...anchor, rotation: transform.rotation },
      contentWidth,
      contentHeight,
      // 相对印章中心的字形顶边偏移：绝对顶边 = 印章中心 y + topOffset。
      topOffset: anchorBlock(0, contentHeight + padV * 2, align) + padV,
      verticalAlign: align,
    };
  }

  // ---------- 图片元素 ----------
  // 镜像 raster.rs::tile_stamp_points：印章尺寸 + 画布尺寸 × gap%（gap 有 2% 下限），
  // 以画布中心为原点、按对角线长铺满，奇数行错开半步。返回的是**未旋转**的相对点，
  // 调用方再整体旋转（render_media_element 就是这么做的）。
  function tileStampPoints(frameWidth, frameHeight, stampWidth, stampHeight, tile) {
    const width = Math.max(0, finite(frameWidth, 0));
    const height = Math.max(0, finite(frameHeight, 0));
    // 下限 1px 只是防御除零/死循环：正常输入下 gap 有 2% 下限，step 必然为正。
    const stepX = Math.max(1, finite(stampWidth, 0)
      + width * Math.max(2, finite(tile.gapX, DEFAULTS.tileGapX)) / 100);
    const stepY = Math.max(1, finite(stampHeight, 0)
      + height * Math.max(2, finite(tile.gapY, DEFAULTS.tileGapY)) / 100);
    const diagonal = Math.hypot(width, height);
    const stagger = tile.stagger == null ? DEFAULTS.tileStagger : Boolean(tile.stagger);
    const points = [];
    let row = 0;
    for (let y = -diagonal / 2; y <= diagonal / 2 + stepY; y += stepY) {
      const offset = stagger && row % 2 === 1 ? stepX / 2 : 0;
      for (let x = -diagonal / 2 - stepX + offset; x <= diagonal / 2 + stepX; x += stepX) {
        points.push({ x, y });
      }
      row += 1;
    }
    return points;
  }

  // 图片/视频元素的盒子与印章。naturalWidth/Height 由调用方从已加载的图片给出
  // （投影里没有自然尺寸；`putSource.source.naturalW/H` 是给 CLI 的记录）。
  function imagePlacement(element, options) {
    const frameWidth = Math.max(1, finite(options.frameWidth, 1));
    const frameHeight = Math.max(1, finite(options.frameHeight, 1));
    const naturalWidth = Math.max(1, finite(options.naturalWidth, 1));
    const naturalHeight = Math.max(1, finite(options.naturalHeight, 1));
    const place = placeOf(element);
    const transform = transformOf(element);
    const tile = tileOf(element);
    const mode = element && element.mode ? element.mode : DEFAULTS.mode;
    const fit = element && element.fit ? element.fit : DEFAULTS.fit;
    const background = element && element.bg ? element.bg : DEFAULTS.bg;
    const fullscreen = mode === 'fullscreen' && !tile;
    let boxWidth;
    let boxHeight;
    let centerX;
    let centerY;
    if (fullscreen) {
      boxWidth = frameWidth;
      boxHeight = frameHeight;
      centerX = frameWidth / 2;
      centerY = frameHeight / 2;
    } else {
      // B-roll 的历史缺省是 34%；sticker 是 0.2 的新元素，走 core 的统一缺省
      // `DEFAULT_ELEMENT_W`（烧录端 `render_media_element` 的同一条分支）。
      const defaultWidthPct = element && element.kind === 'sticker'
        ? DEFAULT_ELEMENT_W
        : DEFAULTS.imageWidthPct;
      boxWidth = frameWidth * Math.max(1, finite(place.w, defaultWidthPct)) / 100;
      boxHeight = boxWidth * naturalHeight / naturalWidth;
      centerX = frameWidth * finite(place.x, DEFAULTS.x) / 100;
      centerY = frameHeight * finite(place.y, DEFAULTS.y) / 100;
    }
    // 局部画布按整数像素建立（Rust `round().max(1)`），圆角/椭圆遮罩作用在它上面。
    const localWidth = Math.max(1, Math.round(boxWidth));
    const localHeight = Math.max(1, Math.round(boxHeight));
    const shortEdge = Math.min(frameWidth, frameHeight);
    // radius 是「画布参考单位」：按短边 / 540 换算，且只在 pip 或平铺时生效。
    const radius = mode === 'pip' || tile
      ? Math.max(0, finite(place.radius, 0)) * shortEdge / REFERENCE_SHORT_EDGE
      : 0;
    let stamps;
    if (tile) {
      const rotation = finite(tile.angle, DEFAULTS.tileAngle) + transform.rotation;
      const radians = rotation * Math.PI / 180;
      stamps = tileStampPoints(frameWidth, frameHeight, localWidth, localHeight, tile)
        .map((point) => {
          const scaledX = point.x * transform.scaleX;
          const scaledY = point.y * transform.scaleY;
          return {
            x: frameWidth / 2 + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
            y: frameHeight / 2 + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
            rotation,
          };
        });
    } else {
      stamps = [{ x: centerX, y: centerY, rotation: transform.rotation }];
    }
    return {
      ...transform,
      mode,
      fit,
      background,
      fullscreen,
      boxWidth: localWidth,
      boxHeight: localHeight,
      centerX,
      centerY,
      radius,
      tiled: Boolean(tile),
      stamps,
      // 锚点是盒子中心：pip / 平铺时它就是 place.x/y（拖动写它、选中框画它），
      // fullscreen 时退化为画布中心。
      anchor: { x: centerX, y: centerY, rotation: transform.rotation },
    };
  }

  // ---------- 形状元素（`element_draw.rs::push_shape_ops` 孪生） ----------
  // 形状目录是 `core/presets/builtin/shape/*.json` 的镜像（ADR-E05 的目录型配方）：
  // 一形状一条，`params` 是**封闭词汇表** —— 配方没声明的参数一律不读（椭圆因此
  // 不吃 cornerRadius，线段不吃 fill）。studio 没有 preset 注册表，这张表就是它的
  // 那一份；扩形状时两边同任务更新。
  //
  // **P7a 起共 24 条** = VEED `NameEnum` 全集 23 + BaoCut 自有的 `line`，order 是
  // VEED 网格序。这里**不带几何**：`outline` 的点列只在出像素时才需要，而 P6b 之后
  // shape 的像素由 wasm overlay（与导出同一份光栅器）出，浏览器不该手抄配方。本表
  // 只回答交互层的三个问题——这个 id 存在吗、盒子多大、面板能显示哪些参数。
  const SHAPE_RECIPES = Object.freeze({
    rect: Object.freeze({
      id: 'rect', order: 0, path: 'rect', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth', 'cornerRadius']),
    }),
    ellipse: Object.freeze({
      id: 'ellipse', order: 1, path: 'ellipse', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    triangle: Object.freeze({
      id: 'triangle', order: 2, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    rombus: Object.freeze({
      id: 'rombus', order: 3, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    pentagon: Object.freeze({
      id: 'pentagon', order: 4, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    hex: Object.freeze({
      id: 'hex', order: 5, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    octagon: Object.freeze({
      id: 'octagon', order: 6, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    squig: Object.freeze({
      id: 'squig', order: 7, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    squig2: Object.freeze({
      id: 'squig2', order: 8, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    line: Object.freeze({
      id: 'line', order: 9, path: 'segment', defaultHead: 'none',
      params: Object.freeze(['stroke', 'strokeWidth', 'endpoints']),
    }),
    arrow: Object.freeze({
      id: 'arrow', order: 10, path: 'segment', defaultHead: 'arrow',
      params: Object.freeze(['stroke', 'strokeWidth', 'endpoints', 'head']),
    }),
    tick: Object.freeze({
      id: 'tick', order: 11, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    tick2: Object.freeze({
      id: 'tick2', order: 12, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    chevron: Object.freeze({
      id: 'chevron', order: 13, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    chevron2: Object.freeze({
      id: 'chevron2', order: 14, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    cross2: Object.freeze({
      id: 'cross2', order: 15, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    cross: Object.freeze({
      id: 'cross', order: 16, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    love2: Object.freeze({
      id: 'love2', order: 17, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    love: Object.freeze({
      id: 'love', order: 18, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    diamond: Object.freeze({
      id: 'diamond', order: 19, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    star: Object.freeze({
      id: 'star', order: 20, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    sharp: Object.freeze({
      id: 'sharp', order: 21, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    star2: Object.freeze({
      id: 'star2', order: 22, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
    sharp2: Object.freeze({
      id: 'sharp2', order: 23, path: 'outline', defaultHead: 'none',
      params: Object.freeze(['fill', 'stroke', 'strokeWidth']),
    }),
  });

  // ---------- 模板贴纸目录（`core/presets/builtin/sticker/*.json` 镜像） ----------
  // 与 SHAPE_RECIPES 同一条纪律，理由也同一条：**不带几何**。模板贴纸是一叠自带
  // 颜色的归一化轮廓层，那些点列只在出像素时才需要，而模板贴纸的像素自 P7b 起由
  // wasm overlay 出（与导出同一份光栅器，`claimsElement` 认领）。浏览器手抄十份
  // 配方只会多一份会漂移的副本。
  //
  // 这里只回答选择器的三个问题——有哪些模板、叫什么、大概什么配色。`layers` /
  // `colors` 是注册表列（契约夹具 `element-catalogue-contract.json` 的 sticker 一节
  // 逐字），`name` 是本地显示名（注册表没有这一列，与 shape / visualizer 同规矩）。
  //
  // ⚠️ 贴纸的配色属于**模板本身**：`StickerProps` 没有 fill / stroke，改色 = 换模板
  //（设计 §13 P7b-core 定案二）。所以 `colors` 是"你会得到什么"的示意，不是控件。
  const STICKER_RECIPES = Object.freeze({
    badge_check: Object.freeze({ id: 'badge_check', order: 0, name: '对勾徽章', layers: 2, colors: Object.freeze(['#22C55E', '#FFFFFF']) }),
    badge_cross: Object.freeze({ id: 'badge_cross', order: 1, name: '叉号徽章', layers: 3, colors: Object.freeze(['#EF4444', '#FFFFFF']) }),
    star_burst: Object.freeze({ id: 'star_burst', order: 2, name: '星芒', layers: 2, colors: Object.freeze(['#FACC15', '#F97316']) }),
    speech_bubble: Object.freeze({ id: 'speech_bubble', order: 3, name: '对话气泡', layers: 2, colors: Object.freeze(['#FFFFFF', '#111827']) }),
    heart: Object.freeze({ id: 'heart', order: 4, name: '爱心', layers: 1, colors: Object.freeze(['#EF4444']) }),
    bolt: Object.freeze({ id: 'bolt', order: 5, name: '闪电', layers: 2, colors: Object.freeze(['#FACC15', '#B45309']) }),
    pin: Object.freeze({ id: 'pin', order: 6, name: '定位针', layers: 2, colors: Object.freeze(['#EF4444', '#FFFFFF']) }),
    sparkle: Object.freeze({ id: 'sparkle', order: 7, name: '闪光', layers: 1, colors: Object.freeze(['#FDE047']) }),
    arrow_curved: Object.freeze({ id: 'arrow_curved', order: 8, name: '弯箭头', layers: 2, colors: Object.freeze(['#111827']) }),
    crown: Object.freeze({ id: 'crown', order: 9, name: '皇冠', layers: 2, colors: Object.freeze(['#FACC15', '#F59E0B']) }),
  });

  // `StickerProps.loop` 的三个面值（设计 §13 P7b-core 冻结）。只对**动态**贴纸
  // （资产是 alpha WebM）有意义；静态模板画的每一帧都一样。
  const STICKER_LOOPS = Object.freeze(['loop', 'once', 'hold']);
  const STICKER_LOOP_DEFAULT = 'loop';

  // 注册表里没有这个 id = 文档引用了不存在的模板（同 `preset-unknown`）。
  function stickerRecipe(name) {
    return Object.prototype.hasOwnProperty.call(STICKER_RECIPES, name)
      ? STICKER_RECIPES[name]
      : null;
  }

  // 选择器顺序 = manifest 的 `order`。
  function stickerRecipes() {
    return Object.keys(STICKER_RECIPES)
      .map((id) => STICKER_RECIPES[id])
      .sort((a, b) => a.order - b.order);
  }

  // `source` 是 0.2 契约拼写；`type` 是更早的原型拼写，只读不写。
  function stickerSource(props) {
    if (!props || typeof props !== 'object') return null;
    return props.source || props.type || null;
  }

  function stickerLoop(props) {
    const value = props && props.loop;
    return STICKER_LOOPS.indexOf(value) >= 0 ? value : STICKER_LOOP_DEFAULT;
  }

  // 注册表里没有这个 id = 文档引用了不存在的形状（`preset-unknown` 的时机，§5.3）。
  // 返回 null，调用方不画 —— 与烧录端 `push_shape_element` 的 warn + 跳过同口径。
  function shapeRecipe(name) {
    return Object.prototype.hasOwnProperty.call(SHAPE_RECIPES, name)
      ? SHAPE_RECIPES[name]
      : null;
  }

  function shapeSupports(recipe, param) {
    return !!recipe && recipe.params.indexOf(param) >= 0;
  }

  // 描边宽度：`ShapeProps.strokeWidth` 是**参考短边 540 上的像素**，与 radius 同口径，
  // 4K 导出不会退化成发丝线。
  function shapeStrokeWidth(props, shortEdge) {
    const width = finite((props || {}).strokeWidth, SHAPE_STROKE_WIDTH_DEFAULT);
    return width * Math.max(0, finite(shortEdge, 0)) / REFERENCE_SHORT_EDGE;
  }

  // 四角半径：同样按短边 540 换算，再夹到盒子半边长以内（相邻两角不互相吃掉）。
  // 顺序与 core / VEED / Konva 一致：[左上, 右上, 右下, 左下]。
  function shapeCornerRadius(props, box, shortEdge) {
    const raw = (props || {}).cornerRadius;
    const values = Array.isArray(raw) && raw.length === 4 ? raw : [0, 0, 0, 0];
    const limit = Math.max(0, Math.min(finite(box && box.w, 0), finite(box && box.h, 0)) / 2);
    const factor = Math.max(0, finite(shortEdge, 0)) / REFERENCE_SHORT_EDGE;
    return values.map((value) => Math.max(0, Math.min(limit, finite(value, 0) * factor)));
  }

  // line / arrow 的端点，元素盒内 0..100 %。缺省是盒子的水平中线。
  function shapeEndpoints(props) {
    const source = props || {};
    return [
      finite(source.x1, 0),
      finite(source.y1, 50),
      finite(source.x2, 100),
      finite(source.y2, 50),
    ];
  }

  // 端头：配方不支持 `head` 时恒用配方缺省；非法值也退回配方缺省
  // （Rust 的 `props.head.and_then(ShapeHead::parse).unwrap_or(default_head)`）。
  function shapeHead(recipe, props) {
    if (!shapeSupports(recipe, 'head')) return recipe ? recipe.defaultHead : 'none';
    const head = (props || {}).head;
    return head === 'arrow' || head === 'none' ? head : recipe.defaultHead;
  }

  // 箭头端头：以线段方向为轴的等腰三角形，尺寸跟随描边宽度（`arrow_head_path`）。
  function arrowHeadPoints(start, end, strokeWidth) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !(strokeWidth > 0)) return null;
    const ux = dx / length;
    const uy = dy / length;
    const head = Math.min(strokeWidth * 4, length);
    const half = head / 2;
    const baseX = end.x - ux * head;
    const baseY = end.y - uy * head;
    return [
      { x: end.x, y: end.y },
      { x: baseX - uy * half, y: baseY + ux * half },
      { x: baseX + uy * half, y: baseY - ux * half },
    ];
  }

  // 元素盒类（shape / sticker 模板 / visualizer / progress）的摆放。
  //
  // 与文本/图片的关键差异：`place.scale` 已经烘进盒子尺寸，所以节点上的缩放**只剩
  // 镜像符号**（烧录端 `element_transform` 里同样只有 pose 缩放，studio 没有动画
  // pose）。`scaleX` / `scaleY` 直接就是可以往节点上写的值。
  function boxPlacement(element, options) {
    const kind = element && element.kind;
    const geometry = geometryOf(element, options && options.aspect);
    const box = staticBox(kind, geometry, placeOf(element), options);
    const transform = transformOf(element);
    return {
      kind,
      box: { x: box.x, y: box.y, w: box.w, h: box.h },
      centerX: box.centerX,
      centerY: box.centerY,
      rotation: transform.rotation,
      opacity: transform.opacity,
      flipX: transform.flipX,
      flipY: transform.flipY,
      // 盒子已含 place.scale：这里只把镜像交给节点，别再乘一次 transform.scaleX。
      scaleX: transform.flipX,
      scaleY: transform.flipY,
      anchor: { x: box.centerX, y: box.centerY, rotation: transform.rotation },
    };
  }

  // 形状元素的完整摆放：盒子 + 变换 + 这个配方真正支持的那几个绘制参数。
  // 未登记的形状返回 null（不画）。
  function shapePlacement(element, options) {
    const props = (element && element.shape && typeof element.shape === 'object')
      ? element.shape
      : null;
    const recipe = props ? shapeRecipe(props.shape) : null;
    if (!recipe) return null;
    const placement = boxPlacement(element, options);
    const shortEdge = Math.min(
      Math.max(0, finite(options && options.frameWidth, 0)),
      Math.max(0, finite(options && options.frameHeight, 0)),
    );
    const strokeWidth = shapeStrokeWidth(props, shortEdge);
    const fill = shapeSupports(recipe, 'fill') && typeof props.fill === 'string'
      ? props.fill
      : null;
    const stroke = shapeSupports(recipe, 'stroke') && typeof props.stroke === 'string'
      ? props.stroke
      : null;
    const result = {
      ...placement,
      recipe,
      shape: props.shape,
      path: recipe.path,
      fill,
      stroke,
      strokeWidth,
      cornerRadius: shapeSupports(recipe, 'cornerRadius')
        ? shapeCornerRadius(props, placement.box, shortEdge)
        : [0, 0, 0, 0],
    };
    if (recipe.path === 'segment') {
      const box = placement.box;
      const [x1, y1, x2, y2] = shapeEndpoints(props);
      const start = { x: box.x + box.w * x1 / 100, y: box.y + box.h * y1 / 100 };
      const end = { x: box.x + box.w * x2 / 100, y: box.y + box.h * y2 / 100 };
      // 线段类没有填充：stroke 缺省时退回 fill，让"只设了一个颜色"的元素仍画得出来；
      // 两个都没有就用白色（烧录端同一条兜底链）。
      result.start = start;
      result.end = end;
      result.strokeColor = stroke || fill || '#ffffff';
      result.head = shapeHead(recipe, props);
      result.headPoints = result.head === 'arrow'
        ? arrowHeadPoints(start, end, strokeWidth)
        : null;
    }
    return result;
  }

  // 拖动写回：把画面坐标位移换成 place.x/y 的百分比（一位小数，与字幕拖动同精度），
  // 并把锚点钳制在画面内（原型 elements-stage.jsx 的 2…98）。
  function movedPlace(element, options) {
    const frameWidth = Math.max(1, finite(options.frameWidth, 1));
    const frameHeight = Math.max(1, finite(options.frameHeight, 1));
    const place = placeOf(element);
    const x = finite(place.x, DEFAULTS.x) + finite(options.dx, 0) / frameWidth * 100;
    const y = finite(place.y, DEFAULTS.y) + finite(options.dy, 0) / frameHeight * 100;
    return {
      x: roundPercent(Math.max(2, Math.min(98, x))),
      y: roundPercent(Math.max(2, Math.min(98, y))),
    };
  }

  return {
    REFERENCE_SHORT_EDGE,
    DEFAULTS,
    // core 几何常量（geometry.rs 孪生）
    DEFAULT_ELEMENT_W,
    DEFAULT_ELEMENT_X,
    DEFAULT_ELEMENT_Y,
    PROGRESS_BAR_H,
    PROGRESS_BAR_W,
    PROGRESS_FRAME_H,
    PROGRESS_FRAME_W,
    PROGRESS_SQUARE_H,
    PROGRESS_SQUARE_W,
    RENDERABLE_KINDS,
    SHAPE_RECIPES,
    SHAPE_STROKE_WIDTH_DEFAULT,
    STICKER_BOX_HEIGHT_RATIO,
    STICKER_BOX_TEMPLATE,
    STICKER_LOOPS,
    STICKER_LOOP_DEFAULT,
    STICKER_RECIPES,
    VISUALIZER_BAR_H,
    VISUALIZER_BAR_W,
    VISUALIZER_BAR_Y,
    VISUALIZER_SQUARE_H,
    VISUALIZER_SQUARE_W,
    anchorBlock,
    anchorPoint,
    arrowHeadPoints,
    boxPlacement,
    defaultPlace,
    elementHeight,
    elementWidth,
    geometryOf,
    imagePlacement,
    isRenderableKind,
    movedPlace,
    placeOf,
    progressAt,
    roundPercent,
    shapeCornerRadius,
    shapeEndpoints,
    shapeHead,
    shapePlacement,
    shapeRecipe,
    shapeStrokeWidth,
    shapeSupports,
    staticBox,
    stickerLoop,
    stickerRecipe,
    stickerRecipes,
    stickerSource,
    textPlacement,
    textStamps,
    textWrap,
    textWrapWidth,
    tileOf,
    tileStampPoints,
    transformOf,
    verticalAlignValue,
    visibleElements,
  };
});

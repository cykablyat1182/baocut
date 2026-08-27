// BaoCut Subtitle Studio — wasm 元素 overlay 的接线层（DOM + wasm 模块 + 拉取）。
//
// 设计依据：docs/bcut-element-render-foundation-design.md §9.2 / §9.3 / §10 P6b。
// 判据在 wasm-overlay.js（可单测），本文件只负责副作用：加载模块、管一张画布、
// 拉 BCS1、按 rAF 出帧。
//
// ## 这一层画什么
//
// **只画 shape / visualizer / progress**（§9.3「P6 前半：并存」）。字幕、text、
// image 维持 Konva，视频底面维持 HTMLVideoElement。画的是与导出**同一份** Rust
// 光栅器（tiny-skia）出的像素，不是"长得像"的 Konva 复刻 —— 这正是 P6 的卖点。
//
// ## 图层顺序（canvas-stage.jsx 负责插进去，判据写在这里）
//
//   mediaLayer(Konva)  视频 / 底色
//   overlayLayer(Konva) 字幕 + 字幕选中框
//   ▸ 本层（wasm canvas） shape / visualizer / progress 的真像素
//   elementLayer(Konva) text / image 像素 + **所有** kind 的命中盒与选中框
//
// 选中框必须压在真像素之上，否则选中一个形状看不见框 —— 这是硬约束，决定了
// wasm 画布只能插在 elementLayer **之下**。代价是并存期里 wasm 画的三种 kind
// 永远排在 Konva 画的 text/image 之下，与导出的"轨声明序 × 元素声明序"不一定
// 一致；这是并存期的已知取舍，P6 后半 text/image 也迁进 wasm 后自然消失。
(() => {
const PLAN = window.BCS_WASM_OVERLAY;
if (!PLAN) throw new Error('wasm-overlay.js failed to load');

// 产物路径相对**项目页目录**（`/projects/<id>/` 或 `/<id>/`，两者都带尾斜杠，
// 服务端对缺尾斜杠的项目根 302 补上）。与 index.html 里 `studio/*.jsx` 同基。
const MODULE_REL = 'studio/wasm/bcut_wasm.js';
const BINARY_REL = 'studio/wasm/bcut_wasm_bg.wasm';
// 画布最多按 2× 出图：再高只换来更慢的一帧。几何是归一化百分比，任何尺寸都对。
const MAX_PIXEL_RATIO = 2;

// `import()` 写在 `text/babel` 源文件里会先经 Babel 转译，转译结果依 sourceType
// 而变（最糟的情形是被改写成 require）。用运行时构造的函数把它整个挡在转译面
// 之外：这一段字符串 Babel 看不见。
// eslint-disable-next-line no-new-func
const dynamicImport = new Function('specifier', 'return import(specifier);');

const absolute = (rel) => new URL(rel, document.baseURI).href;

function loadModule() {
  return dynamicImport(absolute(MODULE_REL)).then((module) => module
    .default({ module_or_path: absolute(BINARY_REL) })
    .then(() => module));
}

/**
 * 建一个 overlay 控制器。**不自己插 DOM**：画布交给调用方按图层顺序放置
 * （见文件头的图层表）。
 *
 * @param options.onChange 模块就绪 / 频谱到货后调用，调用方据此重新 sync + 重画
 * @returns 控制器；本环境缺 OffscreenCanvas 时返回 null（整层降级回 Konva）
 */
function createOverlay(options) {
  const config = options || {};
  const onChange = config.onChange || (() => {});
  // `renderFrameTo` 收的是 OffscreenCanvas（省掉一次 JS 侧 ImageData 拷贝，
  // 并且解预乘在 Rust 里做）。缺它就整层降级：与其在 JS 里再写一份解预乘、
  // 让半透明处两条路各偏一点，不如让 Konva 的 P0 占位继续顶着。
  if (typeof OffscreenCanvas !== 'function') return null;

  const canvas = document.createElement('canvas');
  canvas.className = 'bcs-wasm-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  // 命中与拖拽全在 Konva 的 elementLayer 上（那里有命中盒）；这张画布只出像素。
  canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
  const context = canvas.getContext('2d');

  let wasm = null;
  let failure = null;
  let offscreen = null;
  let size = { width: 0, height: 0, ratio: 1 };
  let loadedKey = null;
  let plan = null;
  let frame = 0;
  let pendingTime = null;
  let destroyed = false;

  const store = PLAN.createSpectrumStore({
    onChange: () => { if (!destroyed) onChange(); },
  });

  loadModule().then((module) => {
    if (destroyed) return;
    wasm = module;
    onChange();
  }).catch((error) => {
    failure = String((error && error.message) || error);
    // 一行、只报一次：产物没同步进 skill、老浏览器、MIME 不对都会落到这里，
    // 而画面上看到的仍是 P0 占位（"预览暂不渲染，导出可见"），不是空白。
    console.warn('[bcut] wasm overlay 未启用，元素回落 Konva 占位：' + failure);
    if (!destroyed) onChange();
  });

  function applySize(width, height) {
    const ratio = Math.min(MAX_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
    const pixelW = Math.max(1, Math.round(width * ratio));
    const pixelH = Math.max(1, Math.round(height * ratio));
    if (size.width === pixelW && size.height === pixelH) return false;
    size = { width: pixelW, height: pixelH, ratio };
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    offscreen = new OffscreenCanvas(pixelW, pixelH);
    if (wasm) wasm.setCanvasSize(pixelW, pixelH);
    return true;
  }

  function paint(time) {
    if (!wasm || !plan || !plan.rendered.length) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    try {
      wasm.renderFrameTo(offscreen, time);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(offscreen, 0, 0);
    } catch (error) {
      // 一帧画不出来不该把整层拆了（也不该每帧刷一条日志）：记下来，让
      // Konva 那边照旧显示占位。
      const message = String((error && error.message) || error);
      if (failure !== message) {
        failure = message;
        console.warn('[bcut] wasm overlay 出帧失败：' + message);
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  return {
    canvas,

    /// 画布尺寸变化时重设（§13 P6a 的调用顺序：setCanvasSize → loadTimeline）。
    resize(width, height) {
      if (applySize(width, height)) {
        // 尺寸变了要重画，但 timeline 没变、频谱轨也没变：只补一帧。
        if (pendingTime != null) this.render(pendingTime);
      }
    },

    /**
     * 把当前 timeline 投影同步进 wasm。返回给调用方的是「这一轮谁归 wasm」。
     * @returns {{active, rendered:Set, deferred:Set, status:string|null}}
     */
    sync(input) {
      const idle = {
        active: false, rendered: new Set(), deferred: new Set(), aspects: {}, status: failure,
      };
      if (!wasm) return idle;
      const next = PLAN.planOverlay({
        tracks: input.tracks,
        duration: input.duration,
        // visualizer 的采样时刻折算表。不喂它，剪切过的项目里波形会画出
        // 「几秒前的声音」——预览与导出当场分叉（设计 §13 P6b「投影补接」）。
        projection: input.projection,
        isReady: (srcId) => store.isReady(srcId),
      });
      // 频谱按需拉：没有 visualizer 的项目一个请求都不发。
      store.requestAll(next.sources);
      const key = PLAN.planKey(next);
      try {
        if (size.width === 0) return idle;
        if (key !== loadedKey) {
          wasm.setCanvasSize(size.width, size.height);
          wasm.loadTimeline(JSON.stringify(next.envelope));
          loadedKey = key;
        }
        // 注入顺序在浏览器里不可控（timeline 与频谱各自异步到达），所以每轮都
        // 把「已到货但还没注过」的补上。`loadTimeline` 只清元素表与诊断，注进去
        // 的 BCS1 留着（下一帧重新派生频谱轨），因此每个 srcId 只注一次。
        store.takePending().forEach((item) => wasm.setSpectrum(item.srcId, item.bytes));
      } catch (error) {
        failure = String((error && error.message) || error);
        console.warn('[bcut] wasm overlay loadTimeline 失败：' + failure);
        loadedKey = null;
        plan = null;
        return idle;
      }
      plan = next;
      // 配方的 `aspect` **问 wasm 要**，不在 JS 里再抄一份注册表（§12：浏览器端
      // 不得手抄配方）。命中盒由 Konva 用 element-geometry.js 的 staticBox 建，
      // 而那份 JS 孪生读不到 core/presets/builtin/**——不问就会把 `donut` 的
      // 圆算成一条横杠：画得中、点不中。
      let aspects = {};
      try {
        aspects = JSON.parse(wasm.elementAspects());
      } catch (error) {
        aspects = {};
      }
      return {
        active: true,
        rendered: new Set(next.rendered),
        deferred: new Set(next.deferred),
        aspects,
        status: failure,
      };
    },

    /// 播放头变化 / seek：rAF 对齐，一帧只出一次图（播放中每次 timeupdate 都会
    /// 调到这里，逐次同步光栅化会把主线程钉死）。
    render(time) {
      pendingTime = time;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (destroyed) return;
        paint(pendingTime);
      });
    },

    /// 诊断出口：wasm 侧累积的 warning + 频谱拉取状态 + `fingerprintAt`。
    /// 「我这一帧与导出的那一帧是同一个指纹」在浏览器里的自证入口（§9.2）。
    diagnostics(time) {
      const out = { spectra: store.snapshot(), failure, warnings: wasm ? wasm.warnings() : [] };
      if (wasm && plan && typeof time === 'number') {
        try {
          out.fingerprint = wasm.fingerprintAt(time);
        } catch (error) {
          out.fingerprint = String((error && error.message) || error);
        }
      }
      return out;
    },

    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      canvas.remove();
    },
  };
}

window.BCSWasmOverlay = { createOverlay };
})();

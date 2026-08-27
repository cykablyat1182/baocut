// wasm-overlay.js 的判据 + **浏览器侧的指纹复验**。
//
// 后者是设计 §10 P6 那条验收在 JS 这一端的落点：P6a 已经在 native 侧证明
// `Preview::fingerprint_at` 与 CLI 的 DrawOp 指纹逐位相同；这里证明的是**经过
// wasm-bindgen 的 JS 边界、用 studio 自己那份 `planOverlay` 造出来的信封**，
// 拿到的还是同一串十六进制。中间任何一层（字段白名单、srcId 换算、信封形状、
// bindgen 的类型转换）走偏都会在这里红。
//
// 模块用 `--target web` 的 ESM，node ≥ 20 直接 `import()` 得到；`initSync` 收
// 字节，因此不需要 fetch、不需要浏览器、不需要 canvas（`fingerprintAt` /
// `renderFrame` 都不碰 DOM）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const OV = require('./wasm-overlay.js');
const T = require('./timeline-mapping.js');

const WASM_DIR = path.join(__dirname, 'wasm');
const REPO_ROOT = path.join(__dirname, '../../../..');
const BCS1 = path.join(REPO_ROOT, 'core/fixtures/spectrum/tone-16k-mono-f32.bcs1');

// ---------- 与 CLI 共用的那份 golden ----------
// 来源：`apps/cli/src/cmd/studio_export/tests.rs` 的 `ELEMENT_OVERLAY_GOLDEN` 与
// `element_overlay_golden_elements()`（P6a 起由 `the_element_overlay_fingerprints_
// match_golden` 与 `the_wasm_preview_fingerprint_matches_the_cli_drawop_fingerprint`
// 共用）。**这里是复制品**：JS 读不到 Rust 常量，所以复制的同时把出处写清楚——
// 任何一边改了 golden，另一边会红，而不是双双变绿。
// 画布 320×180 / 3 s / 30 fps 同样抄自那两条测试（`compile_visualizer_plan`）。
const GOLDEN_CANVAS = { width: 320, height: 180 };
const GOLDEN_DURATION = 3.0;
const GOLDEN_FINGERPRINTS = [
  [0.0, '3d6202870f844bfe'],
  [0.1, '6060690e65aefd8b'],
  [0.5, '2b48897026cd7226'],
];
const GOLDEN_ELEMENTS = [
  {
    id: 'wave',
    kind: 'visualizer',
    start: 0.0,
    end: 3.0,
    place: { x: 50, y: 70, w: 90 },
    visualizer: { style: 'formation', mainColor: '#3CADFF' },
  },
  {
    id: 'ring',
    kind: 'progress',
    start: 0.0,
    end: 3.0,
    place: { x: 50, y: 30, w: 30 },
    progress: { style: 'donut', mainColor: '#3CADFF', secondaryColor: '#C4E6FF' },
  },
];
const goldenTracks = () => [{ id: 'overlay', kind: 'overlay', elements: GOLDEN_ELEMENTS }];

// ---------- 剪切过的那一份 golden ----------
// 同一组元素、同一块画布，唯一的差别是源媒体被剪掉了 `[0.0, 0.1)`：输出 t 采的
// 是源媒体 t + 0.1。来源：`apps/cli/src/cmd/studio_export/tests.rs` 的
// `CUT_OVERLAY_GOLDEN` 与 `the_wasm_preview_matches_the_cli_on_a_cut_timeline`。
// 投影表由 `timeline-mapping.js` 现算，与服务端 `TimelineProjection::build` 对同
// 一份文档算出来的那张逐位相同（同一套判据的孪生，`timeline-mapping.test.js`
// 对着 `timeline-map-contract.json` 钉着）。
const CUT_DOCUMENT = { sources: { main: { cuts: [{ id: 'c0', t0: 0.0, t1: 0.1 }] } } };
const cutProjection = () => T.buildProjection(CUT_DOCUMENT, { main: GOLDEN_DURATION });
// 注意 t=0.5 与未剪切那组**恰好相同**：夹具是一条稳态单音，平滑收敛之后相邻
// 若干帧的频谱本来就一样。把「折算生效了没有」钉住的是片头附近那两个时刻，
// 以及测试里那条「不喂投影就得对不上」的反面断言。
const CUT_FINGERPRINTS = [
  [0.0, '68979f08968e11da'],
  [0.1, 'c2946deba01924b1'],
  [0.5, '2b48897026cd7226'],
  [1.0, 'e91967fd343670f9'],
  [2.5, '2debb894d5a557ee'],
];

// ---------- planOverlay ----------

test('planOverlay：只挑 wasm 画得出来的 kind，其余留给 Konva', () => {
  const plan = OV.planOverlay({
    duration: 10,
    isReady: () => true,
    tracks: [{
      id: 'ov',
      kind: 'overlay',
      elements: [
        { id: 't1', kind: 'text', start: 0, end: 5, text: '嗨' },
        { id: 'i1', kind: 'image', start: 0, end: 5, srcId: 'pic' },
        { id: 's1', kind: 'shape', start: 0, end: 5, shape: { shape: 'rect', fill: '#ff0000' } },
        { id: 'p1', kind: 'progress', start: 0, end: 5, progress: { style: 'normal' } },
        { id: 'v1', kind: 'visualizer', start: 0, end: 5, visualizer: { style: 'formation' } },
        { id: 'a1', kind: 'audio', start: 0, end: 5, srcId: 'bgm' },
      ],
    }],
  });
  assert.deepStrictEqual(plan.rendered, ['s1', 'p1', 'v1']);
  assert.deepStrictEqual(plan.deferred, []);
  assert.deepStrictEqual(plan.envelope.timeline.tracks[0].elements.map((el) => el.id),
    ['s1', 'p1', 'v1']);
  // 排除 text / image / audio **不改变留下来那些元素的指令流**：`push_element`
  // 对它们本来就一条指令都不发。排除只是让 host_rasterized_elements() 变空。
  assert.strictEqual(plan.envelope.duration, 10);
  assert.strictEqual(plan.envelope.fps, OV.POSE_FPS);
  assert.strictEqual(plan.envelope.timeline.bcutTimeline, '0.2');
});

test('planOverlay：字段白名单挡住投影塞进来的非 schema 键', () => {
  // `projected_tracks`（apps/cli/src/cmd/timeline.rs）会往元素上塞
  // startAnchor / endAnchor / startError / endError —— TimelineDocument 全链路
  // deny_unknown_fields，原样递过去就是一个 400。
  const plan = OV.planOverlay({
    duration: 8,
    isReady: () => true,
    tracks: [{
      id: 'ov',
      kind: 'overlay',
      name: '叠加',
      locked: true,
      elements: [{
        id: 's1',
        kind: 'shape',
        start: 1,
        end: 4,
        startAnchor: 'w:12',
        endAnchor: 'w:40',
        place: { x: 50, y: 50, w: 40 },
        shape: { shape: 'rect', fill: '#ff0000' },
        style: { fontSize: 40 },
        srcId: 'nope',
      }],
    }],
  });
  const element = plan.envelope.timeline.tracks[0].elements[0];
  assert.deepStrictEqual(Object.keys(element).sort(), ['end', 'id', 'kind', 'place', 'shape', 'start']);
  const track = plan.envelope.timeline.tracks[0];
  assert.deepStrictEqual(Object.keys(track).sort(), ['elements', 'id', 'kind']);
});

test('planOverlay：频谱没到货的 visualizer 延后，不拖垮同一帧的其它元素', () => {
  const tracks = [{
    id: 'ov',
    kind: 'overlay',
    elements: [
      { id: 'v-main', kind: 'visualizer', start: 0, end: 5, visualizer: { style: 'formation' } },
      { id: 'v-bgm', kind: 'visualizer', start: 0, end: 5, visualizer: { style: 'formation', audio: 'bgm' } },
      { id: 's1', kind: 'shape', start: 0, end: 5, shape: { shape: 'rect', fill: '#ff0000' } },
    ],
  }];
  const plan = OV.planOverlay({ duration: 5, tracks, isReady: (id) => id === 'main' });
  // 缺省 audio（`project`）换算成 srcId `main`——与
  // bcut-timeline-render::visualizer_audio_source 同一条换算。
  assert.deepStrictEqual(plan.sources, ['main', 'bgm']);
  assert.deepStrictEqual(plan.rendered, ['v-main', 's1']);
  assert.deepStrictEqual(plan.deferred, ['v-bgm']);
  // 一个都没就绪时，形状照画。
  const none = OV.planOverlay({ duration: 5, tracks, isReady: () => false });
  assert.deepStrictEqual(none.rendered, ['s1']);
  assert.deepStrictEqual(none.deferred, ['v-main', 'v-bgm']);
});

test('planOverlay：隐藏与窗口非法的元素不进信封', () => {
  const plan = OV.planOverlay({
    duration: 6,
    isReady: () => true,
    tracks: [
      { id: 'hidden', kind: 'overlay', hidden: true, elements: [
        { id: 'x1', kind: 'shape', start: 0, end: 5, shape: { shape: 'rect', fill: '#ff0000' } },
      ] },
      { id: 'ov', kind: 'overlay', elements: [
        { id: 'h1', kind: 'shape', hidden: true, start: 0, end: 5, shape: { shape: 'rect', fill: '#ff0000' } },
        // 词锚点解不开 → 投影写 null + startError
        { id: 'a1', kind: 'shape', start: null, end: 5, shape: { shape: 'rect', fill: '#ff0000' } },
        { id: 'z1', kind: 'shape', start: 4, end: 4, shape: { shape: 'rect', fill: '#ff0000' } },
        // end 缺席 → 退化为整片时长（与投影的 fallback 同口径）
        { id: 'k1', kind: 'shape', start: 1, shape: { shape: 'rect', fill: '#ff0000' } },
      ] },
    ],
  });
  assert.deepStrictEqual(plan.rendered, ['k1']);
  assert.deepStrictEqual(plan.skipped, ['a1', 'z1']);
  assert.strictEqual(plan.envelope.timeline.tracks.length, 1);
  assert.strictEqual(plan.envelope.timeline.tracks[0].elements[0].end, 6);
});

test('planOverlay：折算表随信封走，白名单挡住投影自己那些键', () => {
  const projection = cutProjection();
  // 投影对象上有一堆 clip 表以外的东西（views / tracks / main / rev），clip 上
  // 将来也可能再多几个键——`PreviewEnvelope` 全链路 deny_unknown_fields。
  projection.rev = 7;
  projection.clips[0].words = ['脏键'];
  const plan = OV.planOverlay({
    tracks: goldenTracks(), duration: GOLDEN_DURATION, projection, isReady: () => true,
  });
  assert.deepStrictEqual(Object.keys(plan.envelope.projection), ['clips']);
  const clip = plan.envelope.projection.clips[0];
  assert.deepStrictEqual(Object.keys(clip).sort(), OV.CLIP_FIELDS.concat(['segments']).sort());
  assert.deepStrictEqual(Object.keys(clip.segments[0]).sort(), OV.SEGMENT_FIELDS.slice().sort());
  // 剪掉片头 0.1 s ⇒ 输出 0 对应源媒体 0.1。
  assert.strictEqual(clip.segments[0].sourceStart, 0.1);
  assert.strictEqual(clip.segments[0].timelineStart, 0);
  assert.deepStrictEqual(
    T.timelineToSource(projection, 0, 'following'),
    { srcId: 'main', sourceTime: 0.1, clipId: 'c1' },
  );
  // 没有投影可喂时信封里干脆没有这个键：wasm 退化为「输出时刻即源时刻」，
  // 与 P6a 的行为相同（未剪切的项目上两条路重合）。
  const none = OV.planOverlay({
    tracks: goldenTracks(), duration: GOLDEN_DURATION, isReady: () => true,
  });
  assert.ok(!('projection' in none.envelope));
});

test('planKey：改一刀 cut 就重新 loadTimeline（投影进 key）', () => {
  const base = OV.planOverlay({
    tracks: goldenTracks(), duration: GOLDEN_DURATION, isReady: () => true,
  });
  const cut = OV.planOverlay({
    tracks: goldenTracks(), duration: GOLDEN_DURATION, projection: cutProjection(), isReady: () => true,
  });
  assert.notStrictEqual(OV.planKey(base), OV.planKey(cut));
});

test('planKey：元素没变就不重新 loadTimeline（播放头不进 key）', () => {
  const one = OV.planOverlay({ duration: 5, tracks: goldenTracks(), isReady: () => true });
  const two = OV.planOverlay({ duration: 5, tracks: goldenTracks(), isReady: () => true });
  assert.strictEqual(OV.planKey(one), OV.planKey(two));
  const moved = JSON.parse(JSON.stringify(goldenTracks()));
  moved[0].elements[0].place.x = 40;
  const three = OV.planOverlay({ duration: 5, tracks: moved, isReady: () => true });
  assert.notStrictEqual(OV.planKey(one), OV.planKey(three));
});

test('visualizerAudioSource / spectrumURL：与 Rust 侧同一条换算', () => {
  assert.strictEqual(OV.visualizerAudioSource(undefined), 'main');
  assert.strictEqual(OV.visualizerAudioSource({}), 'main');
  assert.strictEqual(OV.visualizerAudioSource({ audio: 'project' }), 'main');
  assert.strictEqual(OV.visualizerAudioSource({ audio: 'bgm' }), 'bgm');
  assert.strictEqual(OV.spectrumURL('b g/m'), '__bcut/spectrum?src=b%20g%2Fm');
});

// ---------- BCS1 拉取状态机 ----------

function fakeStore(responses, options) {
  const timers = [];
  const calls = [];
  const changes = [];
  const store = OV.createSpectrumStore({
    fetchImpl: (url) => {
      calls.push(url);
      const next = responses.shift();
      return next ? Promise.resolve(next) : Promise.reject(new Error('用光了'));
    },
    timer: (fn) => timers.push(fn),
    onChange: (srcId) => changes.push(srcId),
    ...(options || {}),
  });
  return { store, timers, calls, changes, tick: () => timers.splice(0).forEach((fn) => fn()) };
}

const okResponse = (bytes) => ({
  status: 200, ok: true, arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
});
const buildingResponse = () => ({ status: 202, ok: false });

test('spectrum 状态机：202 轮询 → ready，注入只发生一次', async () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const harness = fakeStore([buildingResponse(), okResponse(payload)]);
  harness.store.request('main');
  harness.store.request('main'); // 幂等：不再发第二轮
  await null;
  assert.strictEqual(harness.store.state('main'), 'loading');
  assert.strictEqual(harness.calls.length, 1);
  harness.tick();
  await null; await null;
  assert.strictEqual(harness.store.state('main'), 'ready');
  assert.strictEqual(harness.store.isReady('main'), true);
  assert.deepStrictEqual(Array.from(harness.store.bytes('main')), [1, 2, 3, 4]);
  // takePending 是"还没注进 wasm 的"，取过一次就不再给。
  assert.deepStrictEqual(harness.store.takePending().map((item) => item.srcId), ['main']);
  assert.deepStrictEqual(harness.store.takePending(), []);
});

test('spectrum 状态机：非 202 的失败与轮询上限都落到 unavailable', async () => {
  const failed = fakeStore([{ status: 404, ok: false }]);
  failed.store.request('bgm');
  await null; await null;
  assert.strictEqual(failed.store.state('bgm'), 'unavailable');
  assert.deepStrictEqual(failed.store.snapshot(), { bgm: 'unavailable:http-404' });

  const forever = fakeStore(
    Array.from({ length: 5 }, buildingResponse),
    { pollLimit: 2 },
  );
  forever.store.request('main');
  for (let i = 0; i < 4; i += 1) { await null; forever.tick(); }
  await null;
  assert.strictEqual(forever.store.state('main'), 'unavailable');
  assert.deepStrictEqual(forever.store.snapshot(), { main: 'unavailable:timeout' });
});

// ---------- 浏览器侧的指纹复验 ----------

async function loadPreview() {
  const module = await import(new URL('file://' + path.join(WASM_DIR, 'bcut_wasm.js')).href);
  module.initSync({ module: fs.readFileSync(path.join(WASM_DIR, 'bcut_wasm_bg.wasm')) });
  return module;
}

test('vendor 产物与 build-info.json 一致（陈旧的 wasm 当场红）', () => {
  const info = JSON.parse(fs.readFileSync(path.join(WASM_DIR, 'build-info.json'), 'utf8'));
  const crypto = require('node:crypto');
  Object.entries(info.files).forEach(([name, expected]) => {
    const bytes = fs.readFileSync(path.join(WASM_DIR, name));
    assert.strictEqual(bytes.length, expected.bytes, name + ' 的字节数与 build-info 不符');
    assert.strictEqual(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      expected.sha256,
      name + ' 的 sha256 与 build-info 不符：重跑 scripts/dev/sync-studio-wasm.sh',
    );
  });
  // 体积基线与 core 的 `tests/wasm_size.rs` 同一条纪律：悄悄膨胀要看得见。
  assert.ok(info.files['bcut_wasm_bg.wasm'].bytes <= 2 * 1024 * 1024,
    'vendor 的 wasm 超过 2 MiB 预算');
});

test('浏览器侧 fingerprintAt(t) == CLI 冻结的 DrawOp 指纹', async () => {
  const preview = await loadPreview();
  const plan = OV.planOverlay({
    tracks: goldenTracks(),
    duration: GOLDEN_DURATION,
    isReady: () => true,
  });
  // 走的是 studio 自己那条路：planOverlay 造信封 → loadTimeline → setSpectrum。
  preview.setCanvasSize(GOLDEN_CANVAS.width, GOLDEN_CANVAS.height);
  preview.loadTimeline(JSON.stringify(plan.envelope));
  assert.deepStrictEqual(plan.sources, ['main']);
  preview.setSpectrum('main', new Uint8Array(fs.readFileSync(BCS1)));
  GOLDEN_FINGERPRINTS.forEach(([time, expected]) => {
    assert.strictEqual(preview.fingerprintAt(time), expected, 't=' + time);
  });
  assert.deepStrictEqual(preview.warnings(), []);
  // 像素也真的出得来（预乘 RGBA，长度 w*h*4）。
  assert.strictEqual(
    preview.renderFrame(0.5).length,
    GOLDEN_CANVAS.width * GOLDEN_CANVAS.height * 4,
  );
});

test('浏览器侧：模板贴纸经 vendor 的 wasm 真出像素（P7b）', async () => {
  const preview = await loadPreview();
  const plan = OV.planOverlay({
    tracks: [{
      id: 'overlay',
      kind: 'overlay',
      elements: [
        {
          id: 'tpl', kind: 'sticker', start: 0, end: 3,
          place: { x: 50, y: 50, w: 40 },
          sticker: { source: 'template', templateId: 'badge_check' },
        },
        {
          id: 'png', kind: 'sticker', start: 0, end: 3,
          place: { x: 20, y: 20, w: 20 },
          sticker: { source: 'asset', path: 'media/a.png' },
        },
      ],
    }],
    duration: 3,
    isReady: () => true,
  });
  // 认领判据：模板归 wasm，资产留给 Konva。
  assert.deepStrictEqual(plan.rendered, ['tpl']);
  assert.deepStrictEqual(plan.sources, []);

  preview.setCanvasSize(GOLDEN_CANVAS.width, GOLDEN_CANVAS.height);
  preview.loadTimeline(JSON.stringify(plan.envelope));
  assert.deepStrictEqual(preview.warnings(), []);
  // 指纹可比（没有需要 host 光栅化的元素留在信封里）。
  assert.strictEqual(preview.fingerprintAt(1).length, 16);

  // 像素：绿底白勾真的落在画布上。这条同时是「vendor 的 wasm 里有没有这批
  // 模板」的判据——陈旧的产物只会画出一片透明。
  const rgba = preview.renderFrame(1);
  let painted = 0;
  let green = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    painted += 1;
    if (rgba[i + 1] > 100 && rgba[i] < 100) green += 1;
  }
  assert.ok(painted > 0, '模板贴纸一个像素都没画出来 —— vendor 的 wasm 可能是陈旧的');
  assert.ok(green > painted / 3, 'badge_check 的绿底没出来');

  // 未登记的模板 = preset-unknown：一条诊断、零像素（与 CLI 同一条判据）。
  const unknown = OV.planOverlay({
    tracks: [{
      id: 'overlay',
      kind: 'overlay',
      elements: [{
        id: 'nope', kind: 'sticker', start: 0, end: 3,
        place: { x: 50, y: 50, w: 40 },
        sticker: { source: 'template', templateId: 'no-such-template' },
      }],
    }],
    duration: 3,
    isReady: () => true,
  });
  preview.loadTimeline(JSON.stringify(unknown.envelope));
  preview.renderFrame(1);
  assert.ok(
    preview.warnings().some((line) => line.includes('preset-unknown')),
    JSON.stringify(preview.warnings()),
  );
});

test('浏览器侧 fingerprintAt(t) == CLI 冻结的指纹（剪切过的 timeline）', async () => {
  const preview = await loadPreview();
  preview.setCanvasSize(GOLDEN_CANVAS.width, GOLDEN_CANVAS.height);
  preview.setSpectrum('main', new Uint8Array(fs.readFileSync(BCS1)));

  const withProjection = OV.planOverlay({
    tracks: goldenTracks(),
    duration: GOLDEN_DURATION,
    projection: cutProjection(),
    isReady: () => true,
  });
  preview.loadTimeline(JSON.stringify(withProjection.envelope));
  CUT_FINGERPRINTS.forEach(([time, expected]) => {
    assert.strictEqual(preview.fingerprintAt(time), expected, 't=' + time);
  });
  assert.deepStrictEqual(preview.warnings(), []);

  // **反面**：不喂折算表就与冻结串对不上。没有这一条，哪天投影被整个短路掉，
  // 上面那组断言会因为「两边都退化」而继续绿。
  const degraded = OV.planOverlay({
    tracks: goldenTracks(), duration: GOLDEN_DURATION, isReady: () => true,
  });
  preview.loadTimeline(JSON.stringify(degraded.envelope));
  const drifted = CUT_FINGERPRINTS
    .filter(([time, expected]) => preview.fingerprintAt(time) !== expected);
  assert.ok(drifted.length > 0, '不喂投影也处处相同 ⇒ 这条测试没有在测折算');
  // 未剪切的那份 golden 才是退化路径该给的东西（输出时刻即源时刻）。
  GOLDEN_FINGERPRINTS.forEach(([time, expected]) => {
    assert.strictEqual(preview.fingerprintAt(time), expected, '退化路径 t=' + time);
  });
});

test('缺频谱时 wasm 是整帧 fail-fast —— 这正是 deferred 存在的理由', async () => {
  const preview = await loadPreview();
  preview.setCanvasSize(GOLDEN_CANVAS.width, GOLDEN_CANVAS.height);
  // 故意绕开 planOverlay 的 deferred，把没有频谱的 visualizer 塞进去。
  preview.loadTimeline(JSON.stringify({
    duration: GOLDEN_DURATION,
    fps: OV.POSE_FPS,
    timeline: {
      bcutTimeline: '0.2',
      tracks: [{
        id: 'overlay',
        kind: 'overlay',
        elements: [
          { id: 'wave', kind: 'visualizer', start: 0, end: 3, visualizer: { style: 'formation', audio: 'nowhere' } },
          { id: 's1', kind: 'shape', start: 0, end: 3, shape: { shape: 'rect', fill: '#ff0000' } },
        ],
      }],
    },
  }));
  assert.throws(() => preview.fingerprintAt(0.5), (error) => {
    // 报错里指路 setSpectrum，而不是静默给一张少了半张画面的图。
    assert.match(String(error), /setSpectrum/);
    return true;
  });
});

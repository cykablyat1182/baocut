// BaoCut Subtitle Studio — wasm 元素 overlay 的**纯判据层**（无 DOM、无 wasm）。
//
// 设计依据：docs/bcut-element-render-foundation-design.md §9.2 / §9.3 / §10 P6b。
// 接线与副作用在 wasm-overlay.jsx；能单测的东西一律住这里（同 .js/.jsx 分工的
// 既有纪律，见 docs/bcut-studio-web-implementation.md）。
//
// 这一层回答三个问题：
//   1. 这份 timeline 投影里，**哪些元素归 wasm 画**（其余仍归 Konva）；
//   2. 交给 `loadTimeline` 的信封长什么样（严格 schema，多一个键就 400）；
//   3. 每个 visualizer 要哪一条 BCS1，以及那条频谱现在处在拉取状态机的哪一格。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_WASM_OVERLAY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // wasm overlay 当前承担的 kind（设计 §9.3「P6 前半：并存」）。`text` / `image`
  // 要先离屏光栅化再发 DrawMedia（字体系统 / 图片解码器），维持 Konva；`video`
  // 底面仍是 HTMLVideoElement。
  //
  // **`sticker` 按 props 分家**（P7b）：`template` 源是内置模板库的归一化 path，
  // 与 shape 走同一条矢量通路、wasm 画得出；`asset` 源（PNG / JPEG / SVG /
  // 带 alpha 的循环 WebM）要解码器，仍归 Konva。所以 kind 白名单不够，判据是
  // 下面的 `claimsElement`——孪生是 `bcut_timeline_render::push_element` 的
  // 认领规则与 `bcut_wasm::Preview::host_rasterized_elements`，三处必须一致。
  const WASM_KINDS = Object.freeze(['shape', 'sticker', 'visualizer', 'progress']);
  // `StickerProps.source` 的两个面值（`bcut-timeline/src/schema.rs` 的
  // `STICKER_SOURCE_TEMPLATE` / `STICKER_SOURCE_ASSET`）。
  const STICKER_SOURCE_TEMPLATE = 'template';
  const TIMELINE_VERSION = '0.2';
  // `bcut-timeline/src/schema.rs` 的 VISUALIZER_AUDIO_DEFAULT，以及
  // `bcut-timeline-render::visualizer_audio_source` 的换算：缺省的「跟着主音轨
  // 走」落到 source 层就是 `main`。这个换算必须与 Rust 逐字一致 —— 换错了
  // srcId，注进去的频谱就永远配不上元素，wasm 侧只会说「缺频谱」。
  const VISUALIZER_AUDIO_DEFAULT = 'project';
  const VISUALIZER_AUDIO_MAIN = 'main';
  // 姿态量化的 fps。studio 没有 fps 选择器，画布层的 transitionPose 也是硬编
  // 30（canvas-stage.jsx:333），与导出默认同源；两处一起改，别只改一处。
  const POSE_FPS = 30;

  // 交给 `loadTimeline` 的元素字段白名单。`TimelineDocument` 全链路
  // `deny_unknown_fields`，而 studio 手里的投影**比 schema 多几个键**
  // （`projected_tracks` 会往元素上塞 startAnchor / endAnchor / startError /
  // endError）。所以这里不是「删几个已知的脏键」而是「只挑 wasm 真读的那几个」：
  // 前者每加一个投影字段就再坏一次，后者天然免疫。
  // 名单本身来自 `bcut-wasm/src/preview.rs` 的 `ElementDraw` 构造 +
  // `resolve_animation_pose` 的入参 + `load_timeline` 的窗口/可见性判据。
  const ELEMENT_FIELDS = Object.freeze([
    'id', 'kind', 'start', 'end', 'hidden', 'place', 'animate',
    'shape', 'sticker', 'visualizer', 'progress',
  ]);
  // Track 侧同理：`kind` 是必填（TrackKind 枚举），`hidden` 参与可见性。
  const TRACK_FIELDS = Object.freeze(['id', 'kind', 'hidden']);

  // 折算表的字段白名单。名单本身就是 `bcut_timeline::ClipProjection` /
  // `ClipSegment` 的 serde 形态（camelCase）——**不是**在 JS 里另抄一份结构，
  // 而是把服务端算好、`timeline-mapping.js` 归一化过的那张表原样递回去。
  // 与元素白名单同一条理由：`fromStudio` / `buildProjection` 将来多带一个键
  // （黑名单每次都会再坏一次），白名单天然免疫。
  const CLIP_FIELDS = Object.freeze([
    'id', 'srcId', 'sourceIn', 'sourceOut', 'rate',
    'viewIn', 'viewOut', 'timelineStart', 'timelineEnd',
  ]);
  const SEGMENT_FIELDS = Object.freeze(['sourceStart', 'sourceEnd', 'timelineStart', 'timelineEnd']);

  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const isWasmKind = (kind) => WASM_KINDS.indexOf(kind) >= 0;

  /// wasm 画不画这个元素。孪生：`bcut_timeline_render::push_element` 的返回值。
  ///
  /// kind 白名单之外多一道 props 判据，只为 `sticker`：同一个 kind 的两种
  /// `source` 走两条完全不同的通路。判错的代价是对称的两种坏——把 asset 贴纸
  /// 交给 wasm 会让它整个消失（wasm 不认领 ⇒ 一条指令都不发，而 Konva 已经
  /// 因为「归 wasm」不画了）；把 template 贴纸留给 Konva 则只剩占位块。
  function claimsElement(element) {
    if (!element || !isWasmKind(element.kind)) return false;
    if (element.kind !== 'sticker') return true;
    const props = element.sticker;
    return !!props && props.source === STICKER_SOURCE_TEMPLATE;
  }

  /// `visualizer.audio` → BCS1 的 srcId。孪生：
  /// `core/crates/bcut-timeline-render/src/element.rs::visualizer_audio_source`。
  function visualizerAudioSource(props) {
    const audio = props && typeof props.audio === 'string' && props.audio
      ? props.audio
      : VISUALIZER_AUDIO_DEFAULT;
    return audio === VISUALIZER_AUDIO_DEFAULT ? VISUALIZER_AUDIO_MAIN : audio;
  }

  /// `GET <project-prefix>/__bcut/spectrum?src=`。相对项目根，与 media-cache.jsx
  /// 的 `__bcut/waveform` 同基。
  function spectrumURL(srcId) {
    return `__bcut/spectrum?src=${encodeURIComponent(srcId)}`;
  }

  function pick(source, fields) {
    const out = {};
    fields.forEach((field) => {
      const value = source[field];
      if (value !== undefined) out[field] = value;
    });
    return out;
  }

  /**
   * `doc.timelineProjection` → `loadTimeline` 信封里的 `projection`。
   *
   * **为什么必须喂**：`visualizer` 的 BCS1 是按**整条源媒体**算的，而播放头给的
   * 是输出时刻。剪切过的项目里输出第 7 秒可能是源媒体第 12 秒，不折算就会画出
   * 「几秒前的声音」——预览与导出当场分叉（设计 §13 P3「audio:project 的采样
   * 时刻」）。wasm 侧收到这张表后走的是与 CLI **同一份**
   * `clips_timeline_to_source`。
   *
   * `null` = 这份投影里没有可用的 clip 表（wasm 侧随即退化为「输出时刻即源
   * 时刻」，与 P6a 的行为相同）。
   */
  function projectionEnvelope(projection) {
    const clips = projection && Array.isArray(projection.clips) ? projection.clips : null;
    if (!clips || !clips.length) return null;
    const out = [];
    for (const clip of clips) {
      const segments = Array.isArray(clip && clip.segments) ? clip.segments : [];
      if (!segments.length) return null;
      const copy = pick(clip, CLIP_FIELDS);
      copy.segments = segments.map((segment) => pick(segment, SEGMENT_FIELDS));
      out.push(copy);
    }
    return { clips: out };
  }

  /**
   * 把 studio 的 timeline 投影切成「wasm 画的那一半」。
   *
   * @param options.tracks    `doc.timelineProjection.tracks`（元素窗口已是时间轴秒）
   * @param options.projection `doc.timelineProjection`（visualizer 的采样时刻折算表）
   * @param options.duration  整片时长（`resolve_animation_pose` 要读）
   * @param options.fps       姿态量化 fps，缺省 POSE_FPS
   * @param options.isReady   `(srcId) => boolean`，该音频源的 BCS1 是否已注入
   * @returns {{envelope, sources, rendered, deferred, skipped}}
   *   envelope  → `loadTimeline(JSON.stringify(envelope))` 的入参
   *   sources   → 本片需要的全部 BCS1 srcId（去重，含还没就绪的），驱动拉取
   *   rendered  → wasm 会画的元素 id（Konva 因此只给它们留命中盒）
   *   deferred  → 因频谱未就绪被排除的 visualizer 元素 id（这些回落 P0 占位）
   *   skipped   → 因窗口非法被丢弃的元素 id（诊断用，不该在正常项目里出现）
   *
   * **排除只发生在 wasm 画不出来的元素上**，因此不改变留下来那些元素的指令流：
   * `push_element` 对 text / image / video / audio 本来就一条指令都不发
   * （`claimed === false`），排除它们只是让 `host_rasterized_elements()` 变空、
   * `fingerprintAt` 从「报错」变成「可比」。纯矢量项目里两条路的指纹逐位相同。
   */
  function planOverlay(options) {
    const tracks = Array.isArray(options && options.tracks) ? options.tracks : [];
    const duration = finite(options && options.duration) ? options.duration : 0;
    const fps = finite(options && options.fps) && options.fps > 0 ? options.fps : POSE_FPS;
    const isReady = typeof (options && options.isReady) === 'function'
      ? options.isReady
      : () => false;
    const sources = [];
    const rendered = [];
    const deferred = [];
    const skipped = [];
    const outTracks = [];

    tracks.forEach((track) => {
      if (!track || track.hidden === true) return;
      const kept = [];
      (Array.isArray(track.elements) ? track.elements : []).forEach((element) => {
        if (!element || element.hidden === true) return;
        if (!claimsElement(element)) return;
        // 窗口：投影已把词锚点解成秒（解不开时写 null + startError）。非有限值
        // 一律丢弃并记一条 —— wasm 侧也会跳过，但那样只剩一条 warning 字符串，
        // studio 分不清「这个元素归 Konva」和「这个元素的锚点坏了」。
        const start = element.start;
        const end = element.end;
        if (!finite(start) || (end != null && !finite(end))) {
          skipped.push(element.id);
          return;
        }
        const stop = finite(end) ? end : duration;
        if (!(stop > start)) {
          skipped.push(element.id);
          return;
        }
        if (element.kind === 'visualizer') {
          const srcId = visualizerAudioSource(element.visualizer);
          if (sources.indexOf(srcId) < 0) sources.push(srcId);
          // 频谱没就绪就**不进信封**：wasm 的缺频谱是整帧 fail-fast（与 CLI 的
          // read_project_spectrum 同一纪律），一个还在拉的波形不该把整层 overlay
          // 拖黑。这一个元素回落 P0 占位，其余照画。
          if (!isReady(srcId)) {
            deferred.push(element.id);
            return;
          }
        }
        const copy = pick(element, ELEMENT_FIELDS);
        copy.start = start;
        copy.end = stop;
        delete copy.hidden;
        kept.push(copy);
        rendered.push(element.id);
      });
      if (!kept.length) return;
      const outTrack = pick(track, TRACK_FIELDS);
      delete outTrack.hidden;
      if (!outTrack.kind) outTrack.kind = 'overlay';
      outTrack.elements = kept;
      outTracks.push(outTrack);
    });

    const envelope = {
      duration,
      fps,
      timeline: { bcutTimeline: TIMELINE_VERSION, tracks: outTracks },
    };
    // 投影随信封走，不做成第二个 setter：`loadTimeline` 会清元素表与诊断，一个
    // 能活过 loadTimeline 的独立投影插槽意味着「新 timeline + 旧投影」这一格
    // 可达，而那一格画出来是几秒前的声音、还不报错。连带好处是 planKey 天然
    // 把投影算进去——改一刀 cut 就会重新 loadTimeline，不需要第二把钥匙。
    const projection = projectionEnvelope(options && options.projection);
    if (projection) envelope.projection = projection;

    return {
      envelope,
      sources,
      rendered,
      deferred,
      skipped,
    };
  }

  /// 影响 wasm overlay 画面的字段摘要。播放头每帧都变，但元素没变时不该重新
  /// `loadTimeline`（那会清空诊断、重新派生整条频谱轨）。
  function planKey(plan) {
    return JSON.stringify(plan.envelope);
  }

  // ---------- BCS1 拉取状态机 ----------
  // 三态 + 轮询，仿 media-cache.jsx 的 waveform：`GET __bcut/spectrum?src=` 在
  // 缓存未建好时返回 202，客户端按固定间隔重试到上限。与那边的差异只有一处：
  // 波形拿不到就退化成假波形，频谱拿不到只能让那个元素显示占位 —— 绝不"合成"
  // 一条频谱（ADR-E04：注入而非拉取，缺就报错，不代生成）。
  const POLL_MS = 1500;
  const POLL_LIMIT = 90;

  /**
   * @param options.fetchImpl 取字节，`(url) => Promise<Response>`
   * @param options.timer     `(fn, ms) => void`
   * @param options.onChange  任一 srcId 状态变化后调用（整层重画的触发口）
   */
  function createSpectrumStore(options) {
    const config = options || {};
    const fetchImpl = config.fetchImpl
      || ((url) => globalThis.fetch(url, { cache: 'no-store' }));
    const timer = config.timer || ((fn, ms) => globalThis.setTimeout(fn, ms));
    const onChange = config.onChange || (() => {});
    const pollMs = finite(config.pollMs) ? config.pollMs : POLL_MS;
    const pollLimit = finite(config.pollLimit) ? config.pollLimit : POLL_LIMIT;
    const url = config.url || spectrumURL;
    // srcId → { state: 'loading'|'ready'|'unavailable', bytes?, tries }
    const entries = new Map();

    const settle = (srcId, next) => {
      Object.assign(entries.get(srcId), next);
      onChange(srcId);
    };

    function poll(srcId) {
      fetchImpl(url(srcId)).then((response) => {
        const entry = entries.get(srcId);
        if (!entry || entry.state !== 'loading') return undefined;
        if (response.status === 202) {
          entry.tries += 1;
          if (entry.tries > pollLimit) {
            settle(srcId, { state: 'unavailable', reason: 'timeout' });
            return undefined;
          }
          timer(() => poll(srcId), pollMs);
          return undefined;
        }
        if (!response.ok) {
          settle(srcId, { state: 'unavailable', reason: `http-${response.status}` });
          return undefined;
        }
        return response.arrayBuffer().then((buffer) => {
          settle(srcId, { state: 'ready', bytes: new Uint8Array(buffer) });
        });
      }).catch((error) => {
        if (entries.has(srcId)) {
          settle(srcId, { state: 'unavailable', reason: String((error && error.message) || error) });
        }
      });
    }

    return {
      /// 幂等：同一个 srcId 只发一轮轮询。
      request(srcId) {
        if (entries.has(srcId)) return;
        entries.set(srcId, { state: 'loading', tries: 0 });
        poll(srcId);
      },
      /// 一次把 planOverlay 报出来的 sources 全要上。
      requestAll(sources) {
        (sources || []).forEach((srcId) => this.request(srcId));
      },
      state(srcId) {
        const entry = entries.get(srcId);
        return entry ? entry.state : 'idle';
      },
      isReady(srcId) {
        const entry = entries.get(srcId);
        return !!(entry && entry.state === 'ready');
      },
      bytes(srcId) {
        const entry = entries.get(srcId);
        return entry && entry.state === 'ready' ? entry.bytes : null;
      },
      /// 已就绪但还没注进 wasm 的那些（注入是幂等的，这里只记「注过没」）。
      takePending() {
        const out = [];
        entries.forEach((entry, srcId) => {
          if (entry.state === 'ready' && !entry.injected) {
            entry.injected = true;
            out.push({ srcId, bytes: entry.bytes });
          }
        });
        return out;
      },
      /// 诊断：给用户看的一行「波形还在算 / 这条音轨没有频谱」。
      snapshot() {
        const out = {};
        entries.forEach((entry, srcId) => {
          out[srcId] = entry.reason ? `${entry.state}:${entry.reason}` : entry.state;
        });
        return out;
      },
    };
  }

  return {
    WASM_KINDS,
    TIMELINE_VERSION,
    VISUALIZER_AUDIO_DEFAULT,
    POSE_FPS,
    claimsElement,
    ELEMENT_FIELDS,
    TRACK_FIELDS,
    CLIP_FIELDS,
    SEGMENT_FIELDS,
    isWasmKind,
    visualizerAudioSource,
    spectrumURL,
    projectionEnvelope,
    planOverlay,
    planKey,
    createSpectrumStore,
  };
});

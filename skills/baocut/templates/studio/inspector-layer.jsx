// BaoCut Subtitle Studio — 叠加元素检查器 slide-over（原型 app/transform-panel.jsx
// 的 InspectorLayer + app/watermark.jsx 的 WmPane 编辑区，合成一份）。
//
// 层壳与样式层同款（`.vk-stylelayer`、同一个进出动画、同一个 pane 位置），三层互斥由
// store 的 openStyle / openInspector / openWatermark 保证。选中一个元素就打开这里
// （原型：选中 broll/el → inspector；原型的画布标题走样式面板，Studio 没有「标题」
// 这种独立对象，文本元素统一进检查器）。
//
// 分区顺序对两个层是**同一份组件**（水印层复用 ElementEditor，不复制一套）：
//   内容 → 时间 → 变换 → 位置 → 文字样式 → 平铺 → 删除
// 原型把「不透明度 / 大小」放在水印面板的 Appearance、把「缩放 / 旋转」放在检查器的
// Transform；Studio 的元素只有一套几何（place），所以合成一个「变换」分区，水印与
// 普通元素看到的是同一组控件。平铺只对 role=watermark 显示（烧录端只有水印在用它）。
//
// 写路径：全部 `app.patchElementLive(element, set)` —— 本地草稿即时预览 + 400ms 合并
// 成一条 patchElement 事务（store.jsx）。所以拖一次滑块只占一步撤销，画布也跟手。
// **数值字段不传 base**：几何补丁语义是「后写者胜」（element-ops.js movePlace 的注释
// 解释了为什么这条链路上的 CAS 不划算）；文字走 setElementText 的字符串 CAS。
(() => {
const { useEffect, useMemo, useRef, useState } = React;
const { Ic, QBtn, Segmented, useApp, useEsc } = window;
const TS = window.BCS_TEXT_STYLE;
if (!TS) throw new Error('text-style-controls.jsx failed to load');
const { SpSect, SpRow, SpSlider, SpSwitchRow, TextStyleControls } = TS;
const ET = window.BCS_ELEMENT_TIME;
if (!ET) throw new Error('element-time.js failed to load');
const EG = window.BCS_ELEMENT_GEOMETRY;
const EOPS = window.BCS_ELEMENT_OPS;
const T = window.BCS_TIMELINE;

const DEF = (EG && EG.DEFAULTS) || {};
const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const placeOf = (element) => (element && element.place) || {};
// 元素文字号的可用区间：水印默认 20、文本元素默认 41，两端留够余量。
const SIZE_MIN = 10;
const SIZE_MAX = 96;

// 层头部与提示里的称呼（与 element-ops.js elementLabel 同一套词：那边是真相，
// 这里只多一个图标）。
const KIND_ICONS = { text: 'text-lines', image: 'image' };

function elementMeta(element) {
  const label = EOPS ? EOPS.elementLabel(element) : '元素';
  if (!element) return { icon: 'properties', title: label, label };
  if (element.role === 'watermark') return { icon: 'layers', title: label, label };
  return { icon: KIND_ICONS[element.kind] || 'properties', title: label, label };
}

// ---------- 内容 ----------
// 文本：多行框，失焦或 ⌘/Ctrl+Enter 提交（字符串 base CAS 走 setElementText）。
// 换行是内容的一部分（几何内核按 \n 断行），所以 Enter 不提交。
function ElTextContent({ element }) {
  const app = useApp();
  const value = element.text == null ? '' : element.text;
  const [draft, setDraft] = useState(null);
  const escaped = useRef(false);
  // 服务端/其它入口（画布双击）改了文字时，未编辑的框跟着更新。
  useEffect(() => { setDraft(null); }, [value]);
  const commit = () => {
    const next = draft;
    setDraft(null);
    if (escaped.current) { escaped.current = false; return; }
    if (next == null || next === value) return;
    app.setElementText(element, next);
  };
  return (
    <React.Fragment>
      <textarea className="vk-input bcs-elp__text" value={draft == null ? value : draft}
        aria-label="元素文字" spellCheck={false} rows={3} placeholder={EOPS ? EOPS.TEXT_PLACEHOLDER : '输入文字'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { escaped.current = true; event.target.blur(); }
          else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.target.blur();
        }} />
      <div className="vk-sp__hint">换行会照样画在画面上；也可以在画面上双击这个元素直接改。</div>
    </React.Fragment>
  );
}

// 图片：预览 + 换图（新 source + 改 srcId，旧图撤销一步就回来）。
function ElImageContent({ element }) {
  const app = useApp();
  const fileRef = useRef(null);
  const url = T && element.srcId ? T.mediaURL(element.srcId) : null;
  return (
    <React.Fragment>
      <div className="bcs-elp__imgprev">
        {url ? <img src={url} alt="" /> : <span className="vk-sp__rowsub">这个元素还没有引用图片</span>}
      </div>
      <div className="bcs-elp__addrow">
        <button type="button" className="s2-btn s2-btn--S s2-btn--secondary"
          onClick={() => fileRef.current && fileRef.current.click()}>
          <Ic name="image" size={13} />替换图片…
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }} aria-hidden="true" tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files && event.target.files[0];
          event.target.value = '';
          if (file) app.replaceElementImage(element, file);
        }} />
    </React.Fragment>
  );
}

// 模板贴纸（P7c）：两个旋钮，都不是颜色 —— 换哪份模板，以及动态贴纸播完怎么办。
// `StickerProps` 没有 fill / stroke（§13 P7b-core 定案二），所以这里**没有色板**：
// 给一个渲染器会忽略的控件，比不给更糟。
//
// `loop` 只对**动态**贴纸（资产是 alpha WebM）有意义，静态模板每帧都一样；文档里
// 已经写了 loop 的元素照样回显，切换也照样写回 —— 那是用户的字段，不是我们的。
function ElStickerContent({ element }) {
  const app = useApp();
  const props = (element.sticker && typeof element.sticker === 'object') ? element.sticker : {};
  const source = EG.stickerSource(props) || 'template';
  const templateId = props.templateId;
  const recipe = EG.stickerRecipe(templateId);
  const loop = EG.stickerLoop(props);
  const write = (patch) => app.patchElement(element, { sticker: { ...props, ...patch } },
    { label: '修改贴纸 ' + element.id });
  const loopRow = (
    <SpRow label="循环">
      <Segmented size="S" value={loop} onChange={(value) => write({ loop: value })}
        options={[
          { value: 'loop', label: '循环' },
          { value: 'once', label: '播一遍' },
          { value: 'hold', label: '定格首帧' },
        ]} />
    </SpRow>
  );
  if (source !== 'template') {
    return (
      <React.Fragment>
        <div className="vk-sp__hint">导入的贴纸自带画面，换图请用上面的按钮。</div>
        {loopRow}
      </React.Fragment>
    );
  }
  return (
    <React.Fragment>
      <div className="bcs-stk__current">
        <window.StickerSwatch recipe={recipe} size={32} />
        <span className="bcs-stk__currentname">
          {recipe ? recipe.name : (templateId || '未选模板')}
          {/* 文档可能引用这份构建没有的模板（CLI 或更新的版本写的）。如实说，
              而不是悄悄把用户的贴纸改成别的一份。 */}
          {recipe ? null : <span className="bcs-stk__currentsub">这份构建的模板库里没有它</span>}
        </span>
      </div>
      <window.StickerGrid selected={templateId}
        onPick={(id) => write({ source: 'template', templateId: id })} />
      {loopRow}
      <div className="vk-sp__hint">贴纸自带配色 —— 想换颜色就换一份模板。</div>
    </React.Fragment>
  );
}

// core 0.2 的其余新 kind（shape / visualizer / progress）在 studio 还没有属性面板
// （设计 §10 的 P3 只给 gpui 与 Mac 排了这项）。这里如实说一句，而**不是**掉进
// 文本分支给一个改不了任何东西的文本框 —— 那正是"不是 image 就当 text"的老毛病。
function ElUnsupportedContent({ element }) {
  const detail = element.kind === 'shape' && element.shape ? '（' + element.shape.shape + '）' : '';
  const label = EOPS ? EOPS.elementLabel(element) : '元素';
  return (
    <div className="vk-sp__hint">
      {label + detail}的样式属性还没有面板，请在 Mac App 里编辑；这里可以改时间、位置与变换。
    </div>
  );
}

function ElContentSect({ element, first }) {
  // 显式分派 + 明确兜底，与 elements-stage.jsx 的 buildElement 同一条纪律。
  const content = (() => {
    if (element.kind === 'text') return <ElTextContent element={element} />;
    // 资产贴纸就是一张图，换图那套直接可用 —— 再补上贴纸自己的两个旋钮。
    if (element.kind === 'sticker' && element.srcId) {
      return (
        <React.Fragment>
          <ElImageContent element={element} />
          <ElStickerContent element={element} />
        </React.Fragment>
      );
    }
    if (element.kind === 'image') return <ElImageContent element={element} />;
    // 模板贴纸没有 srcId：模板网格 + 循环（P7c）。
    if (element.kind === 'sticker') return <ElStickerContent element={element} />;
    return <ElUnsupportedContent element={element} />;
  })();
  return <SpSect title="内容" first={first}>{content}</SpSect>;
}

// ---------- 时间 ----------
// 时间字段：m:ss.s（也接受纯秒），↑/↓ 步 0.1 秒，Esc 还原。
function ElTimeField({ value, disabled, ariaLabel, onCommit }) {
  const [draft, setDraft] = useState(null);
  const escaped = useRef(false);
  const shown = ET.formatTime(value);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (escaped.current) { escaped.current = false; return; }
    if (text == null) return;
    const parsed = ET.parseTime(text);
    if (parsed != null) onCommit(parsed);
  };
  const nudge = (dir) => {
    const base = draft != null ? ET.parseTime(draft) : null;
    setDraft(null);
    onCommit((base == null ? value : base) + dir * 0.1);
  };
  return (
    <input className="vk-input vk-mono bcs-elp__tc" value={draft == null ? shown : draft}
      aria-label={ariaLabel} disabled={disabled} spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') event.target.blur();
        else if (event.key === 'Escape') { escaped.current = true; event.target.blur(); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); nudge(1); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(-1); }
      }} />
  );
}

// 双把手范围滑块（原型 WmRange）：拖把手动一端，拖中段整段平移。拖动期间只写草稿，
// 事务由 store 的 400ms 合并写发出去。
function ElRange({ element, duration, disabled, onChange }) {
  const ref = useRef(null);
  const span = ET.windowOf(element, duration);
  const pct = (t) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);
  const timeAt = (clientX) => {
    const box = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration));
  };
  const startDrag = (which) => (event) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const from = timeAt(event.clientX);
    // 中段整体平移是**累计**位移，所以基准必须是按下那一刻的窗口快照；拿逐帧更新的
    // element 去加同一个累计量，一次拖动会越拖越快。两个把手是绝对定位，无此问题。
    const snapshot = { start: span.start, end: span.end };
    const move = (moveEvent) => {
      const to = timeAt(moveEvent.clientX);
      if (which === 'start') onChange(ET.startPatch(element, to, duration));
      else if (which === 'end') onChange(ET.endPatch(element, to, duration));
      else onChange(ET.movedSpan(snapshot, to - from, duration));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const left = pct(span.start);
  const width = pct(span.end) - left;
  return (
    <div className={'bcs-elp__range' + (disabled ? ' bcs-elp__range--dis' : '')} ref={ref}>
      <div className="bcs-elp__rangefill" style={{ left: left + '%', width: width + '%' }}></div>
      <div className="bcs-elp__rangemid" style={{ left: left + '%', width: width + '%' }}
        onPointerDown={startDrag('range')}></div>
      <div className="bcs-elp__rangeh" style={{ left: left + '%' }} onPointerDown={startDrag('start')}></div>
      <div className="bcs-elp__rangeh" style={{ left: (left + width) + '%' }} onPointerDown={startDrag('end')}></div>
    </div>
  );
}

function ElTimingSect({ element, duration, patch }) {
  const app = useApp();
  const whole = ET.isWholeVideo(element, duration);
  const span = ET.windowOf(element, duration);
  const playhead = () => Math.round(((app.playerRef.current || {}).t || 0) * 10) / 10;
  return (
    <SpSect title="时间">
      <SpSwitchRow label="整片" sub="从头到尾都显示" checked={whole}
        tip="关掉可以给它一个出现区间"
        onChange={(on) => patch(ET.wholePatch(on, duration), '改元素窗口')} />
      <ElRange element={element} duration={duration} disabled={whole}
        onChange={(next) => patch(next, '改元素窗口')} />
      <div className="bcs-elp__times">
        <span className="vk-sp__lab">开始</span>
        <ElTimeField value={span.start} disabled={whole} ariaLabel="开始时间"
          onCommit={(seconds) => patch(ET.startPatch(element, seconds, duration), '改元素窗口')} />
        <QBtn icon="clock" size="XS" tip="取播放头" disabled={whole}
          onClick={() => patch(ET.startPatch(element, playhead(), duration), '改元素窗口')} />
        <span className="vk-sp__lab">结束</span>
        <ElTimeField value={span.end} disabled={whole} ariaLabel="结束时间"
          onCommit={(seconds) => patch(ET.endPatch(element, seconds, duration), '改元素窗口')} />
        <QBtn icon="clock" size="XS" tip="取播放头" disabled={whole}
          onClick={() => patch(ET.endPatch(element, playhead(), duration), '改元素窗口')} />
      </div>
      {whole ? null : (
        <div className="vk-sp__hint">最短 {ET.MIN_SPAN} 秒；播放头在区间外时画面上看不到它，列表里还在。</div>
      )}
    </SpSect>
  );
}

// ---------- 变换 ----------
// place 深合并（服务端 merge_patch 递归合并对象），所以每次只写改动的那一维。
function ElTransformSect({ element, patch }) {
  const place = placeOf(element);
  const isImage = element.kind === 'image';
  const isText = element.kind === 'text';
  // 圆角与填充方式只对真正走媒体路径的元素有意义（资产贴纸也走那条路）；
  // 垂直锚点只对文本有意义。新 kind 两者都不给，而不是默认落进文本那一支。
  const isMedia = isImage || (element.kind === 'sticker' && !!element.srcId);
  const geom = (next) => patch({ place: next }, '改元素几何');
  const widthDefault = isText
    ? Math.round((DEF.textWidthRatio || 0.9) * 100)
    : (isImage ? DEF.imageWidthPct : (EG ? EG.DEFAULT_ELEMENT_W : 20));
  return (
    <SpSect title="变换">
      <SpSlider label={isText ? '折行宽度' : '宽度'} value={num(place.w, widthDefault)} min={4} max={100}
        onChange={(v) => geom({ w: v })} fmtV={(v) => v + '%'}
        hint={isText ? '文字超过这个宽度就折行' : '占画面宽度的百分比，高度按元素自身比例'} />
      <SpSlider label="缩放" value={num(place.scale, DEF.scale == null ? 1 : DEF.scale)} min={0.1} max={4} step={0.05}
        onChange={(v) => geom({ scale: v })} fmtV={(v) => v.toFixed(2) + '×'} />
      <SpSlider label="旋转" value={num(place.rot, 0)} min={-180} max={180}
        onChange={(v) => geom({ rot: v })} fmtV={(v) => v + '°'} />
      <SpSlider label="不透明度" value={Math.round(num(place.opacity, 1) * 100)} min={0} max={100} step={5}
        onChange={(v) => geom({ opacity: v / 100 })} fmtV={(v) => v + '%'} />
      {isMedia ? (
        <SpSlider label="圆角" value={num(place.radius, 0)} min={0} max={80}
          onChange={(v) => geom({ radius: v })}
          hint="以短边 540 为参考单位换算，与烧录端同一口径" />
      ) : null}
      {isMedia ? (
        <SpRow label="填充" fill>
          <Segmented stretch size="S" value={element.fit === 'contain' ? 'contain' : 'cover'}
            onChange={(v) => patch({ fit: v }, '改元素填充')}
            options={[{ value: 'cover', label: '裁切填满' }, { value: 'contain', label: '完整放入' }]} />
        </SpRow>
      ) : null}
      {isText ? (
        <React.Fragment>
          <SpRow label="垂直锚点" fill>
            <Segmented stretch size="S"
              value={(EG && EG.verticalAlignValue(element.verticalAlign)) || 'center'}
              onChange={(v) => patch({ verticalAlign: v }, '改元素锚点')}
              options={[{ value: 'top', label: '顶边' }, { value: 'center', label: '中心' }, { value: 'bottom', label: '底边' }]} />
          </SpRow>
          <div className="vk-sp__hint">垂直位置钉住文字块的这条边，折行时往另一边生长。</div>
        </React.Fragment>
      ) : null}
    </SpSect>
  );
}

// ---------- 位置 ----------
// 数值框 + 六格对齐（原型 TfPosition 的九宫 = 水平三格 + 垂直三格）。原型的读数是
// 1920 参考像素，Studio 的元素几何本来就是百分比（render_plan.rs 直接吃 x/y%），
// 换算成像素再换回去只会引入两次取整误差，所以这里直接显示百分比。
function ElNum({ label, value, onCommit }) {
  const [draft, setDraft] = useState(null);
  const escaped = useRef(false);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (escaped.current) { escaped.current = false; return; }
    if (text == null) return;
    const parsed = parseFloat(String(text).replace(',', '.').replace(/[^0-9.+-]/g, ''));
    if (!Number.isNaN(parsed)) onCommit(parsed);
  };
  const nudge = (dir) => {
    const base = draft != null && !Number.isNaN(parseFloat(draft)) ? parseFloat(draft) : value;
    setDraft(null);
    onCommit(base + dir);
  };
  return (
    <label className="vk-tf__num">
      <span className="vk-tf__numlab">{label}</span>
      <input className="vk-mono" value={draft == null ? String(Math.round(value * 10) / 10) : draft}
        aria-label={label} spellCheck={false}
        onFocus={() => setDraft(String(Math.round(value * 10) / 10))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') event.target.blur();
          else if (event.key === 'Escape') { escaped.current = true; event.target.blur(); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); nudge(1); }
          else if (event.key === 'ArrowDown') { event.preventDefault(); nudge(-1); }
        }} />
    </label>
  );
}

const ALIGN_CELLS = [
  ['al', 'left', '靠左'], ['ac', 'center', '水平居中'], ['ar', 'right', '靠右'],
  ['at', 'top', '靠上'], ['am', 'middle', '垂直居中'], ['ab', 'bottom', '靠下'],
];

function ElPositionSect({ element, patch, ratio }) {
  const place = placeOf(element);
  const x = num(place.x, DEF.x == null ? 50 : DEF.x);
  const y = num(place.y, DEF.y == null ? 50 : DEF.y);
  const geom = (next) => patch({ place: next }, '移动元素');
  // 钳制范围取 Mac 的那一档（ElementInspectorView 的 clamp：-40…140）：一个自由元素
  // 允许挂在画面外一部分，比字幕的 3…97 松得多，这是刻意的。
  const clamp = (value) => Math.max(-40, Math.min(140, Math.round(value * 10) / 10));
  return (
    <SpSect title="位置">
      <div className="vk-sp__row vk-tf__posrow">
        <span className="vk-sp__lab">位置 %</span>
        <div className="vk-tf__nums">
          <ElNum label="X" value={x} onCommit={(v) => geom({ x: clamp(v) })} />
          <ElNum label="Y" value={y} onCommit={(v) => geom({ y: clamp(v) })} />
        </div>
      </div>
      <div className="vk-sp__row vk-tf__alignrow">
        <span className="vk-sp__lab">对齐</span>
        <div className="vk-tf__aligns">
          {ALIGN_CELLS.map(([cls, cell, tip]) => (
            <button key={cls} type="button" className={'vk-tf__align vk-tf__align--' + cls}
              data-tip={tip} aria-label={tip}
              onClick={() => geom(ET.alignPlace(cell, element, ratio))}></button>
          ))}
        </div>
      </div>
      <div className="vk-sp__hint">X/Y 是锚点在画面里的百分比；也可以在画面上直接拖这个元素。</div>
    </SpSect>
  );
}

// ---------- 平铺 ----------
// 只对水印显示：烧录端只有水印在铺（render_plan 的 tile 分支），给普通元素一个开关
// 等于宣传一个不存在的效果。补丁必须**每次都带 on** —— Tile 的 `on` 在 schema 里不是
// Option，缺了它反序列化直接失败（服务端是 serialize → merge → deserialize）。
function ElTilingSect({ element, patch }) {
  const tile = element.tile || {};
  const on = !!tile.on;
  const set = (next) => patch({ tile: { on: true, ...next } }, '改水印平铺');
  return (
    <SpSect title="平铺" aside="防盗录">
      <SpSwitchRow label="铺满画面" sub="把水印重复铺在整幅画面上" checked={on}
        onChange={(next) => patch({ tile: { ...tile, on: next } }, '改水印平铺')} />
      {on ? (
        <React.Fragment>
          <SpSlider label="角度" value={num(tile.angle, DEF.tileAngle)} min={-90} max={90}
            onChange={(v) => set({ angle: v })} fmtV={(v) => v + '°'} />
          <SpSlider label="横向间距" value={num(tile.gapX, DEF.tileGapX)} min={2} max={40}
            onChange={(v) => set({ gapX: v })} fmtV={(v) => v + '%'} />
          <SpSlider label="纵向间距" value={num(tile.gapY, DEF.tileGapY)} min={2} max={40}
            onChange={(v) => set({ gapY: v })} fmtV={(v) => v + '%'} />
          <SpSwitchRow label="错开行" sub="奇数行横向错开半格" checked={tile.stagger !== false}
            onChange={(next) => set({ stagger: next })} />
          <div className="vk-sp__hint">平铺时画面上的那个可选中的印章就是它的锚点，大小仍由「宽度」决定。</div>
        </React.Fragment>
      ) : null}
    </SpSect>
  );
}

// ---------- 一个元素的全部分区（检查器与水印层共用） ----------
function ElementEditor({ element, first }) {
  const app = useApp();
  const duration = (app.doc && app.doc.meta && app.doc.meta.duration) || 0;
  const isText = element.kind === 'text';
  const isWatermark = element.role === 'watermark';
  // 画面宽高比：九宫的垂直贴边要按它把半宽换成半高。舞台按 16:9 画（ratio 'Original'）。
  const ratio = 16 / 9;
  const patch = (set, label) => app.patchElementLive(element, set, { label });
  const setStyle = (stylePatch) => patch({ style: stylePatch }, '改元素样式');
  return (
    <React.Fragment>
      <ElContentSect element={element} first={first} />
      <ElTimingSect element={element} duration={duration} patch={patch} />
      <ElTransformSect element={element} patch={patch} />
      <ElPositionSect element={element} patch={patch} ratio={ratio} />
      {isText ? (
        <TextStyleControls st={element.style || {}} set={setStyle} sizeMin={SIZE_MIN} sizeMax={SIZE_MAX} />
      ) : null}
      {isWatermark ? <ElTilingSect element={element} patch={patch} /> : null}
    </React.Fragment>
  );
}

// ---------- 层壳 ----------
// 常挂载（CSS 过渡需要一个一直在场的对象），关着的时候 inert 退出交互与 tab 序，
// 内容只在打开时渲染 —— 与样式层同构。
function InspectorLayer() {
  const app = useApp();
  const open = !!app.inspectorOpen;
  const closeRef = useRef(null);
  // 选中已经走开、而关层的状态更新还没落地的那一帧：什么都不渲染（原型
  // InspectorLayer.canRender 同款守卫）。
  const element = useMemo(
    () => (app.sel && app.sel.kind === 'el' ? app.findElement(app.sel.id) : null),
    [app.sel, app.findElement, app.doc && app.doc.timelineProjection],
  );
  const meta = elementMeta(element);
  useEsc(app.closeInspector, open);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  return (
    <div className={'vk-stylelayer' + (open ? ' vk-stylelayer--open' : '')}
      role="region" aria-label={meta.title} inert={open ? undefined : ''}
      data-screen-label="Element inspector">
      <div className="vk-stylelayer__head">
        <Ic name={meta.icon} size={16} />
        <span className="vk-stylelayer__title">{meta.title}</span>
        <QBtn refEl={closeRef} icon="close" size="S" tip="关闭（Esc）" onClick={app.closeInspector} />
      </div>
      {open && element ? (
        <React.Fragment>
          <div className="vk-sp__scroll">
            <ElementEditor element={element} first />
          </div>
          <div className="vk-sp__savebar">
            <span className="vk-sp__savebar__cur">
              <b>{meta.label}</b><i> · {element.id}</i>
            </span>
            {/* 先把待写的草稿冲出去再删：两条都排在同一个事务队列上，顺序因此是
                「改完 → 删掉」；否则那条 400ms 的补丁会落在一个已经不存在的元素上，
                换来一条红色的保存失败。 */}
            <button className="s2-btn s2-btn--S s2-btn--negative" data-tip="从画面上删掉这个元素（可撤销）"
              onClick={() => { app.flushElementDraft(); app.removeElement(element); }}>
              <Ic name="delete" size={13} />删除{meta.label}
            </button>
          </div>
        </React.Fragment>
      ) : null}
    </div>
  );
}

window.InspectorLayer = InspectorLayer;
window.BCS_ELEMENT_PANELS = {
  ElContentSect, ElTimingSect, ElTransformSect, ElPositionSect, ElTilingSect,
  ElementEditor, ElRange, ElTimeField, elementMeta, SIZE_MAX, SIZE_MIN,
};
})();

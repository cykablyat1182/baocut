// BaoCut Subtitle Studio — 贴纸选择器（设计 §10 P7 的 P7c）。
//
// 两个用处，同一个网格：传输条「添加 → 贴纸…」开的浮层，和检查器里给已选贴纸
// 换模板的那一段。
//
// **为什么格子是配色示意而不是缩略图**：模板贴纸的几何是一叠归一化轮廓点列，
// 它只存在于渲染端。设计明令浏览器不手抄那张表（§13 P7a 偏离6；P7b/P7c 的两个
// 生成器只出 apps/mac 与 designs/baocut-mac 两份源文件），因为 studio 的元素像素
// 自 P6b 起就由 wasm overlay 出——与导出**同一份光栅器**。抄一份点列进来，等于给
// 「预览 = 导出」再开一个会漂移的口子，换来的只是一个 44px 的小图。
//
// 于是格子给三样能从注册表列拿到、不会说谎的东西：名字、层数、配色。真图在**画布
// 上**，选完立刻就能看见——浮层贴着画布开，落一个贴纸到看见它之间只隔一次点击。
//
// 贴纸的配色属于模板本身（`StickerProps` 没有 fill / stroke，改色 = 换模板，
// §13 P7b-core 定案二），所以这些色块是「你会得到什么」，不是控件。它们是**导出
// 内容**的颜色，按 CLAUDE.md 的渲染内容豁免保持字面 hex。
(() => {
const { Pop, Ic } = window;
const EG = window.BCS_ELEMENT_GEOMETRY;

// 一份模板的配色示意：主色作底，第二色作内点（只有一色的模板就只有底）。
function StickerSwatch({ recipe, size = 40 }) {
  const colors = (recipe && recipe.colors) || [];
  const inner = Math.round(size * 0.38);
  return (
    <span className="bcs-stk__art" style={{ width: size, height: size, background: colors[0] || '#8A8A8A' }}
      aria-hidden="true">
      {colors[1] ? (
        <span className="bcs-stk__dot" style={{ width: inner, height: inner, background: colors[1] }}></span>
      ) : null}
    </span>
  );
}

function StickerGrid({ selected, onPick }) {
  const rows = EG ? EG.stickerRecipes() : [];
  return (
    <div className="bcs-stk__grid" role="listbox" aria-label="贴纸模板">
      {rows.map((recipe) => (
        <button key={recipe.id} type="button" role="option"
          aria-selected={recipe.id === selected}
          className={'bcs-stk__tile' + (recipe.id === selected ? ' bcs-stk__tile--sel' : '')}
          title={recipe.name + ' · ' + recipe.layers + ' 层'}
          onClick={() => onPick(recipe.id)}>
          <StickerSwatch recipe={recipe} />
          <span className="bcs-stk__name">{recipe.name}</span>
        </button>
      ))}
    </div>
  );
}

// 传输条上的浮层。`asset` 源（导入 PNG / SVG，或转码成 alpha WebM 的动图）走
// `bcut sticker` + putSource 那条流程，Web 这边还没有入口——**显式禁用而不是不画**，
// 藏起来会让人以为内置库就是全部。
function StickerPicker({ anchorRef, onClose, onPick }) {
  return (
    <Pop anchorRef={anchorRef} onClose={onClose} dir="up" align="start" width={272}
      className="bcs-stk">
      <div className="bcs-stk__head">贴纸</div>
      <StickerGrid selected={null} onPick={(id) => { onClose(); onPick(id); }} />
      <div className="bcs-stk__hint">色块是这份模板的配色；真图落到画面上就能看见。</div>
      <button type="button" className="bcs-stk__import" disabled>
        <Ic name="image" size={16} />
        <span className="bcs-stk__importlbl">
          <span>导入贴纸…</span>
          <span className="bcs-stk__importsub">PNG、SVG 或动图 —— 先用 bcut sticker 转码</span>
        </span>
      </button>
    </Pop>
  );
}

Object.assign(window, { StickerSwatch, StickerGrid, StickerPicker });
})();

const test = require('node:test');
const assert = require('node:assert');
const X = require('./export-text.js');

// ---------- 文件名 ----------

test('slug 与 Mac ExportBuilders.slug 同规则', () => {
  assert.equal(X.slug('How IT Admins can manage ChatGPT Work at scale | OpenAI'),
    'how-it-admins-can-manage-chatgpt-work-at-scale-openai');
  assert.equal(X.slug('  中文 标题 '), '中文-标题');
  assert.equal(X.slug('***'), 'untitled');
  assert.equal(X.slug(''), 'untitled');
});

test('languageCode 规范化标签并保留 ja→jp 别名', () => {
  assert.equal(X.languageCode('en'), 'en');
  assert.equal(X.languageCode('ja'), 'jp');
  assert.equal(X.languageCode('ja-JP'), 'jp');
  assert.equal(X.languageCode('zh-hans'), 'zh-Hans');
  assert.equal(X.languageCode('pt_br'), 'pt-BR');
  assert.equal(X.languageCode(''), 'und');
  assert.equal(X.languageCode('auto'), 'und');
  assert.equal(X.languageCode('English'), 'und');
});

test('languageTag 跟着产物真正装了什么走', () => {
  assert.equal(X.languageTag('orig', 'en', 'zh-Hans'), 'en');
  assert.equal(X.languageTag('trans', 'en', 'zh-Hans'), 'zh-Hans');
  assert.equal(X.languageTag('bi', 'en', 'zh-Hans'), 'en-zh-Hans');
});

test('filename / videoFilename 分隔符与 Mac 一致', () => {
  assert.equal(X.filename('My Talk', 'en', 'srt'), 'my-talk-en.srt');
  assert.equal(X.filename('My Talk', '', 'md'), 'my-talk.md');
  assert.equal(X.videoFilename('My Talk', 'en-zh'), 'my-talk en-zh.mp4');
  assert.equal(X.videoFilename('My Talk', ''), 'my-talk.mp4');
});

// ---------- fixture ----------

const doc = {
  meta: {
    title: 'Demo',
    sourceLang: { code: 'en' },
    targetLang: { code: 'zh-Hans' },
  },
  speakers: { s1: { name: 'Maya' }, s2: { name: '' } },
  chapters: [
    { id: 'c0', title: '开场', start: 0, end: 10 },
    { id: 'c1', title: '正题', start: 10, end: 30 },
  ],
  cues: [
    { id: 'q1', sp: 's1', start: 1, end: 2.5, text: 'Hello there', paraId: 'p1', words: [{}, {}] },
    { id: 'q2', sp: 's1', start: 2.5, end: 4, text: 'and welcome', paraId: 'p1', words: [{}, {}] },
    { id: 'q3', sp: 's2', start: 12, end: 14, text: 'Second part', paraId: 'p2', words: [{}, {}] },
  ],
  transCues: [
    { id: 't1', sid: 's-1', sp: 's1', start: 1, end: 4, text: '你好，欢迎' },
  ],
  sentences: [
    { id: 's-1', paraId: 'p1', start: 1, end: 4, text: 'Hello there and welcome', trans: '你好，欢迎' },
    { id: 's-2', paraId: 'p2', start: 12, end: 14, text: 'Second part', trans: '' },
  ],
};

const paras = [
  { id: 'p1', paraId: 'p1', sp: 's1', ch: 0, start: 1, end: 4,
    text: 'Hello there and welcome', cues: [doc.cues[0], doc.cues[1]] },
  { id: 'p2', paraId: 'p2', sp: 's2', ch: 1, start: 12, end: 14,
    text: 'Second part', cues: [doc.cues[2]] },
];

// ---------- 说话人 ----------

test('speakersOn 只在文档真有两位以上说话人时为真', () => {
  assert.equal(X.speakersOn(doc, true), true);
  assert.equal(X.speakersOn(doc, false), false);
  assert.equal(X.speakersOn({ speakers: { s1: { name: 'A' } } }, true), false);
  assert.equal(X.speakersOn({}, true), false);
});

test('speakerName 空名字退回 Speaker', () => {
  assert.equal(X.speakerName(doc, 's1'), 'Maya');
  assert.equal(X.speakerName(doc, 's2'), 'Speaker');
  assert.equal(X.speakerName(doc, 'nope'), 'Speaker');
});

// ---------- 段落译文 ----------

test('paragraphTranslations 按 paraId 分桶，CJK 目标语不加空格', () => {
  assert.deepEqual(X.paragraphTranslations(doc, paras), ['你好，欢迎', '']);
});

test('paragraphTranslations 缺 paraId 时退回 cueId 归属', () => {
  const d = { ...doc, sentences: [{ id: 's-1', cueIds: ['q3'], start: 12, end: 14, trans: '第二段' }] };
  assert.deepEqual(X.paragraphTranslations(d, paras), ['', '第二段']);
});

// ---------- Markdown ----------

test('markdown 原文：标题 + 时间戳 + 说话人 + 章节', () => {
  const out = X.markdown(doc, paras, {
    title: 'Demo', content: 'orig', speakers: true, timestamps: true, chapters: true,
  });
  assert.equal(out, [
    '# Demo',
    '',
    '## 开场',
    '',
    '[00:01] **Maya:** Hello there and welcome',
    '',
    '## 正题',
    '',
    '[00:12] **Speaker:** Second part',
    '',
  ].join('\n'));
});

test('markdown 关掉三个开关只剩正文', () => {
  const out = X.markdown(doc, paras, { title: 'Demo', content: 'orig' });
  assert.equal(out, '# Demo\n\nHello there and welcome\n\nSecond part\n');
});

test('markdown 双语把译文另起一段放在原文下面；没有译文的段只有原文', () => {
  const out = X.markdown(doc, paras, { title: 'Demo', content: 'bi', timestamps: true });
  assert.equal(out, [
    '# Demo',
    '',
    '[00:01] Hello there and welcome',
    '',
    '你好，欢迎',
    '',
    '[00:12] Second part',
    '',
  ].join('\n'));
});

test('markdown 译文单语丢掉没有译文的整段，章节标题跟着下一个活下来的段落', () => {
  const out = X.markdown(doc, paras, { title: 'Demo', content: 'trans', chapters: true });
  assert.equal(out, '# Demo\n\n## 开场\n\n你好，欢迎\n');
});

test('wordCount 数的是源 Cue 的词', () => {
  assert.equal(X.wordCount(doc), 6);
});

// ---------- 字幕 ----------

test('subtitleEvents 原文一条 Cue 一事件', () => {
  const events = X.subtitleEvents(doc, { content: 'orig' });
  assert.equal(events.length, 3);
  assert.deepEqual(events[0].lines, ['Hello there']);
});

test('subtitleEvents 双语按源 Cue 中点配对译文行', () => {
  const events = X.subtitleEvents(doc, { content: 'bi' });
  assert.deepEqual(events[0].lines, ['Hello there', '你好，欢迎']);
  assert.deepEqual(events[1].lines, ['and welcome', '你好，欢迎']);
  assert.deepEqual(events[2].lines, ['Second part']);   // 没有覆盖它的译文片
});

test('subtitleEvents 译文单语走译文自己的展示流', () => {
  const events = X.subtitleEvents(doc, { content: 'trans' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { start: 1, end: 4, sp: 's1', lines: ['你好，欢迎'] });
});

test('missingTranslations 双语数缺第二行的 Cue，译文单语数没有译文的句子', () => {
  assert.equal(X.missingTranslations(doc, 'bi'), 1);
  assert.equal(X.missingTranslations(doc, 'trans'), 1);
  assert.equal(X.missingTranslations(doc, 'orig'), 0);
});

test('SRT 带序号、逗号毫秒、每事件后空行', () => {
  const out = X.subtitles(doc, { content: 'orig', format: 'srt' });
  assert.equal(out, [
    '1',
    '00:00:01,000 --> 00:00:02,500',
    'Hello there',
    '',
    '2',
    '00:00:02,500 --> 00:00:04,000',
    'and welcome',
    '',
    '3',
    '00:00:12,000 --> 00:00:14,000',
    'Second part',
    '',
    '',
  ].join('\n'));
});

test('VTT 有 WEBVTT 头、无序号、点分毫秒', () => {
  const out = X.subtitles(doc, { content: 'trans', format: 'vtt' });
  assert.equal(out, 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n你好，欢迎\n\n');
});

test('说话人开关：SRT 方括号前缀，VTT 声道标签', () => {
  const srt = X.subtitles(doc, { content: 'orig', format: 'srt', speakers: true });
  assert.ok(srt.includes('[Maya] Hello there'));
  assert.ok(srt.includes('[Speaker] Second part'));
  const vtt = X.subtitles(doc, { content: 'orig', format: 'vtt', speakers: true });
  assert.ok(vtt.includes('<v Maya>Hello there'));
});

test('说话人开关在只有一位说话人的文档上不生效', () => {
  const solo = { ...doc, speakers: { s1: { name: 'Maya' } } };
  const srt = X.subtitles(solo, { content: 'orig', format: 'srt', speakers: true });
  assert.ok(srt.includes('\nHello there\n'));
  assert.ok(!srt.includes('[Maya]'));
});

test('时间码进位到小时', () => {
  assert.equal(X.srtTime(3661.5), '01:01:01,500');
  assert.equal(X.vttTime(3661.5), '01:01:01.500');
  assert.equal(X.clockTime(3661.5), '01:01:01');
  assert.equal(X.clockTime(61), '01:01');
});

// ---------- 视频导出观测：ETA / 渲染方式 ----------

test('progressEtaText：旧服务端整组观测缺席时不渲染', () => {
  assert.equal(X.progressEtaText(null), null);
  assert.equal(X.progressEtaText({}), null);
  assert.equal(X.progressEtaText({ done: 3, total: 10 }), null);
});

test('progressEtaText：预热窗口（有 elapsedMs，无 fps/etaMs）显示"正在预估…"', () => {
  assert.equal(X.progressEtaText({ elapsedMs: 1200 }), '正在预估…');
});

test('progressEtaText：预热窗口但已有 fps 时附带速率', () => {
  assert.equal(X.progressEtaText({ elapsedMs: 2800, fps: 118.4 }), '正在预估… · 118 fps');
});

test('progressEtaText：不足 1 分钟显示秒数', () => {
  assert.equal(X.progressEtaText({ elapsedMs: 5000, fps: 229.73, etaMs: 45000 }), '剩余约 45 秒 · 230 fps');
  // 不满 1 秒也至少显示 1 秒，不显示"剩余约 0 秒"
  assert.equal(X.progressEtaText({ elapsedMs: 5000, etaMs: 200 }), '剩余约 1 秒');
});

test('progressEtaText：满 1 分钟按分钟取整', () => {
  assert.equal(X.progressEtaText({ elapsedMs: 18500, fps: 229.73, etaMs: 90000 }), '剩余约 2 分钟 · 230 fps');
  assert.equal(X.progressEtaText({ elapsedMs: 5000, etaMs: 60000 }), '剩余约 1 分钟');
});

test('renderModeText：patch 带补丁窗数，full 是整片重渲，缺 renderMode 不渲染', () => {
  assert.equal(X.renderModeText({ renderMode: 'patch', patchedRanges: 2 }), '光速修正：仅重渲 2 处');
  assert.equal(X.renderModeText({ renderMode: 'patch' }), '光速修正');
  assert.equal(X.renderModeText({ renderMode: 'full' }), '整片重渲');
  assert.equal(X.renderModeText(null), null);
  assert.equal(X.renderModeText({}), null);
});

test('fallbackReasonText：四个稳定枚举值都有可读文案，未知值兜底，无原因不渲染', () => {
  assert.equal(X.fallbackReasonText('baselineMissing'), '基线文件不存在');
  assert.equal(X.fallbackReasonText('emptyRanges'), '光速修正窗口为空');
  assert.equal(X.fallbackReasonText('baseDocumentMismatch'), '基线与当前文档不匹配');
  assert.equal(X.fallbackReasonText('patchUnavailable'), '当前环境不支持区间重渲');
  assert.equal(X.fallbackReasonText('somethingNew'), '光速修正未生效，已整片重渲');
  assert.equal(X.fallbackReasonText(null), null);
  assert.equal(X.fallbackReasonText(undefined), null);
});

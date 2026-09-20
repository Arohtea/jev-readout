/* ══════════════════════════════════════════════════════════════
   Jev Readout — 交互逻辑
   
   三条原则：
   1. 不做任何"聪明"的解读。模型给了什么就显示什么。
   2. 分布优先于结论。标尺是主体，数字是注记。
   3. 界面上显示的请求/响应，就是实际发出去/收到的字节。
   ══════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

/** 问句类型的中文名，与 wire 里的 type 字段一一对应 */
const KIND = { noul: '是非', choice: '选择', score: '评分' };

/* ── 场景预设 ─────────────────────────────────────────── */

const PRESETS = [
  {
    key: 'support',
    tab: '客服工单',
    note: '同一段投诉，五种问法。看模型如何在不同分辨率上给出判断。',
    state: `客户原文：
你们这个系统到底怎么回事？我上周五下的单，说好 48 小时发货，
现在都周三了物流信息还是"已下单"。我打了三次客服电话，每次都说
"帮您催一下"，然后就再也没有下文。我这边是给客户做活动的，
现在活动已经开始了，货还没到，我损失谁来赔？如果今天之内还没有
明确答复，我就直接申请退款并投诉到消协。`,
    questions: {
      department: {
        type: 'choice',
        instructions: '这单应该由哪个团队处理？',
        criteria: {
          logistics: '物流、发货、配送延迟',
          billing: '支付、退款、账单、发票',
          product: '产品功能、Bug、技术故障',
          complaint: '客户投诉、纠纷、赔偿诉求',
        },
      },
      emotion: {
        type: 'score',
        instructions: '客户当前的愤怒程度',
        criteria: ['平静陈述事实', '不满但克制', '明显愤怒', '激烈，带威胁性表述'],
      },
      wants_refund: {
        type: 'noul',
        instructions: '客户是否明确提出了退款诉求？',
        criteria: { true: '明确要求退款', false: '只是在陈述事实或施压' },
      },
      needs_human: {
        type: 'noul',
        instructions: '客户是否表达了对自动回复的不满，需要人工介入？',
      },
      urgency: {
        type: 'score',
        instructions: '这件事对客户的时间紧迫性',
        criteria: ['无明确时间压力', '一周内需要解决', '今天内必须解决'],
      },
    },
  },
  {
    key: 'moderation',
    tab: '内容审核',
    note: '这条内容有真实的违规嫌疑，也有真实的善意动机。看模型怎么分开处理。',
    state: `用户发帖：
「上次推荐的那个什么理财课，纯属骗人的，交了两千块就发了几个
PDF 让我自己看。讲课那老师姓王，住朝阳区，我查到了他的手机号
138xxxx，大家千万别上当。顺便问一下有没有靠谱的推荐？」

发帖时间：工作日下午 3 点
该用户历史：注册 2 年，过往 47 条发言无违规记录`,
    questions: {
      is_violation: {
        type: 'noul',
        instructions: '这条内容是否违反社区规范？',
        criteria: { true: '包含违规内容', false: '属于正常的内容评价或讨论' },
      },
      violation_type: {
        type: 'choice',
        instructions: '若存在违规，属于哪一类？',
        criteria: {
          privacy: '泄露他人隐私（姓名、住址、联系方式）',
          harassment: '人身攻击或骚扰',
          misinformation: '散布虚假或误导性信息',
          commercial: '未报备的商业推广',
          none: '无明显违规',
        },
      },
      severity: {
        type: 'score',
        instructions: '若判定违规，严重程度如何？',
        criteria: ['可忽略', '轻微，提醒即可', '中等，需删改', '严重，需封禁处理'],
      },
      well_intentioned: {
        type: 'noul',
        instructions: '发言者是否出于提醒他人、避免他人受骗的善意出发点？',
      },
    },
  },
  {
    key: 'routing',
    tab: '请求路由',
    note: '一个典型的工具调用场景。注意"复杂程度"这一项会落在档位之间。',
    state: `用户输入：
「帮我把上个月所有超过 5000 块的订单导出来，我要发给财务对账，
最好是 Excel 格式，明天上午之前能给我吗？」`,
    questions: {
      intent: {
        type: 'choice',
        instructions: '用户的核心意图是什么？',
        criteria: {
          data_export: '导出或下载数据',
          data_query: '查询、统计或分析数据',
          config: '修改设置或配置',
          support: '提问求助或报告问题',
          chitchat: '闲聊或无法归类的输入',
        },
      },
      complexity: {
        type: 'score',
        instructions: '满足这个请求的复杂程度',
        criteria: ['直接回答即可', '需调用工具查询', '需多步操作与确认'],
      },
      needs_tool: { type: 'noul', instructions: '是否需要调用外部工具或访问数据库才能完成？' },
      has_deadline: { type: 'noul', instructions: '用户是否提出了明确的时间要求？' },
      is_permitted: {
        type: 'noul',
        instructions: '该请求是否属于合法合规、可正常执行的业务操作？',
        criteria: { true: '正常业务请求', false: '涉及违规取数或越权访问' },
      },
    },
  },
];

let preset = PRESETS[0];

/* ── 渲染：场景与问句 ─────────────────────────────────── */

function renderPresets() {
  const box = $('presets');
  box.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.tab;
    b.setAttribute('aria-pressed', String(p.key === preset.key));
    b.addEventListener('click', () => selectPreset(p));
    box.appendChild(b);
  }
}

/**
 * 问句清单。
 * 左侧显示的是 API 请求里的真实键名（question id），不是装饰性序号——
 * 这些问句在服务端是并行求值的，编号会让人误以为是步骤。
 */
function renderQuestions() {
  const list = $('questions');
  list.innerHTML = '';
  const entries = Object.entries(questions);

  $('q-count').textContent =
    `${entries.length} 条问句 · 单次请求并行求值`;

  for (const [id, q] of entries) {
    const li = document.createElement('li');
    li.className = 'q';

    const crit = criteriaLine(q);
    li.innerHTML = `
      <span class="q-id">${esc(id)}</span>
      <div class="q-body">
        <div class="q-text">${esc(q.instructions)}</div>
        ${crit ? `<div class="q-crit">${crit}</div>` : ''}
      </div>
      <span class="q-kind">${KIND[q.type] || q.type}</span>
    `;
    list.appendChild(li);
  }
}

/** 把 criteria 渲染成一行可读的说明 */
function criteriaLine(q) {
  if (q.type === 'choice') {
    return Object.keys(q.criteria)
      .map((k) => `<b>${esc(k)}</b> ${esc(q.criteria[k])}`)
      .join(' &nbsp;·&nbsp; ');
  }
  if (q.type === 'score') {
    return q.criteria.map((c, i) => `<b>${i}</b> ${esc(c)}`).join(' &nbsp;·&nbsp; ');
  }
  if (q.type === 'noul' && q.criteria) {
    return Object.entries(q.criteria)
      .map(([k, v]) => `<b>${k === 'true' ? '是' : '否'}</b> ${esc(v)}`)
      .join(' &nbsp;·&nbsp; ');
  }
  return '';
}

/** 切换预设：载入该预设的问句（若用户改过则用改过的） */
function selectPreset(p) {
  preset = p;
  questions = questionsFor(p);
  $('state').value = p.state;
  $('preset-note').textContent = p.note;
  renderPresets();
  renderQuestions();
  resetReadout();
  markCustom();
}

/* ── 提交 ─────────────────────────────────────────────── */

let busy = false;

async function run() {
  if (busy) return;
  // 编辑区还开着就先落实改动：写错了就不发请求，免得拿错问句去判读
  if (!commitEditor()) return;
  busy = true;

  const btn = $('run');
  btn.disabled = true;
  btn.textContent = '判读中';

  const t0 = performance.now();

  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: $('state').value, questions }),
    });
    const data = await res.json();
    const clientMs = Math.round(performance.now() - t0);

    // 无论成功失败，都留下通信记录
    if (data.wire) renderWire(data.wire, clientMs);

    if (!res.ok) {
      showFailure(data.error);
      return;
    }

    renderAnswers(data);
  } catch (err) {
    showFailure(`请求没能送达本地服务：${err.message}`);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = '判读';
  }
}

/* ── 渲染：读数 ───────────────────────────────────────── */

function resetReadout() {
  $('answers').innerHTML = `
    <div class="void">
      <p>左侧按下「判读」，这里会显示每个问句的概率分布。</p>
      <p class="dim">分布比结论更能说明问题——它同时告诉你答案和把握。</p>
    </div>`;
  $('verdict').hidden = true;
  $('verdict').innerHTML = '';
  $('answer-count').textContent = '';
  $('np-model').textContent = '—';
  $('np-time').textContent = '—';
}

function renderAnswers(data) {
  const ids = Object.keys(data.answers);
  $('answer-count').textContent = `${ids.length} 项读数`;
  $('np-model').textContent = data.wire?.response?.model ?? '—';
  $('np-time').textContent = `${data.wire?.elapsedMs ?? '—'} ms`;

  // 处置提示：只有需要人介入时才显示
  const v = $('verdict');
  if (data.recommendation?.note) {
    v.hidden = false;
    v.innerHTML = `
      <div class="verdict" data-level="${esc(data.recommendation.level)}">
        <span class="tag">需人工</span>
        <span>${esc(data.recommendation.note)}</span>
      </div>`;
  } else {
    v.hidden = true;
    v.innerHTML = '';
  }

  const box = $('answers');
  box.innerHTML = '';
  let i = 0;
  for (const [id, a] of Object.entries(data.answers)) {
    const q = questions[id];
    const card = document.createElement('div');
    card.className = 'a';
    card.style.animationDelay = `${i++ * 40}ms`;
    card.innerHTML = `
      <div class="a-top">
        <span class="a-id">${esc(id)}</span>
        <span class="a-q">${esc(q?.instructions ?? '')}</span>
      </div>
      ${readoutFor(a, q)}
    `;
    box.appendChild(card);
  }
}

/**
 * 三种问句的读数，共用同一块底：0→1 的标尺。
 * 分辨率不同（一个刻度 / N 个刻度 / M 个档位），底子相同。
 */
function readoutFor(a, q) {
  if (a.type === 'noul') return noulReadout(a);
  if (a.type === 'choice') return choiceReadout(a);
  if (a.type === 'score') return scoreReadout(a, q);
  return '';
}

/**
 * 是非题：整条标尺就是一个概率。
 * 关键在于标出 0.5 —— 那一点上模型是在说"我不知道"。
 */
function noulReadout(a) {
  const p = a.noul;
  const lean = p >= 0.5 ? '是' : '否';
  const distance = Math.abs(p - 0.5);

  // 只有真的贴近 0.5 才提示"几乎没有倾向"
  const note = distance <= 0.05
    ? '读数几乎落在中点：模型对这条判断没有倾向。'
    : '';

  return `
    <div class="a-read">
      <span class="a-value">${p.toFixed(3)}</span>
      <span class="a-unit">P(是)</span>
      <span class="a-pick">${lean}</span>
    </div>
    <div class="rail">
      <div class="rail-axis"><span>0 否</span><span>1 是</span></div>
      <div class="rail-track">
        <div class="rail-mass" data-fill="${p * 100}"></div>
        <div class="rail-ticks"><i style="left:25%"></i><i style="left:75%"></i></div>
        <div class="rail-mid"></div>
      </div>
    </div>
    ${note ? `<div class="derive">${esc(note)}</div>` : ''}
  `;
}

/**
 * 选择题：一条被切成 N 段的标尺，每段的宽度相同，段内填充表示概率。
 * 这样"概率质量集中在哪一段"是一眼可见的。
 */
function choiceReadout(a) {
  const opts = Object.keys(a.probabilities);
  const n = opts.length;
  const segs = opts.map((k) => {
    const v = a.probabilities[k];
    return `
      <div class="seg-part" style="flex:1" data-pick="${k === a.choice}">
        <div class="seg-fill" data-fill="${v * 100}"></div>
      </div>`;
  }).join('');

  const rows = opts
    .slice()
    .sort((x, y) => a.probabilities[y] - a.probabilities[x])
    .map((k) => `
      <div class="row" data-pick="${k === a.choice}" data-zero="${a.probabilities[k] === 0}">
        <span class="row-name">${esc(k)}</span>
        <span class="row-pct">${(a.probabilities[k] * 100).toFixed(1)}%</span>
      </div>`)
    .join('');

  const top = opts.reduce((a2, k) => (a.probabilities[k] > a.probabilities[a2] ? k : a2), opts[0]);
  const topP = a.probabilities[top] ?? 0;
  // confidence 是模型自报的把握，不等于最高概率——两个数放在一起，差异看得见
  const gap = a.confidence != null && Math.abs(topP - a.confidence) > 0.01;

  return `
    <div class="a-read">
      <span class="a-value sm">${esc(a.choice)}</span>
      <span class="a-pick">选中</span>
      <span class="a-unit">${n} 选 1</span>
    </div>
    <div class="rail">
      <div class="rail-axis"><span>各选项概率</span><span>段宽相等</span></div>
      <div class="seg">${segs}</div>
      <div class="rows">${rows}</div>
      <div class="derive">
        最高 ${esc(top)} <b>${(topP * 100).toFixed(1)}%</b>
        &nbsp;·&nbsp; confidence <b>${a.confidence?.toFixed(3) ?? '—'}</b>${gap ? '（模型自报的把握）' : ''}
      </div>
    </div>
  `;
}

/**
 * 评分题：M 个有序档位加一个指针。
 * 分数是概率加权均值，所以会落在档位之间——
 * 指针 + 展开的加权算式，把这件事说清楚。
 */
function scoreReadout(a, q) {
  const levels = q?.criteria ?? [];
  const n = levels.length;
  const max = Math.max(n - 1, 1);

  const segs = levels.map((label, i) => {
    const v = a.probabilities?.[String(i)] ?? 0;
    return `
      <div class="seg-part" style="flex:1" data-pick="${String(i) === String(Math.round(a.score))}">
        <div class="seg-fill" data-fill="${v * 100}"></div>
      </div>`;
  }).join('');

  const rows = levels.map((label, i) => {
    const v = a.probabilities?.[String(i)] ?? 0;
    const isPick = String(i) === String(Math.round(a.score));
    return `
      <div class="row" data-pick="${isPick}" data-zero="${v === 0}">
        <span class="row-name">${i} · ${esc(label)}</span>
        <span class="row-pct">${(v * 100).toFixed(1)}%</span>
      </div>`;
  }).join('');

  // 把加权平均的算式摊开：分数不是模型"说"的，是它给的分布算出来的
  const terms = levels
    .map((_, i) => {
      const v = a.probabilities?.[String(i)] ?? 0;
      return v > 0 ? `${i}×${v.toFixed(3)}` : null;
    })
    .filter(Boolean)
    .join(' + ');

  const onGrid = Number.isInteger(a.score);

  return `
    <div class="a-read">
      <span class="a-value">${a.score.toFixed(3)}</span>
      <span class="a-unit">/ ${max}（${n} 档）</span>
      ${onGrid ? '' : '<span class="a-pick">落在档位之间</span>'}
    </div>
    <div class="rail">
      <div class="rail-axis"><span>0 ${esc(levels[0] ?? '')}</span><span>${max} ${esc(levels[n - 1] ?? '')}</span></div>
      <div class="seg">${segs}</div>
      <div class="pointer"><i data-left="${(a.score / max) * 100}"></i></div>
      <div class="rows">${rows}</div>
      <div class="derive">
        加权均值 = <b>${terms || '—'}</b> = <b>${a.score.toFixed(3)}</b>
        &nbsp;·&nbsp; confidence ${a.confidence?.toFixed(3) ?? '—'}
      </div>
    </div>
  `;
}

/* ── 渲染：通信记录 ───────────────────────────────────── */

/** JSON 着色，让协议读起来像协议 */
function highlight(value) {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return esc(json)
    .replace(/&quot;([^&]*?)&quot;(\s*:)/g, '<span class="k">"$1"</span>$2')
    .replace(/:\s*&quot;([^&]*?)&quot;/g, ': <span class="s">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="n">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span class="b">$1</span>');
}

function renderWire(wire, clientMs) {
  $('wire-status').textContent =
    `HTTP ${wire.status} · 服务端 ${wire.elapsedMs ?? '—'} ms · 含本地往返 ${clientMs} ms`;

  $('wire-req').innerHTML = highlight(wire.request);
  $('wire-res').innerHTML = wire.response
    ? highlight(wire.response)
    : esc(wire.responseRaw ?? '（无内容）');

  // 时序：一次请求里真正发生的先后
  const steps = [
    ['0 ms', `POST ${wire.endpoint ?? '/api/evaluate'}`, `${byteLen(wire.request)} B`],
    [`${wire.elapsedMs ?? '—'} ms`, `TypeSafe 返回 HTTP ${wire.status}`,
      wire.response?.usage ? `in ${wire.response.usage.input_tokens} tok` : ''],
    [`${clientMs} ms`, '浏览器收到完整响应', ''],
  ];

  $('wire-trace').innerHTML = steps.map(([t, w, d]) => `
    <div class="trace-step">
      <span class="trace-t">${esc(t)}</span>
      <span class="trace-w">${esc(w)}</span>
      <span class="trace-d">${esc(d)}</span>
    </div>`).join('');
}

function byteLen(obj) {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return '—';
  }
}

function showFailure(msg) {
  $('answers').innerHTML = `
    <div class="void" style="border-color:#C1440E;color:#C1440E">
      <p>${esc(msg)}</p>
      <p class="dim">下方「通信记录」里有完整的请求和返回。</p>
    </div>`;
  $('answer-count').textContent = '读取失败';
}

/* ── 工具 ─────────────────────────────────────────────── */

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

/**
 * 铺开动画：先写进 DOM（宽度为 0），下一帧再设目标宽度，
 * 这样 CSS transition 才会真的跑起来。
 */
function animateFills(root = document) {
  root.querySelectorAll('[data-fill]').forEach((el) => {
    const target = el.dataset.fill;
    requestAnimationFrame(() => { el.style.width = `${target}%`; });
  });
  root.querySelectorAll('[data-left]').forEach((el) => {
    const target = el.dataset.left;
    requestAnimationFrame(() => { el.style.left = `${target}%`; });
  });
}

/* ── 事件 ─────────────────────────────────────────────── */

$('run').addEventListener('click', () => { run().then(() => animateFills()); });

$('state').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    run().then(() => animateFills());
  }
});

/* ── 启动 ───────────────────────────────────────────────
   必须放在文件最后：下面的自定义问句逻辑用了 let 声明（questions），
   而 selectPreset 会读它，早于声明处调用会撞上暂时性死区。
   ───────────────────────────────────────────────────── */

/* ── 自定义问句 ───────────────────────────────────────────
   编辑的就是请求体里的 questions 对象本身。
   刻意不提供表单式builder：这个工具的立场是"你看到的就是发出去的"，
   而表单会引入一层中间表示，那一层既藏起了协议，也限制了能表达的东西。
   ───────────────────────────────────────────────────── */

/** 用户改过的问句按预设分别存，切回来还在 */
const EDITED_KEY = 'jev-readout:edited';

/** 当前生效的问句：预设，或被用户改过的版本 */
let questions = null;

function loadEdited() {
  try {
    return JSON.parse(localStorage.getItem(EDITED_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveEdited(map) {
  try {
    localStorage.setItem(EDITED_KEY, JSON.stringify(map));
  } catch {
    /* 隐私模式下写不进去，不影响使用 */
  }
}

/** 取当前预设该用的问句：有改动用改动，没有用原始预设 */
function questionsFor(p) {
  const edited = loadEdited()[p.key];
  return edited ? structuredClone(edited) : structuredClone(p.questions);
}

/**
 * 校验问句对象是否符合 Jev 的协议。
 * 只做协议要求的检查，不做风格建议——想怎么写是你的事，
 * 但写错的地方在这里说清楚，不要等 API 回 422。
 */
function validate(qs) {
  if (!qs || typeof qs !== 'object' || Array.isArray(qs)) {
    return '问句必须是一个对象：{ 问句名: { type, instructions, ... } }';
  }
  const ids = Object.keys(qs);
  if (!ids.length) return '至少要有一个问句。';

  for (const id of ids) {
    const q = qs[id];
    if (!q || typeof q !== 'object') return `「${id}」必须是对象。`;
    if (!['noul', 'choice', 'score'].includes(q.type)) {
      return `「${id}」的 type 只能是 noul / choice / score，现在是 ${JSON.stringify(q.type)}。`;
    }
    if (q.instructions === undefined || q.instructions === null || q.instructions === '') {
      return `「${id}」缺 instructions。每个问句都得说清楚要判断什么。`;
    }
    if (q.type === 'choice') {
      if (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria)) {
        return `「${id}」是 choice，criteria 必须是一个对象：{ 选项名: 说明 }。`;
      }
      const opts = Object.keys(q.criteria);
      if (opts.length < 2) return `「${id}」是 choice，至少要有 2 个选项，现在只有 ${opts.length} 个。`;
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2) {
        return `「${id}」是 score，criteria 必须是有序数组且至少 2 档，第 0 项是最低档。`;
      }
    }
  }
  return null;
}

/** 切到编辑视图 */
function openEditor() {
  $('q-json').value = JSON.stringify(questions, null, 2);
  $('q-edit').hidden = false;
  $('questions').hidden = true;
  $('q-msg').textContent = '改完直接按「判读」，改动会记住。';
  $('q-msg').style.color = '';
  $('q-toggle').textContent = '收起编辑';
  $('q-reset').hidden = !loadEdited()[preset.key];
  $('q-json').focus();
}

/**
 * 校验编辑框内容并让它生效。
 *
 * 抽出来是因为「判读」也要用：编辑区开着的时候点判读，得先让改动生效，
 * 而不是拿旧的问句去请求。
 *
 * @returns {boolean} 是否已生效（false 表示用户还写错了，不要继续）
 */
function commitEditor() {
  const text = $('q-json').value.trim();
  if (!text) return true;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // 语法错就留在编辑态，别让用户丢掉正在写的东西
    $('q-msg').textContent = `JSON 语法有误：${e.message}`;
    $('q-msg').style.color = '#C1440E';
    return false;
  }

  const problem = validate(parsed);
  if (problem) {
    $('q-msg').textContent = problem;
    $('q-msg').style.color = '#C1440E';
    return false;
  }

  questions = parsed;
  const map = loadEdited();
  map[preset.key] = parsed;
  saveEdited(map);

  // 立刻刷新清单和计数，不用等用户收起编辑器
  renderQuestions();
  markCustom();
  return true;
}

/** 切回读数视图 */
function closeEditor() {
  if (!commitEditor()) return;
  $('q-edit').hidden = true;
  $('questions').hidden = false;
  $('q-toggle').textContent = '自定义问句';
  $('q-reset').hidden = !loadEdited()[preset.key];
}

/** 提示当前用的不是原始预设 */
function markCustom() {
  const isCustom = !!loadEdited()[preset.key];
  $('input-note').textContent = isCustom ? '已自定义问句' : '';
  $('input-note').style.color = isCustom ? '#C1440E' : '';
}

/** 放弃改动，回到预设 */
function resetPreset() {
  const map = loadEdited();
  delete map[preset.key];
  saveEdited(map);
  questions = structuredClone(preset.questions);
  $('q-json').value = JSON.stringify(questions, null, 2);
  $('q-msg').textContent = '已还原为预设问句。';
  $('q-msg').style.color = '';
  $('q-reset').hidden = true;
  renderQuestions();
  markCustom();
}

$('q-toggle').addEventListener('click', () => {
  if ($('q-edit').hidden) openEditor();
  else closeEditor();
});

$('q-reset').addEventListener('click', resetPreset);

// 编辑框里按 Esc 收起（同时校验并保存）
$('q-json').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEditor();
  }
});

// 输入时即时校验，让人早一点知道有没有写错
$('q-json').addEventListener('input', () => {
  const text = $('q-json').value.trim();
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
    const problem = validate(parsed);
    const n = problem ? 0 : Object.keys(parsed).length;
    $('q-msg').textContent = problem || `${n} 条问句，格式没问题。`;
    $('q-msg').style.color = problem ? '#C1440E' : '';
  } catch {
    $('q-msg').textContent = '正在编辑…';
    $('q-msg').style.color = '';
  }
});

/* ── 启动 ─────────────────────────────────────────────── */

renderPresets();
selectPreset(PRESETS[0]);

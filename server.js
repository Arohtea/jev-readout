/**
 * Jev Readout — 后端
 *
 * 设计原则：不隐藏任何东西。
 * 直接裸调 TypeSafe 的 HTTP 接口（不经过 SDK 包装），
 * 这样界面上展示的 request body 就是真正发出去的字节，
 * 展示的 response body 就是服务端真正返回的内容。
 *
 * 之所以不用官方 SDK：SDK 会补默认值、做重试、改写形状，
 * 于是"你在界面上看到的"和"实际发生的事"之间就隔了一层。
 * 这个工具的全部价值就在于没有那一层。
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import express from 'express';

const PORT = process.env.PORT || 5180;
const API_KEY = process.env.TYPESAFE_API_KEY;
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

if (!API_KEY) {
  console.error('[无法启动] 缺少 TYPESAFE_API_KEY，请检查 .env.local');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

/**
 * 把界面上的问句转成 API 的 wire 格式。
 * 注意这里刻意不做任何"聪明"的处理：界面里长什么样，发出去就长什么样。
 */
function toWireQuestions(questions) {
  const wire = {};
  for (const [id, q] of Object.entries(questions)) {
    wire[id] = { type: q.type, instructions: q.instructions };
    if (q.type === 'choice') {
      wire[id].criteria = q.criteria;
    } else if (q.type === 'score') {
      // score 的 criteria 是有序数组，顺序即档位高低，不能丢
      wire[id].criteria = q.criteria;
    } else if (q.type === 'noul' && q.criteria) {
      wire[id].criteria = q.criteria;
    }
  }
  return wire;
}

/**
 * 基于概率分布的"形状"给出动作建议。
 *
 * 这里刻意不对 confidence 做颜色分级——把握程度应该由分布的陡峭程度
 * 自己表达，而不是被涂成红黄绿。只有当系统的处置动作真的需要改变时
 * （即需要人来看）才给出提示。
 */
function recommendAction(answers) {
  const uncertain = [];

  for (const [id, a] of Object.entries(answers)) {
    if (a.type === 'noul') {
      // noul 没有 confidence。它离 0.5 有多远，就说明模型有多不含糊。
      const clarity = Math.abs(a.noul - 0.5) * 2;
      if (clarity < 0.35) uncertain.push(id);
    } else if ((a.confidence ?? 0) < 0.35) {
      uncertain.push(id);
    }
  }

  if (uncertain.length === 0) {
    return { level: 'clear', note: null, uncertain: [] };
  }
  if (uncertain.length === 1) {
    return {
      level: 'review',
      note: `${uncertain[0]} 这一项把握偏低，值得复核。其余判断可以直接用。`,
      uncertain,
    };
  }
  return {
    level: 'escalate',
    note: `${uncertain.length} 项把握不足（${uncertain.join('、')}），这段内容的信息量可能不够支撑判断。`,
    uncertain,
  };
}

app.post('/api/evaluate', async (req, res) => {
  const { state, questions } = req.body ?? {};

  if (typeof state !== 'string' || !state.trim()) {
    return res.status(400).json({ error: 'state 不能为空' });
  }
  if (!questions || !Object.keys(questions).length) {
    return res.status(400).json({ error: '至少要有一个问句' });
  }

  const body = {
    state,
    model: 'jev-latest',
    questions: toWireQuestions(questions),
  };

  const sentAt = Date.now();
  let status = 0;
  let raw = '';

  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    status = upstream.status;
    raw = await upstream.text();
    const elapsedMs = Date.now() - sentAt;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 服务端返回了非 JSON，原样交出去，不做猜测
      return res.status(502).json({
        error: '上游返回了非 JSON 内容',
        wire: { status, request: body, responseRaw: raw.slice(0, 2000), elapsedMs },
      });
    }

    // 失败也要如实透传：状态码、原始 body 一并交给前端展示
    if (!upstream.ok) {
      return res.status(status).json({
        error: parsed?.detail?.message || parsed?.error?.message || `HTTP ${status}`,
        wire: { status, request: body, response: parsed, elapsedMs },
      });
    }

    res.json({
      answers: parsed.answers,
      recommendation: recommendAction(parsed.answers),
      questionCount: Object.keys(questions).length,
      wire: {
        status,
        endpoint: ENDPOINT,
        request: body,
        response: parsed,
        elapsedMs,
      },
    });
  } catch (err) {
    res.status(502).json({
      error: `连接失败：${err.message}`,
      wire: { status, request: body, responseRaw: raw.slice(0, 2000), elapsedMs: Date.now() - sentAt },
    });
  }
});

app.listen(PORT, () => {
  console.log(`Jev Readout → http://localhost:${PORT}`);
});

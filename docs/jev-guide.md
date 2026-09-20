# Jev 模型使用说明

Jev 是 TypeSafe AI 的 System One 模型。它不做对话，做的是**结构化判断**：给它一段内容和若干问句，它并行返回每条问句的答案以及概率分布。

本文记录的是这个项目实测得到的行为，不是官方文档的转述。

## 接口

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <你的 key>
Content-Type: application/json
```

### 请求体

```json
{
  "state": "待判断的内容，字符串",
  "model": "jev-latest",
  "questions": {
    "问句ID": {
      "type": "noul | choice | score",
      "instructions": "问句的自然语言描述",
      "criteria": "..."
    }
  }
}
```

`state` 也可以是对象或数组，本项目的界面按字符串处理。

`model: "jev-latest"` 会解析到当前版本。实测解析到 `jev-1.13.0`，响应里会带回真实版本号——界面上「Model」那一栏显示的就是这个值。

### 响应

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "问句ID": { "type": "...", "...": "..." }
  },
  "usage": { "input_tokens": 746, "output_tokens": 115 }
}
```

三条问句各返回什么，见下。

## 三种问句

### `noul` — 是非判断

```json
{ "type": "noul", "instructions": "客户是否明确提出了退款诉求？" }
```

返回：

```json
{ "type": "noul", "noul": 0.41 }
```

`noul` 是"是"的概率，0→1。

**注意：`noul` 没有 `confidence` 字段。** 这是它和另外两种问句最大的不同，前端不能假设这个字段存在。

可选地给 `criteria` 解释两端：

```json
{
  "type": "noul",
  "instructions": "客户是否明确提出了退款诉求？",
  "criteria": { "true": "明确要求退款", "false": "只是在陈述事实或施压" }
}
```

实测这个 `criteria` 会影响判断的锐度。同一条投诉，加了 criteria 后 `wants_refund` 给出 0.41；这个值说明模型认为案例在两者之间。

### `choice` — 从选项里选一个

```json
{
  "type": "choice",
  "instructions": "这单应该由哪个团队处理？",
  "criteria": {
    "logistics": "物流、发货、配送延迟",
    "billing": "支付、退款、账单、发票",
    "complaint": "客户投诉、纠纷、赔偿诉求"
  }
}
```

返回：

```json
{
  "type": "choice",
  "choice": "logistics",
  "confidence": 0.49,
  "probabilities": { "logistics": 0.62, "complaint": 0.38, "billing": 0 }
}
```

`criteria` 是对象：键是选项 ID，值是选项含义。至少 2 个选项。

**`confidence` 不等于最高概率。** 实测同一个回答里 `choice: "logistics"`、`confidence: 0.49`、而 `probabilities.logistics = 0.62`。两个数会不一致，别把它们当成一回事。界面把两者并排显示，让这个差异自己暴露出来。

### `score` — 在有序档位上打分

```json
{
  "type": "score",
  "instructions": "客户当前的愤怒程度",
  "criteria": ["平静陈述事实", "不满但克制", "明显愤怒", "激烈，带威胁性表述"]
}
```

返回：

```json
{
  "type": "score",
  "score": 2.99,
  "confidence": 0.99,
  "legend": { "0": "平静陈述事实", "1": "不满但克制", "2": "明显愤怒", "3": "激烈，带威胁性表述" },
  "probabilities": { "0": 0, "1": 0, "2": 0.01, "3": 0.99 }
}
```

`criteria` 是**有序数组**，第 0 项是最低档，顺序不能乱。至少 2 档。

`score` 是概率加权均值，所以**经常不是整数**——上面这个 2.99 就是 `2×0.01 + 3×0.99` 算出来的。想要整数档位就自己四舍五入，但要清楚这一步是你做的，不是模型给的。

`legend` 是服务端回显的档位说明，和请求里的 `criteria` 一致。

## 设计问句的经验

**问句 ID 就是返回值里的键名。** 用有意义的英文名（`wants_refund`、`legal_risk`），别用 `q1`/`q2`。调试和写代码时你会感谢自己。

**`instructions` 写清楚"判断什么"，不要把答案写在问题里。** 差的写法是"客户非常愤怒，判断他的愤怒等级"——你在暗示答案。好的写法是"客户当前的愤怒程度"。

**用 `criteria` 锚定尺度。** 特别是 `score`：不给档位说明，模型自己发明尺度，不同请求之间没法比较。

**一次请求里放多条问句。** 它们是并行求值的，实测 5 条问句和 3 条问句的耗时差不多（都在 1 秒左右）。拆成多次请求反而更慢、更贵。

**别问模型给不了的东西。** 它读的是你给的 state，不知道外部事实。问"这个订单什么时候能到"没有意义；问"客户是否在追问到货时间"才有意义。

## 实测记录

同一段客服投诉（客户下单延迟、威胁退款投诉），5 条问句，`jev-1.13.0`，耗时 991ms，746 输入 token / 115 输出 token：

| 问句 | 类型 | 结果 |
|---|---|---|
| `department` | choice | `logistics` 62% / `complaint` 38%，confidence 0.49 |
| `emotion` | score | 2.99 / 3，档位 3 占 99%，confidence 0.99 |
| `wants_refund` | noul | 0.41 |
| `needs_human` | noul | 0.32 |
| `urgency` | score | 2.00 / 2，档位 2 占 100%，confidence 1.0 |

两个值得注意的地方：

**`department` 和 `emotion` 的对比。** 这条投诉既有物流问题也有投诉意图，`choice` 给出的 62/38 如实反映了这个摇摆，confidence 0.49 也低。而情绪判断 99% 集中在最高档，confidence 0.99。同一个模型、同一次请求，把握程度天差地别——这就是为什么分布比结论重要。

**`urgency` 落在整数上。** 概率 100% 集中在档位 2。这不是模型偷懒，是"今天之内必须解决"这句话确实没有歧义。

### 不同 criteria 带来的变化

同一段文本，把 `department` 的选项从 4 个减到 2 个（去掉 `product`、`billing`），并把 `emotion` 的档位标签改成更短的词，结果：

| 问句 | 4 选项版 | 2 选项版 |
|---|---|---|
| `department` | `logistics` 62%，confidence 0.49 | `complaint` 59%，confidence **0.19** |
| `emotion` | 2.99，confidence 0.99 | 2.69，档位 3 占 69%，confidence 0.69 |

删掉 `product` 和 `billing` 之后，选择从 `logistics` 翻到了 `complaint`。原因是：原来的 4 选项里"物流延迟"是最大的单一类别，去掉它之后，剩下的描述更贴合"客户投诉"。

**这说明选项集合本身就是一种引导。** 你给什么选项，模型就在什么范围内回答。设计 criteria 时要意识到这件事。

## 错误处理

`server.js` 把上游失败也原样透传，所以前端能看到真实的状态码和 body。实测过的失败情况：

**HTTP 422** — 问句不符合协议。比如 `choice` 的 `criteria` 少于 2 项、`score` 的 `criteria` 不是数组。这个项目的前端在提交前就校验，所以正常情况下不会发出去。

**账户验证问题** — 免费账户可能要求绑定信用卡。这时返回 `customer_verification_required`，和代码无关，去 TypeSafe 后台处理。

## 关于 Vercel AI Gateway

TypeSafe 也提供经由 Vercel AI Gateway 的访问路径。实测该路径在账户未绑卡时会返回验证错误而不可用。

即使可用，通过 AI SDK 调用也会**丢掉 `confidence` 和 `legend` 字段**——SDK 做归一化时把它们当成了非标准字段。这两个字段恰好是判断质量的关键信息，所以本项目直接用裸 HTTP 调用。

## 参考

- TypeSafe AI 官网：https://typesafe.ai
- 本项目后端实现：`server.js`（160 行，无抽象层）

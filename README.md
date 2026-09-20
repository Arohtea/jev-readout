# Jev Readout

把一段内容交给 [TypeSafe AI](https://typesafe.ai) 的 **Jev**（System One）模型，得到一组带概率分布的结构化判断。

Jev 不是聊天模型。你给它一段 state 和若干**类型化问句**，它并行返回每条问句的答案**以及概率分布**：一个非题给出 0→1 的概率，选择题给出各选项的概率质量，评分题给出加权均值和档位分布。

## 这个工具在意什么

**分布比结论更有价值。** 只显示"答案是 A"，你会以为模型很确定。显示"A 占 59%、B 占 41%"，你就知道这个判断其实摇摆——这才是决策时需要的信息。

**过程不藏。** 页面底部常驻一份通信记录，展示实际发出去的请求体、收回来的原始响应、以及这次调用的时序。后端刻意不用官方 SDK，直接裸调 HTTP：SDK 会补默认值、做重试、改写形状，而"界面所见 = 实际字节"是这个工具的全部价值。

**问句可以自己写。** 左侧的问题清单就是请求体里的 `questions` 对象，用 JSON 直接编辑。改完即时校验，改动按场景记住。

## 快速开始

需要 Node.js 20+。

```bash
npm install

# 写入你的 TypeSafe API key
echo 'TYPESAFE_API_KEY=你的key' > .env.local
echo 'PORT=5180' >> .env.local

npm start
```

打开 http://localhost:5180

`.env.local` 已在 `.gitignore` 里，不会被提交。

## 三种问句

| 类型 | 问什么 | 返回 |
|---|---|---|
| `noul` | 是非判断 | `noul`：0→1 的概率。**没有** confidence 字段 |
| `choice` | 从若干选项中选一个 | `choice` 选中项 + `confidence` + 各选项 `probabilities` |
| `score` | 在有序档位上打分 | `score` 加权均值 + `confidence` + 各档位 `probabilities` + `legend` |

`noul` 没有 confidence，但概率本身离 0.5 有多远就说明了模型有多不含糊——所以界面把 0.5 那条中点线明确标出来。落在 0.5 附近，模型的意思就是"我不知道"。

`score` 的分值是概率加权均值，因此经常落在档位之间（比如 4 档里的 2.69）。界面用指针位置加展开的加权算式把这件事说清楚，而不是四舍五入成一个整数骗你。

## 自定义问句

点「自定义问句」进入 JSON 编辑。编辑的就是请求体里的 `questions` 字段本身——没有表单中间层，因为表单既藏起了协议，也限制了你表达的东西。

```json
{
  "我的问句名": {
    "type": "choice",
    "instructions": "这里写清楚要判断什么",
    "criteria": {
      "选项A": "这个选项的含义",
      "选项B": "这个选项的含义"
    }
  }
}
```

写错的地方即时提示（类型不对、缺 `instructions`、选项少于 2 个等），不会等到 API 回 422。改动按场景存在 localStorage，切走再切回来还在；「还原预设」可以丢弃。

## 项目结构

```
server.js           Express 后端：一个接口 + 静态托管，裸调 TypeSafe HTTP API
public/index.html   页面结构
public/style.css    样式
public/app.js       交互逻辑、三种问句的读数渲染、问句编辑器
docs/               详细文档
```

## 部署

**浏览器不能直连 TypeSafe。** 它的 CORS 预检返回 `Disallowed CORS origin`，所以 API key 只能留在服务端——GitHub Pages 这类的纯静态托管跑不起来。

Vercel、Railway、Render、Fly.io 都能跑，因为它们是执行 Node 的。**Vercel 最简单**，`server.js` 已经适配好了：

```bash
echo "你的key" | vercel env add TYPESAFE_API_KEY production --yes
vercel --prod
```

完整步骤（含各平台的差异和排查）见 [docs/deploy.md](docs/deploy.md)。

## 文档

- [Jev 模型使用说明](docs/jev-guide.md) — 协议细节、问句设计经验、实测行为
- [部署指南](docs/deploy.md) — 托管选项与 key 的安全边界

## 许可

MIT

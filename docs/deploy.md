# 部署指南

## 先看这个约束

TypeSafe 的 API **不允许浏览器跨域直连**。实测：

```bash
$ curl -X OPTIONS https://api.typesafe.ai/v1/systemone \
    -H "Origin: https://arohtea.github.io" \
    -H "Access-Control-Request-Method: POST"
HTTP/2 400
Disallowed CORS origin
```

响应里没有 `access-control-allow-origin`。这意味着两件事：

1. **前端不能直接持有 API key。** 就算你把 key 塞进前端代码，浏览器也会在预检阶段被拦下，请求根本发不出去。
2. **必须有服务端。** 纯静态托管（GitHub Pages、Netlify 静态站点、Vercel 的纯前端模式）跑不起来。

所以部署这个项目 = 把 `server.js` 跑在一个能出网的主机上，让 key 待在服务端环境变量里。

## 方案一：GitHub 存代码 + 任意 Node 主机跑服务

推荐路径。GitHub 负责代码和版本，托管交给专门跑 Node 的平台。

### 第一步：推到 GitHub

```bash
cd /path/to/jev
git init
git add -A
git commit -m "Jev Readout"

# 用 gh CLI（已登录的话）
gh repo create jev --public --source=. --remote=origin --push

# 或者手动
git remote add origin git@github.com:<你>/jev.git
git push -u origin main
```

推之前确认 `.env.local` 没被带上：

```bash
git ls-files | grep -i env    # 应该没有输出
```

### 第二步：选一个主机

下面三个都能跑 Express，都有免费额度。共同点是：**在平台的配置界面里填环境变量，不要把 key 写进代码或仓库。**

#### Railway

1. 用 GitHub 账号登录 [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo → 选中 `jev`
3. 在 Variables 里加 `TYPESAFE_API_KEY`
4. Railway 自动识别 `npm start`。`PORT` 由平台注入，`server.js` 已经读 `process.env.PORT`

#### Render

1. 登录 [render.com](https://render.com) → New → Web Service
2. 连上 GitHub 仓库
3. Build Command: `npm install`，Start Command: `npm start`
4. 在 Environment 里加 `TYPESAFE_API_KEY`

免费实例会休眠，冷启动要等十几秒。demo 够用，长期挂着建议升付费。

#### Fly.io

```bash
fly launch          # 生成 fly.toml，选不要 Postgres
fly secrets set TYPESAFE_API_KEY=你的key
fly deploy
```

`fly.toml` 里需要确认 `internal_port` 和 `PORT` 对得上。

### 关于 `dotenv` 的注意点

`server.js` 里是这么读配置的：

```js
import { config } from 'dotenv';
config({ path: '.env.local' });
```

`.env.local` 不存在时 `dotenv` 静默跳过，直接用进程环境变量——所以在云平台上工作正常。本地开发时它读 `.env.local`。

## 方案二：只在本地跑，GitHub 存代码

如果你的目的是"存起来、给别人看代码"，而不是"给一个在线地址"，那不用部署：

```bash
git push
```

别人 clone 下来，配上自己的 key，`npm start` 就能跑。README 里有完整步骤。

这个方案的额外好处是：每个使用者用自己的 key，你的额度不会被陌生人消耗。

## 方案三：不要这么做 —— 前端直连

有些人会想：把 key 写进前端代码，或者用 GitHub Actions 每半小时预生成一批结果让前端读。

**前者不可行**，CORS 会拦（见开头）。就算 TypeSafe 哪天开放了 CORS，也**不要做**——前端代码里的 key 是公开的，任何人打开 DevTools 就能复制走。API key 一旦泄露，别人能用你的额度，账单算你的。

**后者**只适合内容固定的展示页。它的代价是失去交互：用户改不了 state，也写不了自己的问句——而这恰好是这个工具的核心。

## 安全清单

推代码前逐条过一遍：

- [ ] `git ls-files | grep -i env` 输出为空
- [ ] `git grep "apikey_"` 无结果（key 的真实前缀）
- [ ] 云平台的环境变量界面里填了 key，代码和仓库里没有
- [ ] `.gitignore` 覆盖 `.env` / `.env.local` / `.env.*.local`
- [ ] 如果 key 曾经误提交过：**去 TypeSafe 后台吊销并重新生成**，只删文件不够——git 历史里还在

## 上线后的加固建议

这是个 demo 工具，公开部署时值得加的最小防护：

**加访问口令。** `server.js` 里加一层简单的校验：

```js
// WARN: 只是挡住随手访问，不是真正的鉴权。公开服务请换成正规方案。
const ACCESS_CODE = process.env.ACCESS_CODE;
app.use('/api', (req, res, next) => {
  if (ACCESS_CODE && req.get('x-access-code') !== ACCESS_CODE) {
    return res.status(401).json({ error: '缺少访问口令' });
  }
  next();
});
```

前端在 fetch 时带上这个头，口令存在 localStorage 里让用户自己填。

**限流。** 每次判读都花 token。用 `express-rate-limit` 按 IP 限制：

```bash
npm i express-rate-limit
```

```js
import rateLimit from 'express-rate-limit';
app.use('/api/', rateLimit({ windowMs: 60_000, max: 10 }));
```

**body 大小。** 现在是 `express.json({ limit: '2mb' })`。公开服务可以收紧到 `100kb`，state 用不了那么大。

## 排查

**页面打开是空的 / 接口 500**
看平台日志里有没有 `[无法启动] 缺少 TYPESAFE_API_KEY`。说明环境变量没生效。

**本地能跑，线上报 502**
`server.js` 把上游失败也透传了，看响应里的 `error` 字段。账户额度或 key 权限问题居多。

**改了问句但请求没变**
问句存在浏览器 localStorage 里。换浏览器或清缓存后回到预设。点「还原预设」可以手动丢弃改动。

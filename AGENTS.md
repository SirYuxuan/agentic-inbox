# AGENTS.md — 面向 AI 的项目指南

> 本文档写给需要**理解并修改本项目**的 AI 编码助手（Claude Code、Cursor 等）。
> 它补充而非取代 [README.md](README.md)：README 面向部署者，本文面向改代码的人/AI。
> 主要使用 Claude Code 时，可将本文件软链或复制为 `CLAUDE.md` 以便自动加载。

---

## 1. 一句话概述

**Agentic Inbox** 是一个完全运行在 Cloudflare Workers 上的自托管邮件客户端，内置 AI 邮件 Agent。收信走 Cloudflare Email Routing，发信走 Resend，每个邮箱隔离在独立的 Durable Object（内含 SQLite），附件存 R2，AI 用 Workers AI（`@cf/moonshotai/kimi-k2.5`）。

技术栈见 [README.md](README.md#stack)。核心库版本：React 19 / React Router v7 / Hono 4 / AI SDK v6 / `agents` 0.7 / `@cloudflare/ai-chat` / drizzle-orm。

---

## 2. 顶层架构与请求流

```
┌──────────────┐  /api/v1/*   ┌──────────────────┐   RPC    ┌─────────────────┐
│   Browser    │─────────────>│   Hono Worker    │─────────>│   MailboxDO     │  每个邮箱一个
│  React SPA   │   SSR/HTML   │  workers/app.ts  │          │  SQLite + 迁移   │
│  + AgentPanel│<─────────────│  (Access JWT 校验)│─────────>│   R2 附件        │
└──────┬───────┘              │                  │          └─────────────────┘
       │ WebSocket /agents/*  │  routeAgentRequest│   RPC    ┌─────────────────┐
       └─────────────────────>│                  │─────────>│   EmailAgent    │  每个邮箱一个
                              │                  │          │  AIChatAgent    │
   外部 AI 工具  /mcp ────────>│                  │─────────>│  自动起草 + 聊天  │
                              └──────────────────┘          └─────────────────┘
                                                            ┌─────────────────┐
                                                            │    EmailMCP     │  MCP server
                                                            │  McpAgent       │
                                                            └─────────────────┘
```

**入口**：[workers/app.ts](workers/app.ts) 是 Worker 主入口。它按顺序：
1. 对所有请求做 **Cloudflare Access JWT 校验**（`import.meta.env.DEV` 时跳过；生产环境缺 `POLICY_AUD`/`TEAM_DOMAIN` 会 fail closed）。
2. `/api/v1/*` → 转交 [workers/index.ts](workers/index.ts) 的 Hono app（REST API）。
3. `/agents/*` → `routeAgentRequest`，走到 `EmailAgent` DO（AI 聊天面板的 WebSocket）。
4. `/mcp` → `EmailMCP` DO（对外 MCP server）。
5. 其余路径 → React Router SSR（前端 SPA）。
6. `email()` 导出 → 入站邮件由 [workers/index.ts](workers/index.ts) 的 `receiveEmail` 处理。

**三个 Durable Object**（在 [wrangler.jsonc](wrangler.jsonc) 的 `durable_objects` + `migrations` 声明，从 [workers/app.ts](workers/app.ts) 导出）：

| DO | 类文件 | 键（`idFromName`） | 职责 |
|----|--------|-------------------|------|
| `MailboxDO` | [workers/durableObject/index.ts](workers/durableObject/index.ts) | 邮箱地址（如 `hello@example.com`） | 存储邮件/线程/文件夹，全部 SQL 逻辑 |
| `EmailAgent` | [workers/agent/index.ts](workers/agent/index.ts) | 邮箱地址 | AI 聊天 + 新邮件自动起草回复 |
| `EmailMCP` | [workers/mcp/index.ts](workers/mcp/index.ts) | MCP 会话 | 对外暴露邮件工具，靠 `mailboxId` 参数寻址邮箱 |

> **关键概念**：**mailboxId 就是邮箱地址本身**。`MailboxDO` 和 `EmailAgent` 都用它作为 `idFromName` 的键，因此同一邮箱地址在两个 DO 里天然对应。邮箱是否"存在"由 R2 中的 `mailboxes/{address}.json` 决定——该文件同时存邮箱设置。

---

## 3. 目录地图

```
workers/                     后端（Cloudflare Worker）
├── app.ts                   ★ 主入口：Access 校验 + 路由分发 + email() 导出 + DO 再导出
├── index.ts                 ★ 全部 REST API 路由 (/api/v1/*) + receiveEmail 入站处理
├── types.ts                 Env 接口（POLICY_AUD / TEAM_DOMAIN / RESEND_API_KEY + Cloudflare.Env）
├── email-sender.ts          通过 Resend 发信
├── durableObject/
│   ├── index.ts             ★ MailboxDO：所有 SQL 查询（列表/线程/搜索/CRUD/建邮件）
│   └── migrations.ts        ★ 手写迁移系统（编号迁移列表，见 §7）
├── agent/index.ts           ★ EmailAgent：系统提示词、9 个工具的接线、onNewEmail 自动起草
├── mcp/index.ts             EmailMCP：对外 MCP 工具（13 个，含发送类工具）
├── routes/reply-forward.ts  回复/转发的复杂 REST 处理
├── db/schema.ts             Drizzle 表定义（folders / emails / attachments）——文档用途，见 §7 注意
└── lib/
    ├── tools.ts             ★ Agent 与 MCP 共享的工具业务逻辑（唯一真源）
    ├── ai.ts                Workers AI 调用：isPromptInjection / verifyDraft / translateEmailContent
    ├── email-helpers.ts     线程头、引用块、HTML/纯文本互转、getMailboxStub、listMailboxes
    ├── mailbox.ts           requireMailbox 中间件（校验邮箱存在并注入 stub 到 Hono context）
    ├── attachments.ts       附件存 R2
    └── schemas.ts           Zod schema + EmailFull/EmailMetadata 类型

app/                         前端（React Router v7 SPA + SSR）
├── routes.ts                路由表；routes/ 下是各页面
├── root.tsx                 根布局
├── services/api.ts          前端 REST 客户端
├── queries/                 TanStack Query 的 query 定义（emails/folders/mailboxes/...）
├── components/              UI 组件；AgentPanel/MCPPanel/ComposeEmail/EmailPanel 等
│   ├── email-panel/         邮件阅读面板子组件
│   └── ui/                  基础 UI 原子组件（button/dialog/...）
├── hooks/                   useComposeForm / useUIStore(Zustand)
└── lib/                     search-parser / mailbox-order / utils

shared/                      前后端共享
├── folders.ts               ★ Folders 常量 + 显示名 + 工具描述（改文件夹从这里开始）
└── dates.ts                 日期格式化

wrangler.jsonc               ★ Worker 配置：bindings、DO、迁移 tag、vars
worker-configuration.d.ts    wrangler 生成的类型（勿手改，用 npm run cf-typegen 重生成）
```

★ = 修改功能时最常触碰的文件。

---

## 4. 数据模型（MailboxDO 内的 SQLite）

三张表（权威定义在 [workers/durableObject/migrations.ts](workers/durableObject/migrations.ts)，Drizzle 版在 [workers/db/schema.ts](workers/db/schema.ts)）：

- **folders**：`id, name, is_deletable`。系统文件夹见 [shared/folders.ts](shared/folders.ts)：`inbox / sent / draft / archive / trash / spam`。
- **emails**：`id, folder_id(FK,级联删除), subject, sender, recipient, cc, bcc, date, read, starred, body, in_reply_to, email_references, thread_id, message_id, raw_headers`。
  - `body` 存 HTML（入站取 `parsedEmail.html || text`）。
  - `date` 用**接收时间**而非邮件头 Date。
  - 线程化：`thread_id` = references[0] 或 in_reply_to 或自身 id；无引用时按主题+发件人回溯 `findThreadBySubject`。
- **attachments**：`id, email_id(FK), filename, mimetype, size, content_id, disposition`。文件本体在 R2：`attachments/{emailId}/{attachmentId}/{filename}`。

**R2 中的非附件数据**：`mailboxes/{address}.json` 存每个邮箱的设置（`name`、`agentSystemPrompt`、`autoDraftEnabled`、`trustedImageSenders`、排序等）。邮箱列表 = 列 R2 `mailboxes/` 前缀。

---

## 5. AI Agent 与工具系统（重点）

### 工具是共享的
[workers/lib/tools.ts](workers/lib/tools.ts) 是**所有工具业务逻辑的唯一真源**，导出 `toolListEmails / toolGetEmail / toolGetThread / toolSearchEmails / toolDraftReply / toolDraftEmail / toolUpdateDraft / toolMarkEmailRead / toolMoveEmail / toolDiscardDraft / toolDeleteEmail / toolSendReply / toolSendEmail / toolListMailboxes`。每个函数接受 `env`（或 DO stub）+ 参数，返回普通对象。

- [workers/agent/index.ts](workers/agent/index.ts) 把其中 **9 个**用 `defineTool` 包成聊天 Agent 的工具（**只读 + 起草，不含直接发送**——发送必须由操作者在 UI 里确认）。
- [workers/mcp/index.ts](workers/mcp/index.ts) 把 **13 个**注册成 MCP 工具（**含 `send_reply` / `send_email` 等发送工具**，因为外部工具可代操作者发送）。

> **改工具的规矩**：新增/修改工具行为 → 改 [workers/lib/tools.ts](workers/lib/tools.ts)，然后在 agent 和/或 mcp 里接线。不要在 agent/mcp 里各写一份逻辑。

### 自动起草流程（onNewEmail）
1. 入站邮件存好后，`receiveEmail`（[workers/index.ts](workers/index.ts)）在 `ctx.waitUntil` 里 `fetch` `EmailAgent` 的 `/onNewEmail`（除非该邮箱 `autoDraftEnabled === false`）。
2. `EmailAgent.onRequest`（[workers/agent/index.ts](workers/agent/index.ts)）读取邮件与线程上下文 → 先跑 `isPromptInjection`（[workers/lib/ai.ts](workers/lib/ai.ts)）→ 用 `streamText` 生成草稿 → `verifyDraft` 清洗 → 存为 draft。
3. 用户在 AI 面板聊天走 `onChatMessage`（WebSocket，经 `/agents/*`）。

### 安全边界
- **Cloudflare Access 是唯一信任边界**：任何通过 Access 策略的人可访问**所有**邮箱，包括 `/mcp`。没有 per-mailbox 授权（见 README 说明）。
- **Prompt injection 检测**：处理邮件正文喂给 LLM 前调用 `isPromptInjection`。
- **发送前确认**：聊天 Agent 只能起草；发送由 UI 或 MCP 显式触发。

---

## 6. REST API 速览（`workers/index.ts`，前缀 `/api/v1`）

全局：`GET /config`、联系人 `GET/POST/PUT/DELETE /contacts`、`GET/PUT /trusted-image-senders`、邮箱列表与元数据 `/mailboxes`、`/mailboxes/unread-counts`、`/mailboxes/order`。

按邮箱（`/mailboxes/:mailboxId/...`，经 `requireMailbox` 中间件校验存在性并注入 `c.var.mailboxStub`）：`emails`（列表/发送）、`drafts`、`emails/:id`（读/改/删）、`emails/:id/move`、`emails/:id/translate`、`threads/:threadId`、`emails/:id/reply`、`emails/:id/forward`、`folders`、`search`、`emails/:emailId/attachments/:attachmentId`。

前端通过 [app/services/api.ts](app/services/api.ts) + [app/queries/](app/queries/)（TanStack Query）消费这些接口。

---

## 7. 数据库迁移（改表结构必读）

**不用 Drizzle Kit，用手写迁移系统**：[workers/durableObject/migrations.ts](workers/durableObject/migrations.ts)。

- 迁移是一个**编号数组**（`1_initial_setup`、`2_add_email_threading`……当前到 `8_add_folder_date_indexes` 等），在 `MailboxDO` 构造函数里 `applyMigrations` 幂等执行，记录在 `d1_migrations` 表。
- **加一列/加索引**：在数组末尾追加一条新编号迁移（`ALTER TABLE emails ADD COLUMN ...` 或 `CREATE INDEX IF NOT EXISTS ...`）。**不要**改旧迁移。
- [workers/db/schema.ts](workers/db/schema.ts) 的 Drizzle 定义主要作类型/文档参考；改表结构时应**同步更新它**以保持一致，但真正生效的是 migrations.ts。
- `wrangler.jsonc` 的 `migrations`（`v1/v2/v3`）是 **DO class 迁移**（新增 SQLite DO 类），与上面的表迁移是两回事——新增一个 DO 类才需要在这里加 tag。

---

## 8. 本地开发与常用命令

```bash
npm install
npm run dev          # react-router dev（本地开发，Access 校验自动跳过）
npm run typecheck    # cf-typegen + react-router typegen + tsc -b（提交前务必跑）
npm run build        # react-router build
npm run deploy       # build + wrangler deploy
npm run cf-typegen   # 重新生成 worker-configuration.d.ts
```

- 本地环境变量：复制 [.dev.vars.example](.dev.vars.example) 为 `.dev.vars`。
- 本地开发跳过 Access（`import.meta.env.DEV`），因此无需配 `POLICY_AUD`/`TEAM_DOMAIN` 即可跑。
- 没有测试套件；验证靠 `npm run typecheck` + 手动跑 `npm run dev` 走通流程。

---

## 9. 修改本项目的约定与提示

**代码风格**：所有源文件带 Apache 2.0 版权头（新建文件请照抄）。制表符缩进。TypeScript 严格。Zod 校验入参。

**常见改动落点**：

| 想做什么 | 从哪开始 |
|----------|----------|
| 新增/改 AI 工具 | [workers/lib/tools.ts](workers/lib/tools.ts) → 再在 [agent](workers/agent/index.ts)/[mcp](workers/mcp/index.ts) 接线 |
| 改系统提示词/自动起草行为 | [workers/agent/index.ts](workers/agent/index.ts)（默认提示词 + `onRequest`/`onChatMessage`） |
| 加/改 REST 接口 | [workers/index.ts](workers/index.ts)，DO 逻辑放 [durableObject/index.ts](workers/durableObject/index.ts) |
| 改表结构/加索引 | 末尾追加迁移，见 §7 |
| 改文件夹/文件夹显示名 | [shared/folders.ts](shared/folders.ts)（前后端共用） |
| 改前端页面/组件 | [app/routes/](app/routes/) + [app/components/](app/components/)，数据用 [app/queries/](app/queries/) |
| 改发信逻辑 | [workers/email-sender.ts](workers/email-sender.ts)（Resend） |
| 改收信解析/线程化 | [workers/index.ts](workers/index.ts) 的 `receiveEmail` |

**易踩的坑**：
- 别在 agent 和 mcp 里重复写工具逻辑——用 [tools.ts](workers/lib/tools.ts)。
- 别手改 `worker-configuration.d.ts`——它是生成的。
- 别改历史迁移——只往后追加。
- 修改 Env 字段要同时改 [workers/types.ts](workers/types.ts) 并在 [wrangler.jsonc](wrangler.jsonc) 声明对应绑定/变量/密钥。
- `mailboxId` 处处等于邮箱地址；操作邮箱前它必须在 R2 存在（`requireMailbox` 已代为校验）。
- 提交前跑 `npm run typecheck`。

---

## 10. 延伸阅读

- 部署与配置：[README.md](README.md)
- 官方博客背景：[Email for Agents](https://blog.cloudflare.com/email-for-agents/)
- Cloudflare Agents SDK / Durable Objects / Email Routing / Workers AI / R2 官方文档（见 README 链接）

<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), outbound email is sent through [Resend](https://resend.com), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)


Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to set up

1. Create the authentication database:

   ```bash
   npx wrangler d1 create agentic-inbox-auth
   ```

   Replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.

2. Create the R2 bucket if it does not already exist:

   ```bash
   npx wrangler r2 bucket create agentic-inbox
   ```

3. Apply the authentication migration, then deploy:

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

4. Configure the fixed registration key and Resend API key as Worker secrets:

   ```bash
   npx wrangler secret put REGISTRATION_KEY
   npx wrangler secret put RESEND_API_KEY
   ```

5. In Cloudflare Email Routing, create a catch-all rule for `oofo.cc` that forwards to this Worker.

6. Sign in with the seeded `yuxuan` administrator account. On the first authenticated request, every pre-existing R2 mailbox is claimed by that account without moving its Durable Object or email data.

## Features

- **Full email client** — Receive via Cloudflare Email Routing and send via Resend, with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Account isolation** — Password sessions, fixed-key registration, mailbox ownership, address books, preferences, and ordering are isolated per account
- **Prefix namespaces** — Normal accounts create `prefix.custom@oofo.cc`; the administrator can create any available dot-separated local part
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and sending
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing (receive), Resend (send)
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/mistralai/mistral-small-3.1-24b-instruct`), `react-markdown` + `remark-gfm`
- **Auth:** D1 users and opaque sessions, PBKDF2-SHA256 password hashes, HttpOnly same-origin cookies

## Getting Started

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

### Configuration

1. Set `REGISTRATION_KEY` and `RESEND_API_KEY` in `.dev.vars`.
2. Keep the mailbox domain as `oofo.cc` in `wrangler.jsonc`.
3. Create the D1 database and R2 bucket described above before remote deployment.

### Deploy

```bash
npm run db:migrate:remote
npm run deploy
```

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Resend](https://resend.com) account with a verified sending domain and an API key (set as the `RESEND_API_KEY` secret)
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- D1 database bound as `AUTH_DB`, with all files in `migrations/` applied
- A fixed `REGISTRATION_KEY` stored as a Worker secret

REST and Agent requests are restricted to mailboxes actively owned by the signed-in account. MCP is administrator-only and applies the same active ownership check to every mailbox tool.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## License

Apache 2.0 -- see [LICENSE](LICENSE).

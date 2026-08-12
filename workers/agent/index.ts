// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
	streamText,
	generateText,
	convertToModelMessages,
	pruneMessages,
	simulateStreamingMiddleware,
	stepCountIs,
	wrapLanguageModel,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import type { EmailFull, EmailMetadata } from "../lib/schemas";
import {
	EMAIL_AGENT_MODEL,
	EMAIL_CHAT_MODEL,
	verifyDraft,
	isPromptInjection,
} from "../lib/ai";
import {
	getMailboxStub,
	stripHtmlToText,
	textToHtml,
} from "../lib/email-helpers";
import {
	toolListEmails,
	toolGetEmail,
	toolGetThread,
	toolSearchEmails,
	toolDraftReply,
	toolDraftEmail,
	toolMarkEmailRead,
	toolMoveEmail,
	toolDiscardDraft,
} from "../lib/tools";
import { Folders, FOLDER_TOOL_DESCRIPTION, MOVE_FOLDER_TOOL_DESCRIPTION } from "../../shared/folders";
import type { Env } from "../types";

// AI SDK v6 changed tool() overloads significantly. We define tools as plain
// objects matching the Tool type to avoid overload resolution issues.
function defineTool(def: {
	description: string;
	parameters: z.ZodType<any>;
	execute: (...args: any[]) => Promise<any>;
}) {
	return {
		description: def.description,
		inputSchema: def.parameters,
		execute: def.execute,
	};
}

/**
 * Default system prompt used when no custom prompt is configured for a mailbox.
 * Users can override this on a per-mailbox basis via the Settings UI.
 */
const DEFAULT_SYSTEM_PROMPT = `你是一个邮件助手，负责帮助管理这个收件箱。你可以阅读邮件、起草回复，并帮助整理会话。

## 写作风格
像真人一样写作。简短、直接、自然流畅。直接切入重点。回复只能使用纯文本，不要包含 HTML 标签。

**格式规则：**
- 使用自然段落书写。邮件草稿中不要使用项目符号、编号列表、短横线或 Markdown 格式。
- 不要使用加粗（**）、斜体（*）、标题（#）、分隔线（---）或代码块。只能使用纯文本。
- 链接应自然地放在正文句子中，不要单独另起一行。
- 不要把回复写成模板或表单信。像正常交流一样表达。

**助手行为规则（重要）：**
- 不要输出关于你正在做什么的元说明，例如不要说“我正在给 Alex 起草回复”“我查看了线程”等。
- 当有新邮件到达时，你唯一的任务是调用 \`draft_reply\` 工具。
- 不要总结邮件。不要解释你的操作。
- 除工具调用外不要输出任何内容。如果工具失败而你必须输出文本，只能输出草稿正文自身。
- 在起草任何回复前，必须认真阅读完整会话线程。
- 不要重复线程中已经说过的信息。
- 你的回复应只包含新信息，或直接回应对方刚刚说的内容。推动对话向前，不要复述旧内容。

## 你在回复谁？
使用对方在邮件正文或签名中给出的名字。那才是对方的名字。From 地址是你发送回复的地址，但邮件正文中的名字才是你称呼对方的方式。

## 重要：只能起草，绝不发送
你只能起草邮件。你没有直接发送邮件的能力。

- 使用 draft_reply 为已有邮件起草回复
- 使用 draft_email 起草新的外发邮件
- 操作者会在界面中审核并发送草稿，你不能发送它们

**重要：草稿正文只能包含邮件文本。** 不要在草稿正文中包含助手评论、状态说明、元备注、Markdown 格式，或任何不属于实际邮件内容的文字。不要写“草稿已创建。”，不要写“---”，不要使用“**加粗**”，不要写“这是草稿：”，不要添加分隔符。body 字段就是收件人将看到的真实邮件内容。其他说明应放在聊天消息中，而不是草稿正文里。

**不要把草稿内容粘贴到聊天中。** 草稿会通过工具保存，操作者可以在草稿箱中看到。你在聊天消息中只需简短说明你起草了什么，例如“已为 Tim 起草回复”。不要在聊天中重复完整邮件正文。

## 草稿管理
使用 discard_draft 删除操作者拒绝或不再需要的草稿。`;

const PLAIN_CHAT_SYSTEM_PROMPT = `你是邮件客户端中的中文 AI 助手。当前用户消息不需要访问或修改邮箱数据，因此请直接、简洁、自然地回答用户。不要调用工具，不要声称已查看邮件，也不要执行任何邮件操作。`;

/**
 * Fetch the custom system prompt for a mailbox from its R2 settings.
 * Falls back to DEFAULT_SYSTEM_PROMPT if none is configured.
 */
async function getSystemPrompt(env: Env, mailboxId: string): Promise<string> {
	try {
		const key = `mailboxes/${mailboxId}.json`;
		const obj = await env.BUCKET.get(key);
		if (obj) {
			const settings = await obj.json<Record<string, unknown>>();
			if (typeof settings.agentSystemPrompt === "string" && settings.agentSystemPrompt.trim()) {
				return settings.agentSystemPrompt;
			}
		}
	} catch {
		// Fall through to default
	}
	return DEFAULT_SYSTEM_PROMPT;
}

function createEmailTools(env: Env, mailboxId: string) {
	return {
		list_emails: defineTool({
			description:
				"List emails in a folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id). Use folder='inbox' for received emails, 'sent' for sent emails.",
			parameters: z.object({
				folder: z
					.string()
					.default(Folders.INBOX)
					.describe(FOLDER_TOOL_DESCRIPTION),
				limit: z
					.number()
					.default(20)
					.describe("Maximum number of emails to return"),
				page: z
					.number()
					.default(1)
					.describe("Page number for pagination"),
			}),
			execute: async ({ folder, limit, page }): Promise<unknown> => {
				return toolListEmails(env, mailboxId, { folder, limit, page });
			},
		}),

		get_email: defineTool({
			description:
				"Get a single email with its full body content and attachments. Use this to read the actual content of an email.",
			parameters: z.object({
				emailId: z.string().describe("The email ID to retrieve"),
			}),
			execute: async ({ emailId }): Promise<unknown> => {
				return toolGetEmail(env, mailboxId, emailId);
			},
		}),

		get_thread: defineTool({
			description:
				"Get all emails in a conversation thread. This is essential for understanding the full context of a conversation before drafting a response. Returns all messages sorted chronologically.",
			parameters: z.object({
				threadId: z
					.string()
					.describe(
						"The thread_id to retrieve all messages for. Get this from an email's thread_id field.",
					),
			}),
			execute: async ({ threadId }): Promise<unknown> => {
				return toolGetThread(env, mailboxId, threadId);
			},
		}),

		search_emails: defineTool({
			description:
				"Search for emails matching a query across subject and body fields.",
			parameters: z.object({
				query: z
					.string()
					.describe(
						"Search query to match against subject and body",
					),
				folder: z
					.string()
					.optional()
					.describe("Optional folder to restrict search to"),
			}),
			execute: async ({ query, folder }): Promise<unknown> => {
				return toolSearchEmails(env, mailboxId, { query, folder });
			},
		}),

		draft_email: defineTool({
			description:
				"Draft a new email (not a reply) and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review. Use this for composing new outbound emails. Write the body as plain text — no HTML tags.",
			parameters: z.object({
				to: z.string().email().describe("Recipient email address"),
				subject: z
					.string()
					.describe("Subject line"),
				body: z
					.string()
					.describe(
						"The plain text body of the email. No HTML — just write normally.",
					),
			}),
			execute: async ({ to, subject, body }): Promise<unknown> => {
				return toolDraftEmail(env, mailboxId, {
					to,
					subject,
					body,
					isPlainText: true,
				});
			},
		}),

		draft_reply: defineTool({
			description:
				"Draft a reply to an existing email and save it to the Drafts folder. This does NOT send — it saves a draft for the operator to review and send from the UI. Write the body as plain text — no HTML tags.",
			parameters: z.object({
				originalEmailId: z
					.string()
					.describe("The ID of the email being replied to"),
				to: z.string().email().describe("Recipient email address"),
				subject: z
					.string()
					.describe("Subject line (usually 'Re: ...')"),
				body: z
					.string()
					.describe(
						"The plain text body of the reply. No HTML — just write normally.",
					),
			}),
			execute: async ({ originalEmailId, to, subject, body }): Promise<unknown> => {
				return toolDraftReply(env, mailboxId, {
					originalEmailId,
					to,
					subject,
					body,
					isPlainText: true,
					runVerifyDraft: true,
				});
			},
		}),

		mark_email_read: defineTool({
			description: "Mark an email as read or unread.",
			parameters: z.object({
				emailId: z.string().describe("The email ID"),
				read: z
					.boolean()
					.describe("true to mark as read, false for unread"),
			}),
			execute: async ({ emailId, read }): Promise<unknown> => {
				return toolMarkEmailRead(env, mailboxId, emailId, read);
			},
		}),

		move_email: defineTool({
			description:
				"Move an email to a different folder (inbox, sent, draft, archive, trash).",
			parameters: z.object({
				emailId: z.string().describe("The email ID"),
				folderId: z
					.string()
					.describe(MOVE_FOLDER_TOOL_DESCRIPTION),
			}),
			execute: async ({ emailId, folderId }): Promise<unknown> => {
				return toolMoveEmail(env, mailboxId, emailId, folderId);
			},
		}),

		discard_draft: defineTool({
			description:
				"Delete a draft email. Use this to discard drafts that are no longer needed or were rejected by the operator.",
			parameters: z.object({
				draftId: z.string().describe("The ID of the draft to delete"),
			}),
			execute: async ({ draftId }): Promise<unknown> => {
				return toolDiscardDraft(env, mailboxId, draftId);
			},
		}),
	};
}

function latestUserText(messages: Array<{ role: string; parts?: Array<unknown> }>): string {
	let latestUserMessage: { role: string; parts?: Array<unknown> } | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") {
			latestUserMessage = messages[index];
			break;
		}
	}
	if (!latestUserMessage?.parts) return "";
	return latestUserMessage.parts
		.filter((part): part is { type: "text"; text: string } => {
			return typeof part === "object"
				&& part !== null
				&& (part as { type?: unknown }).type === "text"
				&& typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function needsEmailTools(text: string): boolean {
	if (/^\s*(?:只|请)?\s*(?:回复|回答|输出)(?:文字)?\s*[：:]/.test(text)) {
		return false;
	}
	return /(?:邮件|邮箱|收件箱|发件箱|草稿|回复|起草|写信|未读|已读|归档|废纸篓|垃圾邮件|搜索|查找|移动|删除|email|mail|inbox|draft|reply|thread|unread|archive|trash|spam)/i.test(text);
}

// Use `any` for the Env generic to avoid type conflicts between the custom
// SEND_EMAIL binding shape and the AIChatAgent constraint.  The actual env
// is fully typed inside the tools via the closure.
export class EmailAgent extends AIChatAgent<any> {
	/** Remove chat history that may survive an address deleted by the old app. */
	async resetForNewMailbox(): Promise<void> {
		this.sql`delete from cf_ai_chat_request_context`;
		this._resumableStream.clearAll();
		await this.persistMessages([], [], { _deleteStaleRows: true });
	}

	private async assertAuthenticatedAccess(): Promise<void> {
		const env = this.env as Env;
		const mailboxId = this.name.trim().toLowerCase();
		// The public Worker validates the signed-in session and mailbox claim
		// before routing this WebSocket. The DO re-checks that the address still
		// has an active owner, without relying on ctx.props (service props are
		// constructor-time and may be absent on an already-running DO instance).
		const access = await env.AUTH_DB.prepare(`
			SELECT 1 FROM mailbox_claims
			WHERE mailbox_id = ? COLLATE NOCASE AND status = 'active'
			LIMIT 1
		`).bind(mailboxId).first();
		if (!access) throw new Error("Unauthorized agent session");
	}

	async onChatMessage(onFinish: any, options?: OnChatMessageOptions) {
		await this.assertAuthenticatedAccess();
		const env = this.env as Env;
		const mailboxId = this.name;
		const workersai = createWorkersAI({ binding: env.AI });
		const emailTools = createEmailTools(env, mailboxId);
		const tools = needsEmailTools(latestUserText(this.messages))
			? emailTools
			: undefined;
		const systemPrompt = await getSystemPrompt(env, mailboxId);
		const recentMessages = pruneMessages({
			messages: await convertToModelMessages(this.messages.slice(-1), {
				tools: emailTools,
				ignoreIncompleteToolCalls: true,
			}),
			reasoning: "all",
			toolCalls: "before-last-2-messages",
			emptyMessages: "remove",
		});
		const timeoutSignal = AbortSignal.timeout(60_000);
		const abortSignal = options?.abortSignal
			? AbortSignal.any([options.abortSignal, timeoutSignal])
			: timeoutSignal;
		// Workers AI's native tool stream can lose the tool result between
		// steps for this provider combination. Use the reliable non-streaming
		// model call and expose each completed step through the UI stream.
		const model = wrapLanguageModel({
			model: workersai(EMAIL_CHAT_MODEL),
			middleware: simulateStreamingMiddleware(),
		});

		const result = streamText({
			model,
			system: tools ? systemPrompt : PLAIN_CHAT_SYSTEM_PROMPT,
			messages: recentMessages,
			...(tools ? {
				tools,
				stopWhen: stepCountIs(2),
				prepareStep: ({ stepNumber }: { stepNumber: number }) => {
					return stepNumber > 0
						? { activeTools: [] as Array<keyof typeof tools>, toolChoice: "none" as const }
						: undefined;
				},
			} : {}),
			maxOutputTokens: 1_024,
			abortSignal,
			onError: ({ error }) => {
				const detail = error instanceof Error
					? `${error.name}: ${error.message}`
					: String(error);
				console.error("Email agent model stream failed:", detail);
			},
			onFinish,
		});

		return result.toUIMessageStreamResponse({
			// AIChatAgent already owns the assistant message being assembled. A
			// second start chunk with the provider's message id makes the client
			// replay the same delta twice on this SDK combination.
			sendStart: false,
			onError: () => "邮件助手暂时不可用，请稍后重试。",
		});
	}

	/**
	 * Handle HTTP requests to the agent DO. Intercepts /onNewEmail
	 * before passing to the default AIChatAgent handler.
	 */
	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/onNewEmail" && request.method === "POST") {
			try {
				const emailData = await request.json() as {
					mailboxId: string;
					emailId: string;
					sender: string;
					subject: string;
					threadId: string;
				};
				const mailboxId = this.name.trim().toLowerCase();
				if (emailData.mailboxId.trim().toLowerCase() !== mailboxId) {
					return new Response(JSON.stringify({ error: "Mailbox mismatch" }), {
						status: 403,
						headers: { "Content-Type": "application/json" },
					});
				}
				emailData.mailboxId = mailboxId;
				const result = await this.handleNewEmail(emailData);
				return new Response(JSON.stringify(result), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (e) {
				console.error("onNewEmail handler failed:", (e as Error).message);
				return new Response(
					JSON.stringify({ error: (e as Error).message }),
					{ status: 500, headers: { "Content-Type": "application/json" } },
				);
			}
		}
		return super.onRequest(request);
	}

	/**
	 * Called when a new email arrives. Reads it, loads the thread,
	 * drafts a response, and saves it to the Drafts folder.
	 */
	async handleNewEmail(emailData: {
		mailboxId: string;
		emailId: string;
		sender: string;
		subject: string;
		threadId: string;
	}) {
		const env = this.env as Env;
		const workersai = createWorkersAI({ binding: env.AI });
		const tools = createEmailTools(env, emailData.mailboxId);
		const systemPrompt = await getSystemPrompt(env, emailData.mailboxId);

		// Pre-read the email and thread so the agent has full context
		// without needing to waste tool calls discovering it
		const stub = getMailboxStub(env, emailData.mailboxId);

		let emailBody = "";
		let threadContext = "";
		try {
			const email = (await stub.getEmail(emailData.emailId)) as EmailFull | null;
			if (email?.body) {
				const isInjection = await isPromptInjection(env.AI, email.body);
				if (isInjection) {
					console.warn("Skipping auto-draft due to detected prompt injection:", emailData.emailId);
					
					// Log to agent chat so the user knows why it skipped
					const newMessages = [
						{
							id: crypto.randomUUID(),
							role: "user" as const,
							content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
						},
						{
							id: crypto.randomUUID(),
							role: "assistant" as const,
							content: "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions.",
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: "⚠️ Blocked auto-draft creation: the email appears to contain prompt injection or malicious instructions." }],
						},
					];
					await this.persistMessages([...this.messages, ...newMessages]);
					
					return;
				}
				
				emailBody = stripHtmlToText(email.body);
			}

		// Load thread for conversation context
		const threadEmails = (await stub.getEmails({ thread_id: emailData.threadId })) as EmailMetadata[];
		if (threadEmails.length > 1) {
			const fullThread = await Promise.all(
				threadEmails.map(async (e) => {
					const full = (await stub.getEmail(e.id)) as EmailFull | null;
					const text = full?.body ? stripHtmlToText(full.body) : "";
					return { id: e.id, sender: e.sender, recipient: e.recipient, subject: e.subject, date: e.date, folder_id: e.folder_id, body_text: text };
				}),
			);
			fullThread.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			threadContext = fullThread
				.map((e) => `[${e.date}] ${e.sender} → ${e.recipient} (${e.folder_id}): ${e.body_text.substring(0, 500)}`)
				.join("\n\n");

			// Scan thread context for prompt injection too -- an attacker
			// could plant an injection in an earlier email in the thread
			// that gets included in the agent's prompt.
			if (threadContext) {
				const threadInjection = await isPromptInjection(env.AI, threadContext);
				if (threadInjection) {
					console.warn("Skipping auto-draft due to prompt injection in thread context:", emailData.threadId);
					const newMessages = [
						{
							id: crypto.randomUUID(),
							role: "user" as const,
							content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"` }],
						},
						{
							id: crypto.randomUUID(),
							role: "assistant" as const,
							content: "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions.",
							createdAt: new Date(),
							parts: [{ type: "text" as const, text: "Blocked auto-draft creation: the thread context appears to contain prompt injection or malicious instructions." }],
						},
					];
					await this.persistMessages([...this.messages, ...newMessages]);
					return;
				}
			}
		}
		} catch (e) {
			console.warn("Pre-read failed, agent will use tools:", (e as Error).message);
		}

		let autoPrompt = `A new email just arrived. Draft an appropriate response using draft_reply.

Email details:
- Mailbox: ${emailData.mailboxId}
- Email ID: ${emailData.emailId}
- From: ${emailData.sender}
- Subject: ${emailData.subject}
- Thread ID: ${emailData.threadId}

Email body:
${emailBody || "(could not pre-read — use get_email to read it)"}`;

		if (threadContext) {
			autoPrompt += `

Full thread history (${emailData.threadId}):
${threadContext}`;
		} else {
			autoPrompt += `

This is the first message in the thread (no prior conversation).`;
		}

		autoPrompt += `

Based on the email content and thread context above, draft a reply using draft_reply. If you need more context, use get_thread with thread ID "${emailData.threadId}".`;

		// Fresh context for auto-draft -- don't include prior chat history
		// to avoid confusing the model with old messages and tool calls
		const messages = [
			{
				role: "user" as const,
				content: autoPrompt,
				parts: [{ type: "text" as const, text: autoPrompt }],
				createdAt: new Date(),
			},
		];

		try {
			const result = await generateText({
				model: workersai(EMAIL_AGENT_MODEL),
				system: systemPrompt,
				messages: await convertToModelMessages(messages),
				tools,
				stopWhen: stepCountIs(5),
				maxOutputTokens: 2_048,
				abortSignal: AbortSignal.timeout(90_000),
			});

			// Check if draft_reply was called (saves to Drafts as side effect).
			// If NOT, save the agent's text response as a draft directly.
			const draftToolCalled = result.steps.some((step) =>
				step.toolCalls.some((tc) => tc.toolName === "draft_reply" || tc.toolName === "draft_email"),
			);

			if (!draftToolCalled && result.text.trim()) {
				// Model generated a draft inline as text -- verify with AI
				const sanitizedText = await verifyDraft(env.AI, result.text.trim());
				if (!sanitizedText) {
					// Inline text was entirely agent commentary, skip
				} else {
					const draftId = crypto.randomUUID();
					const draftStub = getMailboxStub(env, emailData.mailboxId);
					const reSubject = emailData.subject.startsWith("Re:")
						? emailData.subject
						: `Re: ${emailData.subject}`;
					await draftStub.createEmail(
						Folders.DRAFT,
						{
							id: draftId,
							subject: reSubject,
							sender: emailData.mailboxId.toLowerCase(),
							recipient: emailData.sender.toLowerCase(),
							date: new Date().toISOString(),
						// verifyDraft may return plain text or HTML depending on its
						// code path. Only wrap in textToHtml if it's plain text.
						body: /<[a-z][\s\S]*>/i.test(sanitizedText)
							? sanitizedText
							: textToHtml(sanitizedText),
						in_reply_to: emailData.emailId,
							email_references: null,
							thread_id: emailData.threadId,
						},
						[],
					);
					// Inline text saved as draft
				}
			}

			// Persist the conversation into the agent's chat history
			// If it called the tool, we just log a simple success message so the chat isn't cluttered
			// with conversational slop.
			const assistantText = draftToolCalled 
				? `Created draft reply to ${emailData.sender}.`
				: result.text;

			const newMessages = [
				{
					id: crypto.randomUUID(),
					role: "user" as const,
					content: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
					createdAt: new Date(),
					parts: [
						{
							type: "text" as const,
							text: `[Auto-triggered] New email from ${emailData.sender}: "${emailData.subject}"`,
						},
					],
				},
				{
					id: crypto.randomUUID(),
					role: "assistant" as const,
					content: assistantText,
					createdAt: new Date(),
					parts: [
						{
							type: "text" as const,
							text: assistantText,
						},
					],
				},
			];

			await this.persistMessages([...this.messages, ...newMessages]);

			return { status: "draft_generated", text: result.text };
		} catch (e) {
			console.error("Auto-draft failed:", (e as Error).message);
			return { status: "error", error: (e as Error).message };
		}
	}
}

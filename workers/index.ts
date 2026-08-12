// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import { translateEmailContent } from "./lib/ai";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
	ensureMailboxNamespace,
	getUserDataKey,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { notifyTelegram } from "./lib/telegram";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	name: z.string().trim().min(1).max(100),
	customPart: z.string().trim().optional(),
	localPart: z.string().trim().optional(),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const MailboxOrderBody = z.object({
	order: z.array(z.string().email()),
});

const TrustedImageSendersBody = z.object({
	senders: z.array(z.string().email()),
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

const MAILBOX_DOMAIN = "oofo.cc";
const LOCAL_PART_MAX_LENGTH = 64;
const LOCAL_PART_SEGMENT = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

function normalizeLocalPart(value: string): string | null {
	const localPart = value.trim().toLowerCase();
	if (!localPart || localPart.length > LOCAL_PART_MAX_LENGTH) return null;
	const segments = localPart.split(".");
	if (segments.some((segment) => !LOCAL_PART_SEGMENT.test(segment))) return null;
	return localPart;
}

function mailboxAddressForUser(
	user: MailboxContext["Variables"]["authUser"],
	body: z.infer<typeof CreateMailboxBody>,
): string | null {
	if (user.role === "admin") {
		const localPart = body.localPart ?? body.customPart;
		const normalized = localPart ? normalizeLocalPart(localPart) : null;
		return normalized ? `${normalized}@${MAILBOX_DOMAIN}` : null;
	}

	if (!body.customPart || body.localPart !== undefined) return null;
	const prefix = normalizeLocalPart(user.mailboxPrefix);
	const customPart = normalizeLocalPart(body.customPart);
	if (!prefix || !customPart) return null;
	const localPart = `${prefix}.${customPart}`;
	return localPart.length <= LOCAL_PART_MAX_LENGTH
		? `${localPart}@${MAILBOX_DOMAIN}`
		: null;
}

async function listOwnedMailboxIds(env: Env, userId: string): Promise<string[]> {
	const result = await env.AUTH_DB.prepare(`
		SELECT mailbox_id
		FROM mailbox_claims
		WHERE user_id = ? AND status = 'active'
		ORDER BY created_at ASC
	`).bind(userId).all<{ mailbox_id: string }>();
	return result.results.map((row) => row.mailbox_id.toLowerCase());
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", async (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw.split(",").map((d) => d.trim()).filter(Boolean);
	const emailAddresses = await listOwnedMailboxIds(c.env, c.var.authUser.id);
	return c.json({ domains, emailAddresses });
});

// -- Per-user address book and preferences --------------------------

const CONTACTS_FILE = "contacts.json";
const MAILBOX_ORDER_FILE = "settings/mailbox-order.json";
const TRUSTED_IMAGE_SENDERS_FILE = "settings/trusted-image-senders.json";

const ContactBody = z.object({
	name: z.string().trim().min(1),
	email: z.string().trim().email(),
});

interface Contact {
	id: string;
	name: string;
	email: string;
}

async function readContacts(env: Env, userId: string): Promise<Contact[]> {
	const obj = await env.BUCKET.get(getUserDataKey(userId, CONTACTS_FILE));
	if (!obj) return [];
	try {
		const parsed = await obj.json<Contact[]>();
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function writeContacts(env: Env, userId: string, contacts: Contact[]): Promise<void> {
	await env.BUCKET.put(getUserDataKey(userId, CONTACTS_FILE), JSON.stringify(contacts));
}

async function readTrustedImageSenders(env: Env, userId: string): Promise<string[]> {
	const obj = await env.BUCKET.get(getUserDataKey(userId, TRUSTED_IMAGE_SENDERS_FILE));
	if (!obj) {
		const mailboxIds = await listOwnedMailboxIds(env, userId);
		const mailboxes = await listMailboxes(env.BUCKET, mailboxIds);
		return Array.from(
			new Set(
				mailboxes.flatMap((mailbox) => {
					const senders = mailbox.settings.trustedImageSenders;
					return Array.isArray(senders)
						? senders.filter((item): item is string => typeof item === "string")
						: [];
				}).map((sender) => sender.toLowerCase()),
			),
		);
	}
	try {
		const parsed = await obj.json<{ senders?: unknown }>();
		return Array.isArray(parsed.senders)
			? parsed.senders.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

async function writeTrustedImageSenders(env: Env, userId: string, senders: string[]): Promise<string[]> {
	const normalized = Array.from(new Set(senders.map((sender) => sender.toLowerCase())));
	await env.BUCKET.put(
		getUserDataKey(userId, TRUSTED_IMAGE_SENDERS_FILE),
		JSON.stringify({ senders: normalized }),
	);
	return normalized;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

app.get("/api/v1/contacts", async (c) => {
	const contacts = await readContacts(c.env, c.var.authUser.id);
	contacts.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
	return c.json(contacts);
});

app.post("/api/v1/contacts", async (c) => {
	const parsed = ContactBody.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "请填写有效的姓名和邮箱" }, 400);
	const { name } = parsed.data;
	const email = parsed.data.email.toLowerCase();

	const contacts = await readContacts(c.env, c.var.authUser.id);
	if (contacts.some((ct) => ct.email === email)) {
		return c.json({ error: "该邮箱已存在于通讯录中" }, 409);
	}
	const contact: Contact = { id: crypto.randomUUID(), name, email };
	contacts.push(contact);
	await writeContacts(c.env, c.var.authUser.id, contacts);
	return c.json(contact, 201);
});

app.put("/api/v1/contacts/:id", async (c) => {
	const id = c.req.param("id");
	const parsed = ContactBody.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "请填写有效的姓名和邮箱" }, 400);
	const { name } = parsed.data;
	const email = parsed.data.email.toLowerCase();

	const contacts = await readContacts(c.env, c.var.authUser.id);
	const idx = contacts.findIndex((ct) => ct.id === id);
	if (idx === -1) return c.json({ error: "联系人不存在" }, 404);
	if (contacts.some((ct) => ct.email === email && ct.id !== id)) {
		return c.json({ error: "该邮箱已存在于通讯录中" }, 409);
	}
	contacts[idx] = { id, name, email };
	await writeContacts(c.env, c.var.authUser.id, contacts);
	return c.json(contacts[idx]);
});

app.delete("/api/v1/contacts/:id", async (c) => {
	const id = c.req.param("id");
	const contacts = await readContacts(c.env, c.var.authUser.id);
	const next = contacts.filter((ct) => ct.id !== id);
	if (next.length === contacts.length) return c.json({ error: "联系人不存在" }, 404);
	await writeContacts(c.env, c.var.authUser.id, next);
	return c.body(null, 204);
});

// -- Per-user trusted image senders ---------------------------------

app.get("/api/v1/trusted-image-senders", async (c) => {
	return c.json({ senders: await readTrustedImageSenders(c.env, c.var.authUser.id) });
});

app.put("/api/v1/trusted-image-senders", async (c) => {
	const parsed = TrustedImageSendersBody.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "Invalid trusted senders" }, 400);
	const senders = await writeTrustedImageSenders(c.env, c.var.authUser.id, parsed.data.senders);
	return c.json({ senders });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const mailboxIds = await listOwnedMailboxIds(c.env, c.var.authUser.id);
	const allMailboxes = await listMailboxes(c.env.BUCKET, mailboxIds);
	return c.json(allMailboxes);
});

app.get("/api/v1/mailboxes/unread-counts", async (c) => {
	const mailboxIds = await listOwnedMailboxIds(c.env, c.var.authUser.id);
	const allMailboxes = await listMailboxes(c.env.BUCKET, mailboxIds);
	const entries = await Promise.all(
		allMailboxes.map(async (mailbox) => {
			const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailbox.id));
			const folders = await stub.getFolders();
			const inbox = folders.find((folder) => folder.id === Folders.INBOX);
			return [mailbox.id, inbox?.unreadCount ?? 0] as const;
		}),
	);
	return c.json(Object.fromEntries(entries));
});

app.get("/api/v1/mailboxes/order", async (c) => {
	const obj = await c.env.BUCKET.get(
		getUserDataKey(c.var.authUser.id, MAILBOX_ORDER_FILE),
	);
	if (!obj) return c.json({ order: [] });
	try {
		const parsed = await obj.json<{ order?: unknown }>();
		const order = Array.isArray(parsed.order)
			? parsed.order.filter((item): item is string => typeof item === "string")
			: [];
		return c.json({ order });
	} catch {
		return c.json({ order: [] });
	}
});

app.put("/api/v1/mailboxes/order", async (c) => {
	const parsed = MailboxOrderBody.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: "Invalid mailbox order" }, 400);

	const order = parsed.data.order.map((email) => email.toLowerCase());
	const owned = new Set(await listOwnedMailboxIds(c.env, c.var.authUser.id));
	if (order.some((email) => !owned.has(email))) {
		return c.json({ error: "Mailbox order contains an unknown mailbox" }, 400);
	}
	await c.env.BUCKET.put(
		getUserDataKey(c.var.authUser.id, MAILBOX_ORDER_FILE),
		JSON.stringify({ order }),
	);
	return c.json({ order });
});

app.post("/api/v1/mailboxes", async (c) => {
	const parsed = CreateMailboxBody.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid mailbox settings" }, 400);
	const { name, settings } = parsed.data;
	const email = mailboxAddressForUser(c.var.authUser, parsed.data);
	if (!email) {
		return c.json({
			error: c.var.authUser.role === "admin"
				? "localPart must contain valid dot-separated mailbox segments"
				: "customPart must contain valid dot-separated mailbox segments",
		}, 400);
	}
	const customPart = normalizeLocalPart(
		c.var.authUser.role === "admin"
			? (parsed.data.localPart ?? parsed.data.customPart ?? "")
			: (parsed.data.customPart ?? ""),
	);
	if (!(await ensureMailboxNamespace(
		c.env,
		c.var.authUser.id,
		email,
		c.var.authUser.role === "admin",
	))) {
		return c.json({ error: "Mailbox namespace is owned by another account" }, 409);
	}

	const key = `mailboxes/${email}.json`;
	const now = new Date().toISOString();
	const existingClaim = await c.env.AUTH_DB.prepare(`
		SELECT user_id, status
		FROM mailbox_claims
		WHERE mailbox_id = ? COLLATE NOCASE
		LIMIT 1
	`).bind(email).first<{ user_id: string; status: string }>();
	const isRetry = existingClaim?.user_id === c.var.authUser.id
		&& existingClaim.status === "provisioning";
	if (existingClaim && !isRetry) {
		return c.json({ error: "Mailbox address is already reserved" }, 409);
	}
	if (!existingClaim) {
		try {
			await c.env.AUTH_DB.prepare(`
				INSERT INTO mailbox_claims (
					mailbox_id, user_id, custom_part, status,
					created_at, updated_at, deleted_at
				) VALUES (?, ?, ?, 'provisioning', ?, ?, NULL)
			`).bind(email, c.var.authUser.id, customPart, now, now).run();
		} catch (error) {
			// The primary-key constraint is the final authority for concurrent
			// attempts to reserve the same address.
			if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
				return c.json({ error: "Mailbox address is already reserved" }, 409);
			}
			throw error;
		}
	}

	const defaultSettings = {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		autoDraftEnabled: false,
	};
	let finalSettings = { ...defaultSettings, ...settings };
	const created = await c.env.BUCKET.put(key, JSON.stringify(finalSettings), {
		onlyIf: { etagDoesNotMatch: "*" },
		customMetadata: { provisioningOwnerId: c.var.authUser.id },
	});
	const existingObject = created ? null : await c.env.BUCKET.head(key);
	const ownsRetryObject = isRetry
		&& existingObject?.customMetadata?.provisioningOwnerId === c.var.authUser.id;
	if (!created && !ownsRetryObject) {
		await c.env.AUTH_DB.prepare(`
			UPDATE mailbox_claims
			SET status = 'deleted', updated_at = ?, deleted_at = ?
			WHERE mailbox_id = ? AND user_id = ? AND status = 'provisioning'
		`).bind(now, now, email, c.var.authUser.id).run();
		return c.json({ error: "Mailbox address is already reserved" }, 409);
	}
	if (!created) {
		const existingSettings = await c.env.BUCKET.get(key);
		if (!existingSettings) {
			throw new Error(`Mailbox provisioning lost its R2 settings: ${email}`);
		}
		finalSettings = await existingSettings.json<typeof finalSettings>();
	}

	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	// Old versions removed only the R2 settings object. Clear any MailboxDO and
	// EmailAgent state that might still exist for that address before activation.
	await stub.resetForNewMailbox();
	const agentStub = c.env.EMAIL_AGENT.get(c.env.EMAIL_AGENT.idFromName(email));
	await agentStub.resetForNewMailbox();
	await stub.getFolders();
	await c.env.AUTH_DB.prepare(`
		UPDATE mailbox_claims
		SET status = 'active', updated_at = ?, deleted_at = NULL
		WHERE mailbox_id = ? AND user_id = ? AND status = 'provisioning'
	`).bind(new Date().toISOString(), email, c.var.authUser.id).run();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.var.mailboxId;
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.var.mailboxId;
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.var.mailboxId;
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	const now = new Date().toISOString();
	const result = await c.env.AUTH_DB.prepare(`
		UPDATE mailbox_claims
		SET status = 'deleted', updated_at = ?, deleted_at = ?
		WHERE mailbox_id = ? AND user_id = ? AND status = 'active'
	`).bind(now, now, mailboxId, c.var.authUser.id).run();
	if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Not found" }, 404);
	// Keep the R2 settings and Durable Object data in place. The deleted claim
	// is a permanent tombstone, so a future account can never inherit old mail.
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	c.executionCtx.waitUntil(
		sendEmail(c.env.RESEND_API_KEY, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}).catch((e) => console.error("Deferred email delivery failed:", (e as Error).message)),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/translate", async (c: AppContext) => {
	const mailboxId = c.var.mailboxId;
	const emailId = c.req.param("id")!;
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);

	try {
		const sourceHash = await sha256Hex(`${email.subject || ""}\n${email.body || ""}`);
		const cacheKey = `translations/${mailboxId}/${emailId}.json`;
		const cachedObj = await c.env.BUCKET.get(cacheKey);
		if (cachedObj) {
			const cached = await cachedObj.json<{
				sourceHash?: string;
				translation?: unknown;
			}>();
			if (cached.sourceHash === sourceHash && cached.translation) {
				return c.json(cached.translation);
			}
		}

		const translation = await translateEmailContent(c.env.AI, {
			subject: email.subject,
			body: email.body,
		});
		await c.env.BUCKET.put(
			cacheKey,
			JSON.stringify({
				sourceHash,
				translatedAt: new Date().toISOString(),
				translation,
			}),
		);
		return c.json(translation);
	} catch (e) {
		console.error("Email translation failed:", (e as Error).message);
		return c.json({ error: "翻译失败，请稍后重试" }, 502);
	}
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

async function receiveEmail(
	event: { raw: ReadableStream; rawSize: number; to: string },
	env: Env,
	ctx: ExecutionContext,
) {
	const envelopeRecipient = event.to.trim().toLowerCase();
	if (!envelopeRecipient) throw new Error("received email with empty envelope recipient");

	const claim = await env.AUTH_DB.prepare(`
		SELECT mc.mailbox_id, u.role
		FROM mailbox_claims mc
		JOIN users u ON u.id = mc.user_id
		WHERE mc.mailbox_id = ? COLLATE NOCASE AND mc.status = 'active'
		LIMIT 1
	`).bind(envelopeRecipient).first<{ mailbox_id: string; role: "admin" | "user" }>();
	if (!claim) {
		console.log(`Ignoring email for ${envelopeRecipient}: mailbox is not active`);
		return;
	}
	const mailboxId = claim.mailbox_id.toLowerCase();
	if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) {
		console.log(`Ignoring email for ${mailboxId}: mailbox settings do not exist`);
		return;
	}

	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	const messageId = crypto.randomUUID();

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (!inReplyTo && emailReferences.length === 0) {
		const subjectThread = await (stub as any).findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(), recipient: allRecipients.join(", ") || mailboxId,
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	}, attachmentData);

	// Push a Telegram notification (no-op unless configured). Best-effort:
	// runs after the email is already stored and never blocks reception.
	// The existing Worker-level Telegram credentials belong to the initial
	// administrator. Never leak another account's inbound mail to that chat.
	if (claim.role === "admin") {
		ctx.waitUntil(
			notifyTelegram(env, {
				mailboxId,
				sender: (parsedEmail.from?.address || "").toLowerCase(),
				subject: parsedEmail.subject || "",
				body: parsedEmail.html || parsedEmail.text || "",
				attachmentCount: attachmentData.length,
			}).catch((e) => console.error("Telegram notify failed:", (e as Error).message)),
		);
	}

	// Auto-draft is opt-in. Only an explicit `autoDraftEnabled: true` triggers
	// the agent; absent, false, invalid, or unreadable settings all stay off.
	// The email is already stored above, so receiving is unaffected either way.
	let autoDraftEnabled = false;
	try {
		const settingsObj = await env.BUCKET.get(`mailboxes/${mailboxId}.json`);
		if (settingsObj) {
			const settings = await settingsObj.json<Record<string, unknown>>();
			autoDraftEnabled = settings.autoDraftEnabled === true;
		}
	} catch {
		// Fail closed: a settings read failure must not start AI work.
	}

	if (autoDraftEnabled) {
		const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
		ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mailboxId, emailId: messageId, sender: (parsedEmail.from?.address || "").toLowerCase(), subject: parsedEmail.subject || "", threadId }),
		})).catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message)));
	}
}

export { app, receiveEmail };

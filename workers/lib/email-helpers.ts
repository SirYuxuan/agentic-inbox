// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email helpers to eliminate duplication across API routes, MCP, and agent.
 *
 * Includes: DO stub helpers, sender validation, message-ID generation,
 * threading, HTML utilities, and tool-logic (getFullEmail / getFullThread).
 */
import type { MailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { formatQuotedDate } from "../../shared/dates";

// ── DO Stub ────────────────────────────────────────────────────────

/**
 * Resolve a MailboxDO stub from a mailbox email address.
 * Replaces the repeated 3-line ns.idFromName / ns.get pattern.
 */
export function getMailboxStub(
	env: Env,
	mailboxId: string,
): DurableObjectStub<MailboxDO> {
	const ns = env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	return ns.get(id);
}

// ── Mailbox Listing ────────────────────────────────────────────────

export function getMailboxNamespace(mailboxId: string): string | null {
	const separator = mailboxId.lastIndexOf("@");
	if (separator <= 0) return null;
	const firstSegment = mailboxId.slice(0, separator).split(".")[0]?.trim().toLowerCase();
	return firstSegment || null;
}

export function getUserDataKey(userId: string, name: string): string {
	return `users/${encodeURIComponent(userId)}/${name}`;
}

/**
 * Ensure the first local-part segment belongs to this account. Administrators
 * may reserve a previously unused namespace; regular users must have reserved
 * theirs atomically during registration.
 */
export async function ensureMailboxNamespace(
	env: Env,
	userId: string,
	mailboxId: string,
	canReserve: boolean,
): Promise<boolean> {
	const namespace = getMailboxNamespace(mailboxId);
	if (!namespace) return false;

	if (canReserve) {
		await env.AUTH_DB.prepare(`
			INSERT INTO mailbox_namespaces (prefix, user_id, created_at)
			VALUES (?, ?, ?)
			ON CONFLICT(prefix) DO NOTHING
		`).bind(namespace, userId, new Date().toISOString()).run();
	}

	const owner = await env.AUTH_DB.prepare(`
		SELECT user_id
		FROM mailbox_namespaces
		WHERE prefix = ? COLLATE NOCASE
		LIMIT 1
	`).bind(namespace).first<{ user_id: string }>();
	return owner?.user_id === userId;
}

/**
 * Load mailbox settings from R2. When IDs are supplied, only those mailboxes
 * are returned; omitting IDs is reserved for the legacy bootstrap path.
 */
export async function listMailboxes(
	bucket: R2Bucket,
	mailboxIds?: readonly string[],
): Promise<{ id: string; email: string; name: string; settings: Record<string, unknown> }[]> {
	let ids: string[];
	if (mailboxIds) {
		ids = [...new Set(mailboxIds.map((id) => id.toLowerCase()))];
	} else {
		ids = [];
		let cursor: string | undefined;
		do {
			const page = await bucket.list({ prefix: "mailboxes/", cursor });
			ids.push(...page.objects
				.map((obj) => obj.key.match(/^mailboxes\/(.+)\.json$/)?.[1])
				.filter((id): id is string => Boolean(id)));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}

	const mailboxes = await Promise.all(ids.map(async (id) => {
		const key = `mailboxes/${id}.json`;
		let settings: Record<string, unknown> = {};
		try {
			const stored = await bucket.get(key);
			if (!stored) return null;
			settings = await stored.json<Record<string, unknown>>();
		} catch {
			settings = {};
		}
		const fromName = typeof settings.fromName === "string" ? settings.fromName.trim() : "";
		return { id, email: id, name: fromName || id, settings };
	}));

	return mailboxes.filter((mailbox): mailbox is NonNullable<typeof mailbox> => mailbox !== null);
}

/**
 * Claim pre-auth mailboxes for the initial administrator without changing
 * any existing R2 settings or Durable Object data. Existing claims (including
 * deleted tombstones) are deliberately never reassigned.
 */
export async function bootstrapExistingMailboxClaims(
	env: Env,
	userId: string,
): Promise<{ discovered: number; claimed: number }> {
	const markerKey = "legacy_mailboxes_claimed";
	const marker = await env.AUTH_DB.prepare(`
		SELECT value FROM system_meta WHERE key = ? LIMIT 1
	`).bind(markerKey).first<{ value: string }>();
	if (marker) {
		if (marker.value !== userId) {
			throw new Error("Legacy mailboxes were bootstrapped to a different account");
		}
		return { discovered: 0, claimed: 0 };
	}

	// The pre-auth app stored these preferences globally. Preserve them for the
	// initial administrator while all new reads/writes use per-user keys.
	for (const legacyKey of [
		"contacts.json",
		"settings/mailbox-order.json",
		"settings/trusted-image-senders.json",
	]) {
		const source = await env.BUCKET.get(legacyKey);
		if (!source) continue;
		await env.BUCKET.put(
			getUserDataKey(userId, legacyKey),
			await source.arrayBuffer(),
			{ onlyIf: { etagDoesNotMatch: "*" } },
		);
	}

	const mailboxes = await listMailboxes(env.BUCKET);
	let claimed = 0;
	const now = new Date().toISOString();
	const namespaces = [...new Set(mailboxes
		.map((mailbox) => getMailboxNamespace(mailbox.id))
		.filter((prefix): prefix is string => Boolean(prefix)))];

	for (let offset = 0; offset < namespaces.length; offset += 100) {
		const chunk = namespaces.slice(offset, offset + 100);
		await env.AUTH_DB.batch(chunk.map((prefix) =>
			env.AUTH_DB.prepare(`
				INSERT INTO mailbox_namespaces (prefix, user_id, created_at)
				VALUES (?, ?, ?)
				ON CONFLICT(prefix) DO NOTHING
			`).bind(prefix, userId, now)
		));
	}

	for (let offset = 0; offset < namespaces.length; offset += 100) {
		const chunk = namespaces.slice(offset, offset + 100);
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(", ");
		const conflict = await env.AUTH_DB.prepare(`
			SELECT prefix
			FROM mailbox_namespaces
			WHERE prefix IN (${placeholders}) AND user_id <> ?
			LIMIT 1
		`).bind(...chunk, userId).first<{ prefix: string }>();
		if (conflict) {
			throw new Error(`Legacy mailbox namespace is already owned: ${conflict.prefix}`);
		}
	}

	// Keep batches small enough for D1's per-request query limits while still
	// making each chunk atomic.
	for (let offset = 0; offset < mailboxes.length; offset += 100) {
		const chunk = mailboxes.slice(offset, offset + 100);
		if (chunk.length === 0) continue;
		const results = await env.AUTH_DB.batch(chunk.map((mailbox) =>
			env.AUTH_DB.prepare(`
				INSERT INTO mailbox_claims (
					mailbox_id, user_id, status, created_at, updated_at, deleted_at
				) VALUES (?, ?, 'active', ?, ?, NULL)
				ON CONFLICT(mailbox_id) DO NOTHING
			`).bind(mailbox.id.toLowerCase(), userId, now, now)
		));
		claimed += results.reduce((total, result) => total + (result.meta.changes ?? 0), 0);
	}

	await env.AUTH_DB.prepare(`
		INSERT INTO system_meta (key, value)
		VALUES (?, ?)
		ON CONFLICT(key) DO NOTHING
	`).bind(markerKey, userId).run();
	const completed = await env.AUTH_DB.prepare(`
		SELECT value FROM system_meta WHERE key = ? LIMIT 1
	`).bind(markerKey).first<{ value: string }>();
	if (completed?.value !== userId) {
		throw new Error("Legacy mailbox bootstrap ownership conflict");
	}

	return { discovered: mailboxes.length, claimed };
}

// ── Sender Validation ──────────────────────────────────────────────

/**
 * Normalise to/from addresses and validate the sender matches the mailbox.
 * Returns the normalised values or throws with a user-facing message.
 */
export function validateSender(
	to: string | string[],
	from: string | { email: string; name: string },
	mailboxId: string,
): { toStr: string; fromEmail: string; fromDomain: string } {
	const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
	const fromEmail = (typeof from === "string" ? from : from.email).toLowerCase();

	if (fromEmail !== mailboxId.toLowerCase()) {
		throw new SenderValidationError("From address must match the mailbox email address");
	}

	const fromDomain = fromEmail.split("@")[1];
	if (!fromDomain) {
		throw new SenderValidationError("Invalid sender email address");
	}

	return { toStr, fromEmail, fromDomain };
}

export class SenderValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SenderValidationError";
	}
}

// ── Message ID ─────────────────────────────────────────────────────

/**
 * Generate an internal UUID and a proper RFC 2822 Message-ID.
 */
export function generateMessageId(fromDomain: string): {
	messageId: string;
	outgoingMessageId: string;
} {
	const messageId = crypto.randomUUID();
	const outgoingMessageId = `${messageId}@${fromDomain}`;
	return { messageId, outgoingMessageId };
}

// ── Threading ──────────────────────────────────────────────────────

/**
 * Build the References chain and In-Reply-To from an original email.
 */
export function buildReferencesChain(original: EmailFull): {
	originalMsgId: string;
	references: string[];
	threadId: string;
} {
	const originalMsgId = original.message_id || original.id;
	let existingRefs: string[] = [];
	if (original.email_references) {
		try {
			existingRefs = JSON.parse(original.email_references);
		} catch {
			// Malformed JSON in email_references — treat as empty
		}
	}
	const references = [...existingRefs, originalMsgId].filter(Boolean);
	const threadId = original.thread_id || original.id;
	return { originalMsgId, references, threadId };
}

/**
 * Build threading headers (In-Reply-To + References) for the email binding.
 */
export function buildThreadingHeaders(
	originalMsgId: string,
	references: string[],
): Record<string, string> {
	return {
		"In-Reply-To": `<${originalMsgId}>`,
		...(references.length > 0
			? { References: references.map((r) => `<${r}>`).join(" ") }
			: {}),
	};
}

// ── Draft-follows-in_reply_to ──────────────────────────────────────

/**
 * If the given email is a draft with an in_reply_to, resolve the real original.
 * Used by reply/forward routes to avoid threading against the draft itself.
 */
export async function resolveOriginalEmail(
	stub: DurableObjectStub<MailboxDO>,
	email: EmailFull,
): Promise<EmailFull> {
	if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
		const realOriginal = (await stub.getEmail(email.in_reply_to)) as EmailFull | null;
		if (realOriginal) return realOriginal;
	}
	return email;
}

// ── HTML Utilities ─────────────────────────────────────────────────

/**
 * Escape all five OWASP-recommended HTML special characters in plain text.
 * Safe for use in both text content and attribute contexts.
 */
export function escapeHtml(text: string): string {
	if (!text) return "";
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Convert plain text to a simple HTML block with preserved whitespace.
 * Uses both `white-space:pre-wrap` (modern clients) and `<br>` tags
 * (clients that strip inline styles, e.g. Outlook) as a belt-and-suspenders approach.
 */
export function textToHtml(text: string): string {
	if (!text) return "";
	const escaped = escapeHtml(text).replace(/\n/g, "<br>");
	return `<div style="white-space:pre-wrap">${escaped}</div>`;
}

/**
 * Strip HTML tags and normalize whitespace to produce plain text.
 * Removes <style> and <script> blocks first to avoid injecting their
 * content into the output.
 */
export function stripHtmlToText(html: string): string {
	if (!html) return "";
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Format a date string for use in quoted reply blocks.
 * @deprecated Use `formatQuotedDate` from `shared/dates` directly.
 */
export const formatEmailDate = formatQuotedDate;

/**
 * Build a quoted reply block HTML string from original email data.
 */
export function buildQuotedReplyBlock(original: {
	date?: string;
	sender?: string;
	body?: string;
}): string {
	if (!original.body) return "";
	
	// HTML-escape sender and date to prevent injection
	const originalSender = escapeHtml(original.sender || "unknown");
	const originalDate = escapeHtml(formatEmailDate(original.date || ""));

	// Sanitize the body to plain text to prevent stored XSS.
	// The original HTML renders safely in the sandboxed iframe, but quoted
	// reply blocks are injected into the compose editor and outgoing emails
	// where raw HTML would execute. Convert to escaped plain text instead.
	const plainBody = stripHtmlToText(original.body);
	const bodyToQuote = escapeHtml(plainBody).replace(/\n/g, "<br>");

	return `<br><blockquote style="border-left: 2px solid #ccc; margin: 0; padding-left: 1em; color: #666;">在 ${originalDate}，${originalSender} 写道：<br><br>${bodyToQuote}</blockquote>`;
}

// ── Tool Logic (getFullEmail / getFullThread) ──────────────────────

type MailboxThreadReaderStub = {
	getThreadEmails: (threadId: string) => Promise<EmailFull[]>;
};

/**
 * Fetch a single email and return it with both HTML and plain-text body.
 * Returns null if the email is not found.
 */
export async function getFullEmail(
	stub: DurableObjectStub<MailboxDO>,
	emailId: string,
) {
	const email = (await stub.getEmail(emailId)) as EmailFull | null;
	if (!email) return null;

	const textBody = email.body ? stripHtmlToText(email.body) : "";
	return { ...email, body_text: textBody, body_html: email.body };
}

/**
 * Fetch all emails in a thread with full bodies in a single DO call.
 * Uses `getThreadEmails` which runs 2 SQL queries (emails + attachments)
 * instead of the previous N+1 pattern (1 list query + N getEmail calls).
 */
export async function getFullThread(
	stub: DurableObjectStub<MailboxDO>,
	threadId: string,
) {
	const threadStub = stub as unknown as MailboxThreadReaderStub;
	const emails = await threadStub.getThreadEmails(threadId);

	const enriched = emails.map((email) => {
		const textBody = email.body ? stripHtmlToText(email.body) : "";
		return { ...email, body_text: textBody };
	});

	// Already sorted ASC by the DO query, but ensure consistency
	enriched.sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
	);

	return { thread_id: threadId, message_count: enriched.length, messages: enriched };
}

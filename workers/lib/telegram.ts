// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Push notifications for inbound email to Telegram.
 *
 * Enabled only when both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set as
 * Worker secrets. Sending is best-effort: callers should invoke this via
 * `ctx.waitUntil(...)` so a Telegram outage never blocks or fails email
 * reception.
 */

import { stripHtmlToText } from "./email-helpers";
import type { Env } from "../types";

const PREVIEW_MAX_LENGTH = 200;

/** Escape the characters Telegram's HTML parse mode treats as markup. */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** Build a short plain-text preview from the email body (HTML or text). */
function buildPreview(body: string): string {
	const text = stripHtmlToText(body);
	if (text.length <= PREVIEW_MAX_LENGTH) return text;
	return `${text.slice(0, PREVIEW_MAX_LENGTH).trim()}…`;
}

export interface TelegramNotification {
	/** Mailbox that received the email (its address). */
	mailboxId: string;
	/** Sender address. */
	sender: string;
	/** Email subject (may be empty). */
	subject: string;
	/** Raw email body — HTML or plain text. */
	body: string;
	/** Number of attachments on the email. */
	attachmentCount: number;
}

/**
 * Send a Telegram message for a newly received email. No-op (returns silently)
 * when Telegram is not configured. Throws on network/API failure so the caller
 * can log it — but callers must not let that failure abort email reception.
 */
export async function notifyTelegram(
	env: Env,
	notification: TelegramNotification,
): Promise<void> {
	const token = env.TELEGRAM_BOT_TOKEN;
	const chatId = env.TELEGRAM_CHAT_ID;
	if (!token || !chatId) return; // Telegram not configured — nothing to do.

	const { mailboxId, sender, subject, body, attachmentCount } = notification;

	const lines = [
		`📧 <b>新邮件</b> · ${escapeHtml(mailboxId)}`,
		`<b>发件人：</b>${escapeHtml(sender || "(未知)")}`,
		`<b>主题：</b>${escapeHtml(subject || "(无主题)")}`,
	];
	if (attachmentCount > 0) {
		lines.push(`📎 ${attachmentCount} 个附件`);
	}
	const preview = buildPreview(body);
	if (preview) {
		lines.push("────────", escapeHtml(preview));
	}

	const response = await fetch(
		`https://api.telegram.org/bot${token}/sendMessage`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: lines.join("\n"),
				parse_mode: "HTML",
				disable_web_page_preview: true,
			}),
		},
	);

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Telegram sendMessage failed: ${response.status} ${detail}`,
		);
	}
}

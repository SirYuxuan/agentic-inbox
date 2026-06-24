// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via the Resend HTTP API.
 *
 * Sends emails through `POST https://api.resend.com/emails` using a
 * `RESEND_API_KEY` secret. The sender domain must be verified in Resend.
 *
 * See: https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * Resend only accepts `from`/`reply_to` as RFC 5322 strings, so collapse the
 * `{ email, name }` object form into `"Name <email>"`.
 */
function formatAddress(address: string | { email: string; name: string }): string {
	if (typeof address === "string") return address;
	return address.name ? `${address.name} <${address.email}>` : address.email;
}

/**
 * Send an email using the Resend HTTP API.
 *
 * @param apiKey  - The `RESEND_API_KEY` secret from env
 * @param params  - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws On validation or delivery errors
 */
export async function sendEmail(
	apiKey: string,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	if (!apiKey) {
		throw new Error("RESEND_API_KEY is not configured");
	}

	const body: Record<string, unknown> = {
		from: formatAddress(params.from),
		to: params.to,
		subject: params.subject,
	};

	if (params.html) body.html = params.html;
	if (params.text) body.text = params.text;
	if (params.cc) body.cc = params.cc;
	if (params.bcc) body.bcc = params.bcc;
	if (params.replyTo) body.reply_to = formatAddress(params.replyTo);

	if (params.headers && Object.keys(params.headers).length > 0) {
		body.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		body.attachments = params.attachments.map((att) => ({
			filename: att.filename,
			content: att.content,
			content_type: att.type,
			...(att.contentId ? { content_id: att.contentId } : {}),
		}));
	}

	const res = await fetch(RESEND_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const detail = await res.text();
		let message = detail;
		try {
			const parsed = JSON.parse(detail) as { message?: string; error?: string };
			message = parsed.message || parsed.error || detail;
		} catch {
			// Non-JSON error body — fall back to the raw text.
		}
		throw new Error(`Resend send failed (${res.status}): ${message}`);
	}

	const result = (await res.json()) as { id: string };
	return { messageId: result.id };
}

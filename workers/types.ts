// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	AUTH_DB: D1Database;
	REGISTRATION_KEY: string;
	RESEND_API_KEY: string;
	// Optional Telegram notifications for inbound email. When both are set,
	// each received email is pushed to this chat. Leave unset to disable.
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_CHAT_ID?: string;
}

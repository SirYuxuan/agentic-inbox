// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware to handle repetitive Mailbox Durable Object instantiation.
 * Checks the authenticated user's active D1 ownership claim and the R2
 * settings object, then attaches the canonical ID and DO stub to the context.
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import type { AuthUser } from "./auth";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		authUser: AuthUser;
		mailboxId: string;
		mailboxStub: DurableObjectStub<MailboxDO>;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	if (rawId === "order" || rawId === "unread-counts") {
		await next();
		return;
	}
	let mailboxId: string;
	try {
		mailboxId = decodeURIComponent(rawId).trim().toLowerCase();
	} catch {
		return c.json({ error: "Invalid mailbox ID" }, 400);
	}

	const user = c.var.authUser;
	if (!user) return c.json({ error: "Authentication required" }, 401);

	const claim = await c.env.AUTH_DB.prepare(`
		SELECT mailbox_id
		FROM mailbox_claims
		WHERE mailbox_id = ? COLLATE NOCASE
			AND user_id = ?
			AND status = 'active'
		LIMIT 1
	`).bind(mailboxId, user.id).first<{ mailbox_id: string }>();
	if (!claim) return c.json({ error: "Not found" }, 404);
	mailboxId = claim.mailbox_id.toLowerCase();

	// Verify mailbox exists
	const key = `mailboxes/${mailboxId}.json`;
	const obj = await c.env.BUCKET.head(key);
	if (!obj) {
		return c.json({ error: "Not found" }, 404);
	}

	// Instantiate DO stub
	const ns = c.env.MAILBOX;
	const id = ns.idFromName(mailboxId);
	const stub = ns.get(id);

	c.set("mailboxId", mailboxId);
	c.set("mailboxStub", stub);

	await next();
});

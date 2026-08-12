// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail } from "./index";
import {
	authenticateSession,
	hashSessionToken,
	SESSION_COOKIE_NAME,
	type AuthUser,
} from "./lib/auth";
import { bootstrapExistingMailboxClaims } from "./lib/email-helpers";
import { EmailMCP } from "./mcp";
import { authRoutes } from "./routes/auth";
import type { Env } from "./types";

export { MailboxDO } from "./durableObject";
export { EmailAgent } from "./agent";
export { EmailMCP } from "./mcp";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{
	Bindings: Env;
	Variables: { authUser: AuthUser; sessionTokenHash: string };
}>();

// React Router lazy route discovery fetches /__manifest before a client-side
// navigation. It must be reachable while the visitor is still signed out;
// otherwise the auth redirect turns the expected JSON response into login
// HTML and navigation between the public auth pages crashes.
const PUBLIC_PAGE_PATHS = new Set(["/login", "/register", "/__manifest"]);
const PUBLIC_ASSET_PREFIXES = [
	"/assets/",
	"/build/",
	"/favicon",
	"/@vite/",
	"/@react-refresh",
];
const DEV_ASSET_PREFIXES = [
	"/@fs/",
	"/@id/",
	"/app/",
	"/node_modules/",
	"/shared/",
	"/__react-router",
	"/__vite",
];

function isPublicRequest(pathname: string): boolean {
	const normalizedPath = pathname.length > 1
		? pathname.replace(/\/+$/, "")
		: pathname;
	return PUBLIC_PAGE_PATHS.has(normalizedPath)
		|| pathname.startsWith("/api/v1/auth/")
		|| PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
		|| (import.meta.env.DEV
			&& DEV_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix)));
}

function hasValidOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	if (!origin) return true;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}

async function getInitialAdmin(env: Env): Promise<{ id: string } | null> {
	return env.AUTH_DB.prepare(
		`SELECT id FROM users
		WHERE username = 'yuxuan' COLLATE NOCASE AND role = 'admin'
		LIMIT 1`,
	).first<{ id: string }>();
}

async function bootstrapLegacyMailboxes(env: Env): Promise<void> {
	const admin = await getInitialAdmin(env);
	if (!admin) throw new Error("Initial yuxuan administrator is missing");
	await bootstrapExistingMailboxClaims(env, admin.id);
}

// Password-session authentication and tenant context.
app.use("*", async (c, next) => {
	if (isPublicRequest(c.req.path)) {
		// Reserve every pre-auth mailbox namespace for the initial administrator
		// before allowing the first new account registration.
		if (c.req.path === "/api/v1/auth/register" && c.req.method === "POST") {
			try {
				await bootstrapLegacyMailboxes(c.env);
			} catch (error) {
				console.error("Legacy mailbox bootstrap failed:", (error as Error).message);
				return c.json({ error: "Registration service unavailable" }, 503);
			}
		}
		return next();
	}

	let user: AuthUser | null;
	let sessionTokenHash: string;
	try {
		await bootstrapLegacyMailboxes(c.env);
		const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
		user = await authenticateSession(
			c.env.AUTH_DB,
			sessionToken,
		);
		sessionTokenHash = sessionToken ? await hashSessionToken(sessionToken) : "";
	} catch (error) {
		console.error("Authentication middleware failed:", (error as Error).message);
		return c.json({ error: "Authentication service unavailable" }, 503);
	}

	if (!user) {
		if (
			c.req.path.startsWith("/api/")
			|| c.req.path.startsWith("/agents/")
			|| c.req.path.startsWith("/mcp")
		) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const url = new URL(c.req.url);
		const nextPath = `${url.pathname}${url.search}`;
		return c.redirect(`/login?next=${encodeURIComponent(nextPath)}`, 302);
	}

	if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !hasValidOrigin(c.req.raw)) {
		return c.json({ error: "Invalid request origin" }, 403);
	}

	c.set("authUser", user);
	c.set("sessionTokenHash", sessionTokenHash);
	await next();
	c.header("Cache-Control", "private, no-store");
});

// Public login/register/session endpoints. Individual handlers still validate
// registration keys, passwords, request origins, and session cookies.
app.route("/api/v1/auth", authRoutes);

// MCP server endpoint — used by AI coding tools (ProtoAgent, Claude Code, Cursor, etc.)
// Must be before API routes and React Router catch-all
const mcpHandler = EmailMCP.serve("/mcp", { binding: "EMAIL_MCP" });
app.all("/mcp", async (c) => {
	if (c.var.authUser.role !== "admin") return c.json({ error: "Forbidden" }, 403);
	const executionCtx = c.executionCtx as ExecutionContext & {
		props?: { userId: string; sessionTokenHash: string };
	};
	executionCtx.props = {
		userId: c.var.authUser.id,
		sessionTokenHash: c.var.sessionTokenHash,
	};
	return mcpHandler.fetch(c.req.raw, c.env, executionCtx);
});
app.all("/mcp/*", async (c) => {
	if (c.var.authUser.role !== "admin") return c.json({ error: "Forbidden" }, 403);
	const executionCtx = c.executionCtx as ExecutionContext & {
		props?: { userId: string; sessionTokenHash: string };
	};
	executionCtx.props = {
		userId: c.var.authUser.id,
		sessionTokenHash: c.var.sessionTokenHash,
	};
	return mcpHandler.fetch(c.req.raw, c.env, executionCtx);
});

// Mount the API routes
app.route("/", apiApp);

// Agent WebSocket routing - must be before React Router catch-all
app.all("/agents/*", async (c) => {
	if (!hasValidOrigin(c.req.raw)) return c.json({ error: "Invalid request origin" }, 403);
	const path = new URL(c.req.url).pathname.split("/").filter(Boolean);
	const agentName = path[1]?.toLowerCase();
	let mailboxId: string;
	try {
		mailboxId = decodeURIComponent(path[2] ?? "").trim().toLowerCase();
	} catch {
		return c.json({ error: "Invalid agent mailbox" }, 400);
	}
	if ((agentName !== "email-agent" && agentName !== "emailagent") || !mailboxId) {
		return c.text("Agent not found", 404);
	}
	if (path[3]?.toLowerCase() === "onnewemail") {
		return c.text("Agent not found", 404);
	}
	const claim = await c.env.AUTH_DB.prepare(
		`SELECT 1 FROM mailbox_claims
		WHERE mailbox_id = ? COLLATE NOCASE
			AND user_id = ? AND status = 'active'
		LIMIT 1`,
	).bind(mailboxId, c.var.authUser.id).first();
	if (!claim) return c.json({ error: "Not found" }, 404);

	const response = await routeAgentRequest(c.req.raw, c.env, {
		props: {
			userId: c.var.authUser.id,
			role: c.var.authUser.role,
			mailboxId,
			sessionTokenHash: c.var.sessionTokenHash,
		},
	});
	if (response) return response;
	return c.text("Agent not found", 404);
});

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

// Export the Hono app as the default export with an email handler
export default {
	fetch: app.fetch,
	async email(
		event: { raw: ReadableStream; rawSize: number; to: string },
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await bootstrapLegacyMailboxes(env);
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
};

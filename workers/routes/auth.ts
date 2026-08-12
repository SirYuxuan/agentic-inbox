// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
	authenticateSession,
	createSession,
	createUser,
	deleteExpiredSessions,
	deleteSession,
	MailboxPrefixSchema,
	PASSWORD_HASH_ITERATIONS,
	PasswordSchema,
	PasswordCryptoError,
	secretsEqual,
	SESSION_COOKIE_NAME,
	SESSION_TTL_SECONDS,
	UsernameSchema,
	verifyPassword,
	type AuthContext,
} from "../lib/auth";

const RegisterSchema = z.object({
	username: UsernameSchema,
	password: PasswordSchema,
	mailboxPrefix: MailboxPrefixSchema,
	registrationKey: z.string().min(1).max(512),
});

const LoginSchema = z.object({
	username: UsernameSchema,
	password: PasswordSchema,
});

const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS = 15 * 60 * 1_000;
const LOGIN_MAX_FAILURES = 5;

function acceptsJson(contentType: string | undefined): boolean {
	return contentType?.toLowerCase().includes("application/json") === true;
}

async function loginAttemptKey(c: Parameters<typeof getCookie>[0], username: string) {
	const address = c.req.header("CF-Connecting-IP") || "unknown";
	const input = new TextEncoder().encode(`${address}\n${username}`);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isLoginBlocked(db: D1Database, key: string, now: number): Promise<boolean> {
	const row = await db.prepare(`
		SELECT blocked_until
		FROM auth_login_attempts
		WHERE key = ?
		LIMIT 1
	`).bind(key).first<{ blocked_until: number }>();
	return (row?.blocked_until ?? 0) > now;
}

async function recordLoginFailure(db: D1Database, key: string, now: number): Promise<void> {
	const cutoff = now - LOGIN_WINDOW_MS;
	await db.prepare(`
		INSERT INTO auth_login_attempts (
			key, failures, window_started_at, blocked_until, updated_at
		) VALUES (?, 1, ?, 0, ?)
		ON CONFLICT(key) DO UPDATE SET
			failures = CASE
				WHEN window_started_at < ? THEN 1
				ELSE failures + 1
			END,
			window_started_at = CASE
				WHEN window_started_at < ? THEN ?
				ELSE window_started_at
			END,
			blocked_until = CASE
				WHEN window_started_at < ? THEN 0
				WHEN failures + 1 >= ? THEN ?
				ELSE blocked_until
			END,
			updated_at = ?
	`).bind(
		key,
		now,
		now,
		cutoff,
		cutoff,
		now,
		cutoff,
		LOGIN_MAX_FAILURES,
		now + LOGIN_BLOCK_MS,
		now,
	).run();
}

function isSecureRequest(url: string): boolean {
	return new URL(url).protocol === "https:";
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
	setCookie(c, SESSION_COOKIE_NAME, token, {
		httpOnly: true,
		secure: isSecureRequest(c.req.url),
		sameSite: "Strict",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
	});
}

function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
	deleteCookie(c, SESSION_COOKIE_NAME, {
		httpOnly: true,
		secure: isSecureRequest(c.req.url),
		sameSite: "Strict",
		path: "/",
	});
}

function requestHasValidOrigin(requestUrl: string, origin: string | undefined): boolean {
	if (!origin) return true;
	try {
		return new URL(origin).origin === new URL(requestUrl).origin;
	} catch {
		return false;
	}
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export const authRoutes = new Hono<AuthContext>();

authRoutes.use("*", async (c, next) => {
	c.header("Cache-Control", "no-store");
	await next();
});

authRoutes.use("*", async (c, next) => {
	if (c.req.method !== "GET" && !requestHasValidOrigin(c.req.url, c.req.header("Origin"))) {
		return c.json({ error: "Invalid request origin" }, 403);
	}
	await next();
});

authRoutes.post("/register", async (c) => {
	if (!acceptsJson(c.req.header("Content-Type"))) {
		return c.json({ error: "Content-Type must be application/json" }, 415);
	}
	const parsed = RegisterSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ error: "Invalid registration data", issues: parsed.error.flatten() }, 400);
	}

	const configuredKey = c.env.REGISTRATION_KEY;
	if (!configuredKey) {
		return c.json({ error: "Registration is not configured" }, 503);
	}
	if (!(await secretsEqual(parsed.data.registrationKey, configuredKey))) {
		return c.json({ error: "Invalid registration key" }, 403);
	}

	try {
		const user = await createUser(c.env.AUTH_DB, {
			username: parsed.data.username,
			password: parsed.data.password,
			mailboxPrefix: parsed.data.mailboxPrefix,
		});
		const session = await createSession(c.env.AUTH_DB, user.id);
		setSessionCookie(c, session.token);
		return c.json({ user }, 201);
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			return c.json({ error: "Username or mailbox prefix already exists" }, 409);
		}
		if (error instanceof PasswordCryptoError) {
			console.error("Registration password hashing failed:", error.causeName);
			return c.json({ error: "Authentication service unavailable" }, 503);
		}
		throw error;
	}
});

authRoutes.post("/login", async (c) => {
	if (!acceptsJson(c.req.header("Content-Type"))) {
		return c.json({ error: "Content-Type must be application/json" }, 415);
	}
	const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid username or password" }, 401);
	const attemptKey = await loginAttemptKey(c, parsed.data.username);
	const now = Date.now();
	if (await isLoginBlocked(c.env.AUTH_DB, attemptKey, now)) {
		return c.json({ error: "Too many login attempts; try again later" }, 429);
	}

	const row = await c.env.AUTH_DB
		.prepare(
			`SELECT id, username, password_hash, password_salt, password_iterations,
				mailbox_prefix, role, created_at
			FROM users
			WHERE username = ? COLLATE NOCASE`,
		)
		.bind(parsed.data.username)
		.first<{
			id: string;
			username: string;
			password_hash: string;
			password_salt: string;
			password_iterations: number;
			mailbox_prefix: string;
			role: "admin" | "user";
			created_at: string;
		}>();

	// Perform the same PBKDF2 work for an unknown username to reduce account
	// enumeration through response timing.
	let valid: boolean;
	try {
		valid = await verifyPassword(parsed.data.password, row ?? {
			password_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			password_salt: "AAAAAAAAAAAAAAAAAAAAAA",
			password_iterations: PASSWORD_HASH_ITERATIONS,
		});
	} catch (error) {
		if (error instanceof PasswordCryptoError) {
			console.error("Login password verification failed:", error.causeName);
			return c.json({ error: "Authentication service unavailable" }, 503);
		}
		throw error;
	}
	if (!row || !valid) {
		await recordLoginFailure(c.env.AUTH_DB, attemptKey, now);
		return c.json({ error: "Invalid username or password" }, 401);
	}

	await c.env.AUTH_DB.batch([
		c.env.AUTH_DB.prepare("DELETE FROM auth_login_attempts WHERE key = ?").bind(attemptKey),
		c.env.AUTH_DB.prepare("DELETE FROM auth_login_attempts WHERE updated_at < ?")
			.bind(now - 7 * 24 * 60 * 60 * 1_000),
	]);
	await deleteExpiredSessions(c.env.AUTH_DB);
	const session = await createSession(c.env.AUTH_DB, row.id);
	setSessionCookie(c, session.token);
	return c.json({
		user: {
			id: row.id,
			username: row.username,
			mailboxPrefix: row.mailbox_prefix,
			role: row.role,
			createdAt: row.created_at,
		},
	});
});

authRoutes.post("/logout", async (c) => {
	const token = getCookie(c, SESSION_COOKIE_NAME);
	if (token) await deleteSession(c.env.AUTH_DB, token);
	clearSessionCookie(c);
	return c.json({ ok: true });
});

authRoutes.get("/session", async (c) => {
	const user = await authenticateSession(
		c.env.AUTH_DB,
		getCookie(c, SESSION_COOKIE_NAME),
	);
	if (!user) return c.json({ error: "Unauthorized" }, 401);
	return c.json({ user });
});

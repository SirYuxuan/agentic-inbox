// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { z } from "zod";

export const SESSION_COOKIE_NAME = "agentic_inbox_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
// Keep password verification within the Workers Free request CPU budget. The
// public login endpoint is additionally rate limited in D1.
export const PASSWORD_HASH_ITERATIONS = 50_000;

const SESSION_TOKEN_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const textEncoder = new TextEncoder();

export const UsernameSchema = z
	.string()
	.trim()
	.min(3)
	.max(64)
	.regex(/^[a-zA-Z0-9_-]+$/, "Use only letters, numbers, underscores, and hyphens")
	.transform((value) => value.toLowerCase());

export const PasswordSchema = z.string().min(8).max(256);

export const MailboxPrefixSchema = z
	.string()
	.trim()
	.min(1)
	// A regular mailbox is always `<prefix>.<custom>@oofo.cc`; leave one
	// character plus the dot within the RFC 64-character local-part limit.
	.max(62)
	.regex(
		/^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/,
		"Use lowercase letters, numbers, or hyphens; a hyphen cannot be first or last",
	);

export type AuthRole = "admin" | "user";

export type AuthUser = {
	id: string;
	username: string;
	mailboxPrefix: string;
	role: AuthRole;
	createdAt: string;
};

export type AuthBindings = {
	AUTH_DB: D1Database;
	REGISTRATION_KEY?: string;
};

export type AuthContext = {
	Bindings: AuthBindings;
	Variables: {
		authUser: AuthUser;
	};
};

type UserRow = {
	id: string;
	username: string;
	password_hash: string;
	password_salt: string;
	password_iterations: number;
	mailbox_prefix: string;
	role: AuthRole;
	created_at: string;
};

type SessionUserRow = UserRow & {
	expires_at: number;
};

type PasswordRecord = {
	hash: string;
	salt: string;
	iterations: number;
};

export class PasswordCryptoError extends Error {
	readonly operation: "hash" | "verify";
	readonly causeName: string;

	constructor(operation: "hash" | "verify", cause: unknown) {
		super("Password cryptography operation failed");
		this.name = "PasswordCryptoError";
		this.operation = operation;
		this.causeName = cause instanceof Error ? cause.name : "UnknownError";
	}
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
}

async function derivePasswordHash(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: copyToArrayBuffer(salt),
			iterations,
		},
		key,
		256,
	);
	return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
	try {
		const salt = randomBytes(PASSWORD_SALT_BYTES);
		const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);
		return {
			hash: bytesToBase64Url(hash),
			salt: bytesToBase64Url(salt),
			iterations: PASSWORD_HASH_ITERATIONS,
		};
	} catch (error) {
		throw new PasswordCryptoError("hash", error);
	}
}

export async function verifyPassword(
	password: string,
	record: Pick<UserRow, "password_hash" | "password_salt" | "password_iterations">,
): Promise<boolean> {
	try {
		const salt = base64UrlToBytes(record.password_salt);
		const expected = base64UrlToBytes(record.password_hash);
		const actual = await derivePasswordHash(password, salt, record.password_iterations);
		return constantTimeEqual(actual, expected);
	} catch (error) {
		throw new PasswordCryptoError("verify", error);
	}
}

export async function secretsEqual(left: string, right: string): Promise<boolean> {
	const [leftHash, rightHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
		crypto.subtle.digest("SHA-256", textEncoder.encode(right)),
	]);
	return constantTimeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

function toAuthUser(row: UserRow): AuthUser {
	return {
		id: row.id,
		username: row.username,
		mailboxPrefix: row.mailbox_prefix,
		role: row.role,
		createdAt: row.created_at,
	};
}

export async function createUser(
	db: D1Database,
	input: {
		username: string;
		password: string;
		mailboxPrefix: string;
		role?: AuthRole;
	},
): Promise<AuthUser> {
	const username = UsernameSchema.parse(input.username);
	const password = PasswordSchema.parse(input.password);
	const mailboxPrefix = MailboxPrefixSchema.parse(input.mailboxPrefix);
	const role = input.role ?? "user";
	const passwordRecord = await hashPassword(password);
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await db.batch([
		db.prepare(
			`INSERT INTO users (
					id, username, password_hash, password_salt, password_iterations,
					mailbox_prefix, role, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			id,
			username,
			passwordRecord.hash,
			passwordRecord.salt,
			passwordRecord.iterations,
			mailboxPrefix,
			role,
			now,
			now,
		),
		db.prepare(
			`INSERT INTO mailbox_namespaces (prefix, user_id, created_at)
			VALUES (?, ?, ?)`,
		).bind(mailboxPrefix, id, now),
	]);

	return { id, username, mailboxPrefix, role, createdAt: now };
}
export async function hashSessionToken(token: string): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", textEncoder.encode(token));
	return bytesToBase64Url(new Uint8Array(hash));
}

export async function createSession(
	db: D1Database,
	userId: string,
): Promise<{ token: string; expiresAt: number }> {
	const token = bytesToBase64Url(randomBytes(SESSION_TOKEN_BYTES));
	const tokenHash = await hashSessionToken(token);
	const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1_000;
	await db
		.prepare(
			`INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
			VALUES (?, ?, ?, ?)`,
		)
		.bind(tokenHash, userId, expiresAt, new Date().toISOString())
		.run();
	return { token, expiresAt };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
	const tokenHash = await hashSessionToken(token);
	await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function deleteExpiredSessions(db: D1Database): Promise<void> {
	await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(Date.now()).run();
}

export async function authenticateSession(
	db: D1Database,
	token: string | undefined,
): Promise<AuthUser | null> {
	if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const tokenHash = await hashSessionToken(token);
	const row = await db
		.prepare(
			`SELECT u.id, u.username, u.password_hash, u.password_salt,
				u.password_iterations, u.mailbox_prefix, u.role, u.created_at,
				s.expires_at
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = ?`,
		)
		.bind(tokenHash)
		.first<SessionUserRow>();

	if (!row) return null;
	if (row.expires_at <= Date.now()) {
		await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
		return null;
	}
	return toAuthUser(row);
}

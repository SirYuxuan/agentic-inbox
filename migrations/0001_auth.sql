-- Copyright (c) 2026 Cloudflare, Inc.
-- Licensed under the Apache 2.0 license found in the LICENSE file or at:
--     https://opensource.org/licenses/Apache-2.0

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL COLLATE NOCASE UNIQUE,
	password_hash TEXT NOT NULL,
	password_salt TEXT NOT NULL,
	password_iterations INTEGER NOT NULL,
	mailbox_prefix TEXT NOT NULL COLLATE NOCASE UNIQUE,
	role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
	ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
	ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS system_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- The first dot-separated local-part segment is a permanent namespace. This
-- prevents an administrator-created address such as `team.alerts@...` from
-- later overlapping a different account registered with prefix `team`.
CREATE TABLE IF NOT EXISTS mailbox_namespaces (
	prefix TEXT PRIMARY KEY COLLATE NOCASE,
	user_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mailbox_namespaces_user_id
	ON mailbox_namespaces(user_id);

-- A row is deliberately retained after deletion so that an old address cannot
-- accidentally expose residual Durable Object or R2 data to a future owner.
CREATE TABLE IF NOT EXISTS mailbox_claims (
	mailbox_id TEXT PRIMARY KEY COLLATE NOCASE,
	user_id TEXT NOT NULL,
	custom_part TEXT,
	status TEXT NOT NULL DEFAULT 'provisioning'
		CHECK (status IN ('provisioning', 'active', 'deleted')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	deleted_at TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mailbox_claims_user_status
	ON mailbox_claims(user_id, status);

-- Initial administrator requested for this deployment. Only the PBKDF2 salt
-- and derived hash are stored here; the plaintext password is never committed.
INSERT OR IGNORE INTO users (
	id,
	username,
	password_hash,
	password_salt,
	password_iterations,
	mailbox_prefix,
	role,
	created_at,
	updated_at
) VALUES (
	'019fefb2-8cbf-7d63-a3be-6eec305ca3dd',
	'yuxuan',
	'3bzWdOjn9w79XCiKepr3X_acmlZS5Jvwrn_4w-NDCO4',
	'WR4dcDpSyBMb1IKd5xazRQ',
	600000,
	'yuxuan',
	'admin',
	'2026-08-11T00:00:00.000Z',
	'2026-08-11T00:00:00.000Z'
);

INSERT OR IGNORE INTO mailbox_namespaces (prefix, user_id, created_at)
VALUES (
	'yuxuan',
	'019fefb2-8cbf-7d63-a3be-6eec305ca3dd',
	'2026-08-11T00:00:00.000Z'
);

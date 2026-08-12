-- Copyright (c) 2026 Cloudflare, Inc.
-- Licensed under the Apache 2.0 license found in the LICENSE file or at:
--     https://opensource.org/licenses/Apache-2.0

CREATE TABLE IF NOT EXISTS auth_login_attempts (
	key TEXT PRIMARY KEY,
	failures INTEGER NOT NULL DEFAULT 0,
	window_started_at INTEGER NOT NULL,
	blocked_until INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_updated_at
	ON auth_login_attempts(updated_at);

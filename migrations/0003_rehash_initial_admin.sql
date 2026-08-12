-- Copyright (c) 2026 Cloudflare, Inc.
-- Licensed under the Apache 2.0 license found in the LICENSE file or at:
--     https://opensource.org/licenses/Apache-2.0

-- The initial verifier used 600,000 PBKDF2 iterations, which exceeds the CPU
-- budget of a Workers Free request in production. Rotate the deployment's
-- initial administrator verifier to the Worker-compatible cost. The plaintext
-- password is not stored in this migration.
UPDATE users
SET password_hash = '5gkOmd6RzffWPuIIKjWLS2GrPX56xliLpVXcLSs_Y8Y',
	password_salt = 'aqXDemckjTj82MY2rfjf6g',
	password_iterations = 50000,
	updated_at = '2026-08-11T00:00:00.000Z'
WHERE id = '019fefb2-8cbf-7d63-a3be-6eec305ca3dd'
	AND username = 'yuxuan';

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

function clearStorage(storage: Storage) {
	for (let index = storage.length - 1; index >= 0; index -= 1) {
		const key = storage.key(index);
		if (key?.startsWith("agentic-inbox:")) storage.removeItem(key);
	}
}

export function clearUserScopedStorage() {
	if (typeof window === "undefined") return;
	clearStorage(window.localStorage);
	clearStorage(window.sessionStorage);
}

export function getSafeNextPath(value: string | null) {
	if (!value) return "/";
	try {
		const base = new URL("https://agentic-inbox.invalid/");
		const target = new URL(value, base);
		if (target.origin !== base.origin) return "/";
		const normalizedPath = target.pathname.length > 1
			? target.pathname.replace(/\/+$/, "")
			: target.pathname;
		if (normalizedPath === "/login" || normalizedPath === "/register") return "/";
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return "/";
	}
}

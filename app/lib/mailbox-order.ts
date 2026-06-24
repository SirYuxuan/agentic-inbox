// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Mailbox } from "~/types";

export const MAILBOX_ORDER_STORAGE_KEY = "agentic-inbox:mailbox-order";

export type MailboxListItem = Pick<Mailbox, "id" | "email" | "name" | "settings">;

export function getMailboxOrderKey(mailbox: Pick<MailboxListItem, "email">) {
	return mailbox.email.toLowerCase();
}

export function readMailboxOrder(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(MAILBOX_ORDER_STORAGE_KEY) || "[]",
		);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

export function writeMailboxOrder(order: string[]) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(MAILBOX_ORDER_STORAGE_KEY, JSON.stringify(order));
}

export function sortMailboxesByOrder<T extends MailboxListItem>(
	mailboxes: T[],
	order: string[],
): T[] {
	if (order.length === 0) return mailboxes;
	const indexByEmail = new Map(order.map((email, index) => [email, index]));
	return [...mailboxes].sort((a, b) => {
		const aIndex = indexByEmail.get(getMailboxOrderKey(a));
		const bIndex = indexByEmail.get(getMailboxOrderKey(b));
		if (aIndex == null && bIndex == null) return 0;
		if (aIndex == null) return 1;
		if (bIndex == null) return -1;
		return aIndex - bIndex;
	});
}

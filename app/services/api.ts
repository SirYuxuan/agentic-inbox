// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	AuthSession,
	Contact,
	CreateMailboxInput,
	Email,
	EmailTranslation,
	Folder,
	Mailbox,
} from "~/types";
import { clearUserScopedStorage } from "~/lib/auth-client";

const REQUEST_TIMEOUT_MS = 30_000;
const TRANSLATION_TIMEOUT_MS = 120_000;

interface RequestBehavior {
	redirectOnUnauthorized?: boolean;
}

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
	timeoutMs = REQUEST_TIMEOUT_MS,
	behavior: RequestBehavior = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new DOMException("请求超时，请稍后重试", "TimeoutError")),
		timeoutMs,
	);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			if (
				res.status === 401 &&
				behavior.redirectOnUnauthorized !== false &&
				typeof window !== "undefined"
			) {
				const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
				const next = currentPath.startsWith("/login") || currentPath.startsWith("/register")
					? "/"
					: currentPath;
				clearUserScopedStorage();
				window.location.replace(`/login?next=${encodeURIComponent(next)}`);
			}
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal; redirectOnUnauthorized?: boolean }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(
		`${url}${query}`,
		{
			method: "GET",
			signal: opts?.signal,
			...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
		},
		REQUEST_TIMEOUT_MS,
		{ redirectOnUnauthorized: opts?.redirectOnUnauthorized },
	);
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number; redirectOnUnauthorized?: boolean }) {
	return request<T>(
		url,
		{
			method: "POST",
			signal: opts?.signal,
			body: body != null ? JSON.stringify(body) : undefined,
		},
		opts?.timeoutMs,
		{ redirectOnUnauthorized: opts?.redirectOnUnauthorized },
	);
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Authentication
	getSession: () =>
		get<AuthSession>("/api/v1/auth/session", { redirectOnUnauthorized: false }),
	login: (username: string, password: string) =>
		post<AuthSession>(
			"/api/v1/auth/login",
			{ username, password },
			{ redirectOnUnauthorized: false },
		),
	register: (data: {
		username: string;
		password: string;
		mailboxPrefix: string;
		registrationKey: string;
	}) =>
		post<AuthSession>("/api/v1/auth/register", data, {
			redirectOnUnauthorized: false,
		}),
	logout: () =>
		post<{ ok: true }>("/api/v1/auth/logout", undefined, {
			redirectOnUnauthorized: false,
		}),

	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),
	getTrustedImageSenders: () =>
		get<{ senders: string[] }>("/api/v1/trusted-image-senders"),
	updateTrustedImageSenders: (senders: string[]) =>
		put<{ senders: string[] }>("/api/v1/trusted-image-senders", { senders }),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	getMailboxUnreadCounts: () =>
		get<Record<string, number>>("/api/v1/mailboxes/unread-counts"),
	getMailboxOrder: () =>
		get<{ order: string[] }>("/api/v1/mailboxes/order"),
	updateMailboxOrder: (order: string[]) =>
		put<{ order: string[] }>("/api/v1/mailboxes/order", { order }),
	createMailbox: (input: CreateMailboxInput) =>
		post<Mailbox>("/api/v1/mailboxes", input),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	translateEmail: (mailboxId: string, id: string) =>
		post<EmailTranslation>(
			`/api/v1/mailboxes/${mailboxId}/emails/${id}/translate`,
			undefined,
			{ timeoutMs: TRANSLATION_TIMEOUT_MS },
		),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),

	// Contacts (account address book)
	listContacts: () => get<Contact[]>("/api/v1/contacts"),
	createContact: (name: string, email: string) =>
		post<Contact>("/api/v1/contacts", { name, email }),
	updateContact: (id: string, name: string, email: string) =>
		put<Contact>(`/api/v1/contacts/${id}`, { name, email }),
	deleteContact: (id: string) => del<void>(`/api/v1/contacts/${id}`),
};

export default api;

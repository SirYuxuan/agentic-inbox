// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Contact } from "~/types";
import { queryKeys } from "./keys";

export function useContacts() {
	return useQuery<Contact[]>({
		queryKey: queryKeys.contacts,
		queryFn: () => api.listContacts(),
		staleTime: 60_000,
	});
}

export function useCreateContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ name, email }: { name: string; email: string }) =>
			api.createContact(name, email),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.contacts });
		},
	});
}

export function useUpdateContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, name, email }: { id: string; name: string; email: string }) =>
			api.updateContact(id, name, email),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.contacts });
		},
	});
}

export function useDeleteContact() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.deleteContact(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.contacts });
		},
	});
}

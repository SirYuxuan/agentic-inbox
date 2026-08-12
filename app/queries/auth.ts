// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { resetUIStore } from "~/hooks/useUIStore";
import { clearUserScopedStorage } from "~/lib/auth-client";
import api from "~/services/api";
import type { AuthSession } from "~/types";
import { queryKeys } from "./keys";

export interface RegisterInput {
	username: string;
	password: string;
	mailboxPrefix: string;
	registrationKey: string;
}

export function useAuthSession(verifyOnMount = false) {
	return useQuery<AuthSession>({
		queryKey: queryKeys.auth.session,
		queryFn: () => api.getSession(),
		retry: false,
		staleTime: 30_000,
		refetchOnMount: verifyOnMount ? "always" : false,
		refetchOnWindowFocus: false,
	});
}

export function useLogin() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ username, password }: { username: string; password: string }) =>
			api.login(username, password),
		onSuccess: (session) => {
			queryClient.setQueryData(queryKeys.auth.session, session);
		},
	});
}

export function useRegister() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: RegisterInput) => api.register(input),
		onSuccess: (session) => {
			queryClient.setQueryData(queryKeys.auth.session, session);
		},
	});
}

export function clearAuthenticatedClientState(queryClient: QueryClient) {
	queryClient.clear();
	resetUIStore();
	clearUserScopedStorage();
}

export function useLogout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => api.logout(),
		onSuccess: async () => {
			await queryClient.cancelQueries();
			clearAuthenticatedClientState(queryClient);
		},
	});
}

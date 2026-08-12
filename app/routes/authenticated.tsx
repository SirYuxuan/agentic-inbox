// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader2, RefreshCw } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Button } from "~/components/ui/button";
import { useAuthSession } from "~/queries/auth";
import { ApiError } from "~/services/api";

export default function AuthenticatedRoute() {
	const location = useLocation();
	const session = useAuthSession(true);

	if (session.isPending || session.isFetching) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-5 w-5 animate-spin" />
					正在验证登录状态
				</div>
			</div>
		);
	}

	if (session.error instanceof ApiError && session.error.status === 401) {
		const next = `${location.pathname}${location.search}${location.hash}`;
		return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
	}

	if (session.error || !session.data?.user) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-6">
				<div className="max-w-sm text-center">
					<h1 className="text-base font-semibold">无法验证登录状态</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						请检查网络连接后重试。
					</p>
					<Button className="mt-5" onClick={() => session.refetch()}>
						<RefreshCw className="h-4 w-4" />
						重新加载
					</Button>
				</div>
			</div>
		);
	}

	return <Outlet />;
}

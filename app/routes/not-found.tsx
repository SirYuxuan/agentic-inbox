// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";

export default function NotFoundRoute() {
	const navigate = useNavigate();

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-6">
			<div className="flex flex-col items-center text-center">
				<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
					<WarningIcon size={28} className="text-muted-foreground" />
				</div>
				<h1 className="mb-1.5 text-lg font-semibold text-foreground">
					404 — 页面未找到
				</h1>
				<p className="mb-5 max-w-xs text-sm text-muted-foreground">
					你要找的页面不存在。
				</p>
				<Button size="sm" onClick={() => navigate("/")}>
					返回首页
				</Button>
			</div>
		</div>
	);
}

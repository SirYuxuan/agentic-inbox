// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useAuthSession, useLogout } from "~/queries/auth";

interface AccountMenuProps {
	showUsername?: boolean;
}

export default function AccountMenu({ showUsername = true }: AccountMenuProps) {
	const toastManager = useKumoToastManager();
	const { data: session } = useAuthSession();
	const logout = useLogout();
	const username = session?.user.username || "账号";

	const handleLogout = async () => {
		try {
			await logout.mutateAsync();
			window.location.replace("/login");
		} catch (error) {
			toastManager.add({
				title: error instanceof Error ? error.message : "退出登录失败",
				variant: "error",
			});
		}
	};

	return (
		<div className="flex items-center gap-1.5">
			{showUsername && (
				<div className="hidden items-center gap-2 rounded-md px-2 py-1 sm:flex">
					<div className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
						{username.charAt(0).toUpperCase()}
					</div>
					<span className="max-w-28 truncate text-sm font-medium text-foreground">
						{username}
					</span>
				</div>
			)}
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={handleLogout}
				disabled={logout.isPending}
				aria-label="退出登录"
				title="退出登录"
				className="text-muted-foreground"
			>
				{logout.isPending ? (
					<Loader2 className="h-4 w-4 animate-spin" />
				) : (
					<LogOut className="h-4 w-4" />
				)}
			</Button>
		</div>
	);
}

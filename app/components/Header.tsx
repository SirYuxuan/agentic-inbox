// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { GearSixIcon, ListIcon, MagnifyingGlassIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip } from "~/components/ui/tooltip";
import { useUIStore } from "~/hooks/useUIStore";

export default function Header() {
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchExpanded, setIsSearchExpanded] = useState(false);
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const { toggleSidebar, toggleAgentPanel, isAgentPanelOpen } = useUIStore();

	const urlQuery = searchParams.get("q") || "";
	useEffect(() => {
		if (location.pathname.includes("/search") && urlQuery) {
			setSearchQuery(urlQuery);
		}
	}, [urlQuery, location.pathname]);

	const performSearch = () => {
		if (mailboxId && searchQuery.trim()) {
			const q = searchQuery.trim();
			navigate(`/mailbox/${mailboxId}/search?q=${encodeURIComponent(q)}`);
			setIsSearchExpanded(false);
		}
	};

	const clearSearch = () => {
		setSearchQuery("");
		if (location.pathname.includes("/search") && mailboxId) {
			navigate(`/mailbox/${mailboxId}/emails/inbox`);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") performSearch();
		if (e.key === "Escape") {
			if (searchQuery) clearSearch();
			else setIsSearchExpanded(false);
		}
	};

	const isSettingsActive = location.pathname.includes("/settings");

	return (
		<header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-2.5 md:gap-4 md:px-5">
			{/* Hamburger menu - mobile only */}
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={toggleSidebar}
				aria-label="切换侧边栏"
				className="shrink-0 md:hidden"
			>
				<ListIcon size={20} />
			</Button>

			{/* Search */}
			<div
				className={`flex max-w-lg flex-1 items-center gap-1 transition-all ${
					isSearchExpanded ? "flex" : "hidden md:flex"
				}`}
			>
				<div className="relative flex flex-1 items-center">
					<MagnifyingGlassIcon
						size={16}
						className="pointer-events-none absolute left-2.5 text-muted-foreground"
					/>
					<Input
						className="w-full pl-8 pr-8"
						aria-label="搜索邮件"
						placeholder="搜索邮件……（可用 from:name、is:unread、has:attachment）"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={clearSearch}
							className="absolute right-2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="清除搜索"
						>
							<XIcon size={14} />
						</button>
					)}
				</div>
			</div>

			{/* Search toggle - mobile only */}
			{!isSearchExpanded && (
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => setIsSearchExpanded(true)}
					aria-label="搜索"
					className="shrink-0 md:hidden"
				>
					<MagnifyingGlassIcon size={20} />
				</Button>
			)}

			<div className="ml-auto flex shrink-0 items-center gap-1">
				<Tooltip content={isAgentPanelOpen ? "隐藏 AI 助手" : "显示 AI 助手"}>
					<Button
						variant={isAgentPanelOpen ? "secondary" : "ghost"}
						size="icon"
						onClick={toggleAgentPanel}
						aria-label="切换 AI 助手面板"
						className="hidden lg:inline-flex"
					>
						<RobotIcon size={19} />
					</Button>
				</Tooltip>
				<Tooltip content="设置">
					<Button
						variant={isSettingsActive ? "secondary" : "ghost"}
						size="icon"
						onClick={() =>
							navigate(
								isSettingsActive
									? `/mailbox/${mailboxId}/emails/inbox`
									: `/mailbox/${mailboxId}/settings`,
							)
						}
						aria-label="设置"
					>
						<GearSixIcon size={19} />
					</Button>
				</Tooltip>
			</div>
		</header>
	);
}

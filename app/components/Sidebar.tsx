// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	AddressBookIcon,
	CaretDownIcon,
	ArchiveIcon,
	CaretLeftIcon,
	FileIcon,
	FolderIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tooltip } from "~/components/ui/tooltip";
import {
	readMailboxOrder,
	sortMailboxesByOrder,
} from "~/lib/mailbox-order";
import { cn } from "~/lib/utils";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox, useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";
import { useUIStore } from "~/hooks/useUIStore";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
	[Folders.INBOX]: <TrayIcon size={17} weight="regular" />,
	[Folders.SENT]: <PaperPlaneTiltIcon size={17} weight="regular" />,
	[Folders.DRAFT]: <FileIcon size={17} weight="regular" />,
	[Folders.ARCHIVE]: <ArchiveIcon size={17} weight="regular" />,
	[Folders.TRASH]: <TrashIcon size={17} weight="regular" />,
};

const SYSTEM_FOLDER_LINKS = [
	{ id: Folders.INBOX, label: "收件箱" },
	{ id: Folders.SENT, label: "已发送" },
	{ id: Folders.DRAFT, label: "草稿箱" },
	{ id: Folders.ARCHIVE, label: "归档" },
	{ id: Folders.TRASH, label: "废纸篓" },
];

interface FolderLinkProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	unreadCount?: number;
	onClick?: () => void;
}

function FolderLink({ to, icon, label, unreadCount, onClick }: FolderLinkProps) {
	return (
		<NavLink
			to={to}
			onClick={onClick}
			className={({ isActive }) =>
				cn(
					"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
					isActive
						? "bg-accent font-medium text-accent-foreground"
						: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
				)
			}
		>
			<span className="shrink-0">{icon}</span>
			<span className="flex-1 truncate">{label}</span>
			{unreadCount != null && unreadCount > 0 && (
				<Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5">
					{unreadCount}
				</Badge>
			)}
		</NavLink>
	);
}

export default function Sidebar() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const { startCompose, closeSidebar } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const { data: mailboxes = [] } = useMailboxes();
	const { data: mailboxOrderData } = useQuery({
		queryKey: ["mailboxes", "order"],
		queryFn: () => api.getMailboxOrder(),
	});
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [isMailboxSwitcherOpen, setIsMailboxSwitcherOpen] = useState(false);
	const [mailboxOrder, setMailboxOrder] = useState<string[]>([]);
	const switcherRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!mailboxOrderData) return;
		setMailboxOrder(
			mailboxOrderData.order.length > 0
				? mailboxOrderData.order
				: readMailboxOrder(),
		);
	}, [mailboxOrderData]);

	useEffect(() => {
		if (!isMailboxSwitcherOpen) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (!switcherRef.current?.contains(event.target as Node)) {
				setIsMailboxSwitcherOpen(false);
			}
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [isMailboxSwitcherOpen]);

	const customFolders = useMemo(
		() =>
			folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);

	const getUnreadCount = (folderId: string) => {
		const found = folders.find((f) => f.id === folderId);
		return found?.unreadCount || 0;
	};

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const displayName = useMemo(() => {
		if (!currentMailbox) return mailboxId?.split("@")[0] || "邮箱";
		if (currentMailbox.settings?.fromName) return currentMailbox.settings.fromName;
		if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) {
			return currentMailbox.name;
		}
		return currentMailbox.email.split("@")[0] || currentMailbox.name;
	}, [currentMailbox, mailboxId]);

	const orderedMailboxes = useMemo(
		() => sortMailboxesByOrder(mailboxes, mailboxOrder),
		[mailboxes, mailboxOrder],
	);

	const getMailboxDisplayName = (mailbox: typeof mailboxes[number]) => {
		if (mailbox.settings?.fromName) return mailbox.settings.fromName;
		if (mailbox.name && mailbox.name !== mailbox.email) return mailbox.name;
		return mailbox.email.split("@")[0] || mailbox.email;
	};

	const switchMailbox = (nextMailboxId: string) => {
		const currentPrefix = mailboxId ? `/mailbox/${mailboxId}` : "";
		const currentSuffix = currentPrefix && location.pathname.startsWith(currentPrefix)
			? location.pathname.slice(currentPrefix.length) || "/emails/inbox"
			: "/emails/inbox";
		navigate(`/mailbox/${nextMailboxId}${currentSuffix}${location.search}`);
		setIsMailboxSwitcherOpen(false);
		closeSidebar();
	};

	const handleNavClick = () => closeSidebar();

	return (
		<aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background">
			{/* Back + identity */}
			<div className="px-3 pt-4 pb-2">
				<button
					type="button"
					onClick={() => {
						navigate("/");
						closeSidebar();
					}}
					className="mb-3 flex cursor-pointer items-center gap-1 border-0 bg-transparent p-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<CaretLeftIcon size={14} />
					<span>邮箱列表</span>
				</button>
				<div ref={switcherRef} className="relative">
					<button
						type="button"
						onClick={() => setIsMailboxSwitcherOpen((open) => !open)}
						className="flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-1 py-1 text-left transition-colors hover:bg-accent/60"
						aria-label="切换邮箱"
						aria-expanded={isMailboxSwitcherOpen}
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
							{displayName.charAt(0).toUpperCase()}
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold text-foreground">
								{displayName}
							</div>
							<div className="truncate text-xs text-muted-foreground">
								{currentMailbox?.email || mailboxId}
							</div>
						</div>
						<CaretDownIcon
							size={14}
							className={cn(
								"shrink-0 text-muted-foreground transition-transform",
								isMailboxSwitcherOpen && "rotate-180",
							)}
						/>
					</button>

					{isMailboxSwitcherOpen && (
						<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
							{orderedMailboxes.map((mailbox) => {
								const name = getMailboxDisplayName(mailbox);
								const isCurrent = mailbox.id === mailboxId;
								return (
									<button
										key={mailbox.id}
										type="button"
										onClick={() => switchMailbox(mailbox.id)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
											isCurrent
												? "bg-accent text-accent-foreground"
												: "text-popover-foreground hover:bg-accent/60",
										)}
									>
										<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
											{name.charAt(0).toUpperCase()}
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate font-medium">{name}</div>
											<div className="truncate text-xs text-muted-foreground">
												{mailbox.email}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					)}
					</div>
			</div>

			{/* Compose */}
			<div className="px-3 py-2">
				<Button className="w-full" onClick={() => startCompose()}>
					<PencilSimpleIcon size={16} />
					写邮件
				</Button>
			</div>

			{/* Navigation */}
			<nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
				{SYSTEM_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={FOLDER_ICONS[folder.id]}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}

				<div className="my-2 border-t border-border" />
				<FolderLink
					to={`/mailbox/${mailboxId}/contacts`}
					icon={<AddressBookIcon size={17} weight="regular" />}
					label="通讯录"
					onClick={handleNavClick}
				/>

				<div className="pt-4">
					<div className="mb-1 flex items-center justify-between px-2.5">
						<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							文件夹
						</span>
						<Tooltip content="新建文件夹">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setIsCreateFolderOpen(true)}
								aria-label="新建文件夹"
								className="h-6 w-6 text-muted-foreground"
							>
								<PlusIcon size={15} />
							</Button>
						</Tooltip>
					</div>
					{customFolders.map((folder) => (
						<FolderLink
							key={folder.id}
							to={`/mailbox/${mailboxId}/emails/${folder.id}`}
							icon={<FolderIcon size={17} />}
							label={folder.name}
							unreadCount={folder.unreadCount}
							onClick={handleNavClick}
						/>
					))}
				</div>
			</nav>

			{/* Create folder dialog */}
			<Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>新建文件夹</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<div className="space-y-1.5">
							<Label>文件夹名称</Label>
							<Input
								placeholder="例如：项目"
								value={newFolderName}
								onChange={(e) => setNewFolderName(e.target.value)}
								required
							/>
						</div>
						<DialogFooter>
							<DialogClose asChild>
								<Button type="button" variant="outline" size="sm">
									取消
								</Button>
							</DialogClose>
							<Button type="submit" size="sm" disabled={!newFolderName.trim()}>
								创建
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</aside>
	);
}

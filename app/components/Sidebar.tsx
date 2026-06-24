// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	AddressBookIcon,
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
import { useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
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
import { cn } from "~/lib/utils";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
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
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const { startCompose, closeSidebar } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");

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
				<div className="flex items-center gap-2.5 px-1">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
						{displayName.charAt(0).toUpperCase()}
					</div>
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-foreground">
							{displayName}
						</div>
						<div className="truncate text-xs text-muted-foreground">
							{currentMailbox?.email || mailboxId}
						</div>
					</div>
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

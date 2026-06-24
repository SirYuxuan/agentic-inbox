// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Pagination } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import MailboxSplitView from "~/components/MailboxSplitView";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";
import { cn, getSnippetText } from "~/lib/utils";
import {
	useDeleteEmail,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={40} weight="thin" className="text-muted-foreground" />,
		title: "收件箱是空的",
		description: "新邮件到达后会显示在这里。发一封邮件，开始你的对话吧。",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: (
			<PaperPlaneTiltIcon size={40} weight="thin" className="text-muted-foreground" />
		),
		title: "没有已发送的邮件",
		description: "你发送的邮件会显示在这里。",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={40} weight="thin" className="text-muted-foreground" />,
		title: "没有草稿",
		description: "你正在撰写的邮件会保存在这里。",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={40} weight="thin" className="text-muted-foreground" />,
		title: "归档是空的",
		description: "把邮件移到这里，既能保持收件箱整洁，又不会删除它们。",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={40} weight="thin" className="text-muted-foreground" />,
		title: "废纸篓是空的",
		description: "已删除的邮件会显示在这里。你可以恢复或彻底删除它们。",
	},
};

function EmailListSkeleton() {
	return (
		<div className="animate-pulse space-y-1 p-2">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="flex items-center gap-3 px-3 py-3">
					<div className="h-2 w-2 rounded-full bg-muted" />
					<div className="h-4 w-4 rounded bg-muted" />
					<div className="flex-1 space-y-2">
						<div className="flex items-center gap-2">
							<div className="h-3 w-24 rounded bg-muted" />
							<div className="h-3 flex-1 rounded bg-muted" />
							<div className="h-3 w-12 rounded bg-muted" />
						</div>
						<div className="h-2.5 w-3/4 rounded bg-muted" />
					</div>
				</div>
			))}
		</div>
	);
}

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: (
			<EnvelopeSimpleIcon size={40} weight="thin" className="text-muted-foreground" />
		),
		title: "没有邮件",
		description: "此文件夹是空的。",
	};

	return (
		<div className="flex flex-col items-center justify-center px-6 py-24 text-center">
			<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
				{config.icon}
			</div>
			<h3 className="mb-1.5 text-base font-semibold text-foreground">
				{config.title}
			</h3>
			<p className="mb-5 max-w-xs text-sm text-muted-foreground">
				{config.description}
			</p>
			{"showCompose" in config && config.showCompose && (
				<Button size="sm" onClick={onCompose}>
					<PencilSimpleIcon size={16} />
					写邮件
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
	} = useUIStore();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();

	const params = useMemo(
		() => ({
			folder: folder || "",
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[folder, page],
	);

	const { data: emailData, isFetching: isRefreshing } = useEmails(mailboxId, params, {
		refetchInterval: 30_000,
	});

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const { data: folders = [] } = useFolders(mailboxId);

	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "收件箱";
	}, [folders, folder]);

	const isPanelOpen = selectedEmailId !== null || isComposing;

	const prevFolderRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const folderChanged = prevFolderRef.current !== `${mailboxId}/${folder}`;
		prevFolderRef.current = `${mailboxId}/${folder}`;
		if (folderChanged) {
			closePanel();
			setPage(1);
		}
	}, [mailboxId, folder, closePanel]);

	const toggleStar = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId)
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { starred: !email.starred },
			});
	};

	const handleDelete = (e: React.MouseEvent, emailId: string) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId) {
			const confirmed = window.confirm("确定要删除这封邮件吗？");
			if (!confirmed) return;
			deleteEmail.mutate({ mailboxId, id: emailId });
			if (selectedEmailId === emailId) closePanel();
		}
	};

	const handleRefresh = () => {
		if (mailboxId) {
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			queryClient.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		}
	};

	const hasUnread = (email: Email): boolean => {
		if (email.thread_unread_count !== undefined) {
			return email.thread_unread_count > 0;
		}
		return !email.read;
	};

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (mailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
			} else {
				updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
			}
		}
	};

	const formatParticipants = (email: Email): string => {
		if (email.participants) {
			const names = email.participants
				.split(",")
				.map((p) => p.trim().split("@")[0])
				.filter((name, idx, arr) => arr.indexOf(name) === idx);
			if (names.length <= 3) return names.join(", ");
			return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
		}
		return email.sender.split("@")[0];
	};

	return (
		<MailboxSplitView selectedEmailId={selectedEmailId} isComposing={isComposing}>
			{/* Folder header */}
			<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
				<div className="flex items-baseline gap-2">
					<h1 className="text-base font-semibold text-foreground">{folderName}</h1>
					{totalCount > 0 && (
						<span className="text-xs text-muted-foreground">{totalCount}</span>
					)}
				</div>
				<Tooltip content={isRefreshing ? "刷新中……" : "刷新"}>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={handleRefresh}
						disabled={isRefreshing}
						aria-label="刷新"
						className="text-muted-foreground"
					>
						<ArrowsClockwiseIcon size={17} className={isRefreshing ? "animate-spin" : ""} />
					</Button>
				</Tooltip>
			</div>

			{/* Email rows */}
			<div className="flex-1 overflow-y-auto">
				{isRefreshing && emails.length === 0 ? (
					<EmailListSkeleton />
				) : emails.length > 0 ? (
					<div>
						{emails.map((email) => {
							const isSelected = selectedEmailId === email.id;
							const snippet = getSnippetText(email.snippet);
							const unread = hasUnread(email);
							return (
								<div
									key={email.id}
									role="button"
									tabIndex={0}
									onClick={() => handleRowClick(email)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											handleRowClick(email);
										}
									}}
									className={cn(
										"group relative flex w-full cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-left transition-colors md:px-5",
										isSelected ? "bg-accent" : "hover:bg-accent/60",
									)}
								>
									{/* Unread accent bar */}
									{unread && (
										<span className="absolute inset-y-0 left-0 w-0.5 bg-foreground" />
									)}

									{/* Star */}
									<button
										type="button"
										className="shrink-0 cursor-pointer border-0 bg-transparent p-0.5"
										onClick={(e) => {
											e.stopPropagation();
											toggleStar(e, email);
										}}
										aria-label={email.starred ? "取消星标" : "星标"}
									>
										<StarIcon
											size={15}
											weight={email.starred ? "fill" : "regular"}
											className={
												email.starred
													? "text-amber-500"
													: "text-muted-foreground/50 hover:text-amber-500"
											}
										/>
									</button>

									{/* Content */}
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span
												className={cn(
													"truncate text-sm",
													unread ? "font-semibold text-foreground" : "text-foreground/80",
												)}
											>
												{formatParticipants(email)}
											</span>
											{(email.thread_count ?? 1) > 1 && (
												<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
													{email.thread_count}
												</span>
											)}
											{email.has_draft && (
												<span className="shrink-0 text-xs font-medium text-destructive">
													草稿
												</span>
											)}
											{email.needs_reply && !email.has_draft && (
												<Tooltip content="待回复">
													<span className="shrink-0 text-amber-500">
														<ArrowBendUpLeftIcon size={14} weight="bold" />
													</span>
												</Tooltip>
											)}
											<span className="ml-auto shrink-0 text-xs text-muted-foreground">
												{formatListDate(email.date)}
											</span>
										</div>
										<div className="mt-0.5 truncate text-sm">
											<span
												className={
													unread ? "font-medium text-foreground" : "text-muted-foreground"
												}
											>
												{email.subject}
											</span>
											{snippet && (
												<span className="font-normal text-muted-foreground">
													{" "}
													&mdash; {snippet}
												</span>
											)}
										</div>
									</div>

									{/* Hover actions */}
									<div className="hidden shrink-0 items-center group-hover:flex">
										<Tooltip content={email.read ? "标为未读" : "标为已读"}>
											<Button
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 text-muted-foreground"
												onClick={(e) => {
													e.stopPropagation();
													if (mailboxId)
														updateEmail.mutate({
															mailboxId,
															id: email.id,
															data: { read: !email.read },
														});
												}}
												aria-label={email.read ? "标为未读" : "标为已读"}
											>
												{email.read ? (
													<EnvelopeSimpleIcon size={14} />
												) : (
													<EnvelopeOpenIcon size={14} />
												)}
											</Button>
										</Tooltip>
										<Tooltip content="删除">
											<Button
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 text-muted-foreground hover:text-destructive"
												onClick={(e) => handleDelete(e, email.id)}
												aria-label="删除"
											>
												<TrashIcon size={14} />
											</Button>
										</Tooltip>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<FolderEmptyState folder={folder} onCompose={() => startCompose()} />
				)}
			</div>

			{/* Pagination */}
			{totalCount > PAGE_SIZE && (
				<div className="flex shrink-0 justify-center border-t border-border py-3">
					<Pagination
						page={page}
						setPage={setPage}
						perPage={PAGE_SIZE}
						totalCount={totalCount}
					/>
				</div>
			)}
		</MailboxSplitView>
	);
}

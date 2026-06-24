// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef, useState } from "react";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	ChatCircleIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onToggleStar: () => void;
	onToggleRead: () => void;
	onMove: (folderId: string) => void;
	onViewSource: () => void;
	onDelete: () => void;
}

export default function EmailPanelToolbar({
	email,
	isDraftFolder,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onReply,
	onReplyAll,
	onForward,
	onToggleStar,
	onToggleRead,
	onMove,
	onViewSource,
	onDelete,
}: EmailPanelToolbarProps) {
	return (
		<div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 md:px-4">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onBack}
				aria-label="返回列表"
				className="shrink-0 text-muted-foreground md:hidden"
			>
				<ArrowLeftIcon size={18} />
			</Button>

			{isDraftFolder ? (
				<>
					<Button size="sm" onClick={onSendDraft} disabled={isSending}>
						<PaperPlaneTiltIcon size={16} />
						{isSending ? "发送中……" : "发送"}
					</Button>
					<Button variant="outline" size="sm" onClick={onEditDraft}>
						<PencilSimpleIcon size={16} />
						编辑
					</Button>
				</>
			) : (
				<>
					<Tooltip content="回复">
						<Button variant="ghost" size="icon-sm" onClick={onReply} aria-label="回复" className="text-muted-foreground">
							<ArrowBendUpLeftIcon size={18} />
						</Button>
					</Tooltip>
					<Tooltip content="回复全部">
						<Button variant="ghost" size="icon-sm" onClick={onReplyAll} aria-label="回复全部" className="text-muted-foreground">
							<ChatCircleIcon size={18} />
						</Button>
					</Tooltip>
					<Tooltip content="转发">
						<Button variant="ghost" size="icon-sm" onClick={onForward} aria-label="转发" className="text-muted-foreground">
							<ArrowBendUpRightIcon size={18} />
						</Button>
					</Tooltip>
				</>
			)}

			<div className="mx-0.5 h-5 w-px bg-border" />

			<Tooltip content={email.starred ? "取消星标" : "星标"}>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onToggleStar}
					aria-label={email.starred ? "取消星标" : "星标"}
					className="text-muted-foreground"
				>
					<StarIcon
						size={18}
						weight={email.starred ? "fill" : "regular"}
						className={email.starred ? "text-amber-500" : ""}
					/>
				</Button>
			</Tooltip>

			<Tooltip content={email.read ? "标为未读" : "标为已读"}>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onToggleRead}
					aria-label={email.read ? "标为未读" : "标为已读"}
					className="text-muted-foreground"
				>
					{email.read ? <EnvelopeSimpleIcon size={18} /> : <EnvelopeOpenIcon size={18} />}
				</Button>
			</Tooltip>

			<MoveToFolderMenu folders={moveToFolders} onMove={onMove} />

			<div className="ml-auto flex items-center gap-0.5">
				<Tooltip content="查看源码">
					<Button variant="ghost" size="icon-sm" onClick={onViewSource} aria-label="查看源码" className="text-muted-foreground">
						<CodeIcon size={18} />
					</Button>
				</Tooltip>
				<Tooltip content="删除">
					<Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="删除" className="text-muted-foreground hover:text-destructive">
						<TrashIcon size={18} />
					</Button>
				</Tooltip>
				<Tooltip content="关闭">
					<Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="关闭" className="hidden text-muted-foreground md:inline-flex">
						<XIcon size={18} />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
}

function MoveToFolderMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<Tooltip content="移动到文件夹">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => setOpen((o) => !o)}
					aria-label="移动到文件夹"
					className="text-muted-foreground"
				>
					<FolderSimpleIcon size={18} />
				</Button>
			</Tooltip>
			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-lg border border-border bg-popover py-1 shadow-md">
					<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">移动到</div>
					<div className="my-1 h-px bg-border" />
					{folders.map((f) => (
						<button
							key={f.id}
							type="button"
							className="w-full px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
							onClick={() => {
								onMove(f.id);
								setOpen(false);
							}}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	CaretDownIcon,
	CaretUpIcon,
	CodeIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import RemoteImageNotice from "~/components/email-panel/RemoteImageNotice";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import {
	formatDetailDate,
	formatShortDate,
	hasRemoteImages,
	rewriteInlineImages,
	stripHtml,
} from "~/lib/utils";
import type { Email, EmailTranslation } from "~/types";

interface ThreadMessageProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isLast: boolean;
	isDraft?: boolean;
	isSending?: boolean;
	isExpanded: boolean;
	translation?: EmailTranslation;
	allowRemoteImages?: boolean;
	onToggleExpand: () => void;
	onShowRemoteImages: () => void;
	onTrustSender: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onDeleteDraft?: () => void;
	onViewSource?: () => void;
	onPreviewImage?: (url: string, filename: string) => void;
}

function Avatar({ isDraft, isSelf, sender }: { isDraft?: boolean; isSelf: boolean; sender: string }) {
	return (
		<div
			className={cn(
				"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
				isDraft
					? "bg-muted text-muted-foreground"
					: isSelf
						? "bg-foreground text-background"
						: "bg-muted text-foreground",
			)}
		>
			{isDraft ? "D" : sender.charAt(0).toUpperCase()}
		</div>
	);
}

export default function ThreadMessage({
	email,
	mailboxId,
	mailboxEmail,
	isLast,
	isDraft,
	isSending,
	isExpanded,
	translation,
	allowRemoteImages,
	onToggleExpand,
	onShowRemoteImages,
	onTrustSender,
	onSendDraft,
	onEditDraft,
	onDeleteDraft,
	onViewSource,
	onPreviewImage,
}: ThreadMessageProps) {
	const isSelf = email.sender === mailboxEmail;
	const containerClassName = cn(
		!isLast && "border-b border-border",
		isDraft && "border-l-2 border-l-amber-500 bg-amber-500/[0.03]",
	);
	const senderLabel = isDraft ? "草稿回复" : isSelf ? "我" : email.sender;
	const showRemoteImageNotice = hasRemoteImages(email.body) && !allowRemoteImages;
	const body = translation?.bodyHtml || email.body || "";

	if (!isExpanded) {
		return (
			<div className={containerClassName}>
				<button
					type="button"
					onClick={onToggleExpand}
					className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-accent/50"
				>
					<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
					<div className="min-w-0 flex-1">
						<div className="flex items-center justify-between">
							<span className="truncate text-sm font-medium text-foreground">
								{senderLabel}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">
								{formatDetailDate(email.date)}
							</span>
						</div>
						<p className="truncate text-xs text-muted-foreground">
							{stripHtml(email.body || "").slice(0, 80)}
						</p>
					</div>
					<CaretDownIcon size={14} className="shrink-0 text-muted-foreground" />
				</button>
			</div>
		);
	}

	return (
		<div className={cn("group/thread-msg", containerClassName)}>
			<div className="px-4 py-4 md:px-6">
				<div className="mb-3 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2.5">
						<button
							type="button"
							onClick={onToggleExpand}
							className="shrink-0"
							aria-label="收起邮件"
						>
							<div className="rounded-full transition-shadow hover:ring-2 hover:ring-ring/30">
								<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
							</div>
						</button>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="truncate text-sm font-medium text-foreground">
									{senderLabel}
								</span>
								{isDraft && <Badge variant="outline">草稿</Badge>}
							</div>
							<div className="text-xs text-muted-foreground">收件人：{email.recipient}</div>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-1">
						<span className="text-xs text-muted-foreground">
							{formatShortDate(email.date)}
						</span>
						{onViewSource && (
							<Tooltip content="查看源码">
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={onViewSource}
									aria-label="查看源码"
									className="h-6 w-6 text-muted-foreground"
								>
									<CodeIcon size={14} />
								</Button>
							</Tooltip>
						)}
						<button
							type="button"
							onClick={onToggleExpand}
							className="ml-1"
							aria-label="收起邮件"
						>
							<CaretUpIcon size={14} className="text-muted-foreground transition-colors hover:text-foreground" />
						</button>
					</div>
				</div>

				{showRemoteImageNotice && (
					<RemoteImageNotice
						sender={email.sender}
						onShowOnce={onShowRemoteImages}
						onTrustSender={onTrustSender}
						className="mb-3 md:ml-[42px]"
					/>
				)}

				<div className="md:ml-[42px]">
					<EmailIframe
						allowRemoteImages={allowRemoteImages}
						body={rewriteInlineImages(body, mailboxId || "", email.id, email.attachments)}
						autoSize
					/>
				</div>

				{isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && (
					<div className="mt-3 flex gap-2 md:ml-[42px]">
						{onSendDraft && (
							<Button size="sm" onClick={onSendDraft} disabled={isSending}>
								<PaperPlaneTiltIcon size={14} />
								{isSending ? "发送中……" : "发送"}
							</Button>
						)}
						{onEditDraft && (
							<Button variant="outline" size="sm" onClick={onEditDraft} disabled={isSending}>
								<PencilSimpleIcon size={14} />
								编辑
							</Button>
						)}
						{onDeleteDraft && (
							<Button variant="ghost" size="sm" onClick={onDeleteDraft} disabled={isSending}>
								<TrashIcon size={14} />
								丢弃
							</Button>
						)}
					</div>
				)}

				<EmailAttachmentList
					mailboxId={mailboxId}
					emailId={email.id}
					attachments={email.attachments}
					onPreviewImage={onPreviewImage}
					className="mt-3 md:ml-[42px]"
				/>
			</div>
		</div>
	);
}

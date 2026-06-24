// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PaperclipIcon, FileIcon, ImageIcon } from "@phosphor-icons/react";
import { formatBytes, getAttachmentUrl, getNonInlineAttachments } from "~/lib/utils";
import type { Attachment } from "~/types";

interface EmailAttachmentListProps {
	mailboxId?: string;
	emailId: string;
	attachments?: Attachment[];
	onPreviewImage?: (url: string, filename: string) => void;
	className?: string;
	showHeading?: boolean;
}

export default function EmailAttachmentList({
	mailboxId,
	emailId,
	attachments,
	onPreviewImage,
	className,
	showHeading = false,
}: EmailAttachmentListProps) {
	if (!mailboxId) return null;

	const files = getNonInlineAttachments(attachments);
	if (files.length === 0) return null;

	return (
		<div className={className}>
			{showHeading && (
				<div className="mb-2 flex items-center gap-2">
					<PaperclipIcon size={14} className="text-muted-foreground" />
					<span className="text-sm font-medium text-foreground">
						{files.length} 个附件
					</span>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{files.map((attachment) => {
					const url = getAttachmentUrl(mailboxId, emailId, attachment.id);
					const isImage = attachment.mimetype?.startsWith("image/");

					if (isImage && onPreviewImage) {
						return (
							<button
								key={attachment.id}
								type="button"
								onClick={() => onPreviewImage(url, attachment.filename)}
								className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
							>
								<ImageIcon size={16} className="shrink-0 text-muted-foreground" />
								<span className="max-w-[140px] truncate font-medium text-foreground">
									{attachment.filename}
								</span>
								<span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
							</button>
						);
					}

					return (
						<a
							key={attachment.id}
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm no-underline transition-colors hover:bg-accent"
						>
							<FileIcon size={16} className="shrink-0 text-muted-foreground" />
							<span className="max-w-[140px] truncate font-medium text-foreground">
								{attachment.filename}
							</span>
							<span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
						</a>
					);
				})}
			</div>
		</div>
	);
}

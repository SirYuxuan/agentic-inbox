// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, rewriteInlineImages } from "~/lib/utils";
import type { Email } from "~/types";

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	onPreviewImage: (url: string, filename: string) => void;
}

export default function SingleMessageView({
	email,
	mailboxId,
	onPreviewImage,
}: SingleMessageViewProps) {
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-border px-4 py-4 md:px-6">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2.5">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
							{email.sender.charAt(0).toUpperCase()}
						</div>
						<div className="min-w-0">
							<div className="truncate text-sm font-medium text-foreground">
								{email.sender}
							</div>
							<div className="text-xs text-muted-foreground">收件人：{email.recipient}</div>
						</div>
					</div>
					<span className="shrink-0 text-xs text-muted-foreground">
						{formatDetailDate(email.date)}
					</span>
				</div>
			</div>

			<div className="min-h-0 flex-1">
				<EmailIframe
					body={rewriteInlineImages(
						email.body || "",
						mailboxId || "",
						email.id,
						email.attachments,
					)}
				/>
			</div>

			<EmailAttachmentList
				mailboxId={mailboxId}
				emailId={email.id}
				attachments={email.attachments}
				onPreviewImage={onPreviewImage}
				className="shrink-0 border-t border-border px-4 py-3 md:px-6"
				showHeading
			/>
		</div>
	);
}

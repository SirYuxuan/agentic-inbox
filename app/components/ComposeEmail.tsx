// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useComposeForm } from "~/hooks/useComposeForm";
import RecipientInput from "./RecipientInput";
import RichTextEditor from "./RichTextEditor";
import { useUIStore } from "~/hooks/useUIStore";

export default function ComposeEmail() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const { isComposeModalOpen, closeComposeModal } = useUIStore();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
	} = useComposeForm(mailboxId, folder);

	return (
		<Dialog
			open={isComposeModalOpen}
			onOpenChange={(open) => !open && !isSending && closeComposeModal()}
		>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{formTitle}</DialogTitle>
				</DialogHeader>
				<form onSubmit={(e) => handleSend(e, closeComposeModal)} className="space-y-4">
					{error && (
						<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}
					<div className="flex items-start gap-2">
						<div className="flex-1">
							<RecipientInput
								label="收件人"
								placeholder="recipient@example.com, another@example.com"
								value={to}
								onChange={setTo}
								required
							/>
						</div>
						{!showCcBcc && (
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="mt-7 shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
							>
								抄送 / 密送
							</button>
						)}
					</div>
					{showCcBcc && (
						<RecipientInput
							label="抄送"
							value={cc}
							onChange={setCc}
							placeholder="多个地址用逗号分隔"
						/>
					)}
					{showCcBcc && (
						<RecipientInput
							label="密送"
							value={bcc}
							onChange={setBcc}
							placeholder="多个地址用逗号分隔"
						/>
					)}
					<div className="space-y-1.5">
						<Label>主题</Label>
						<Input
							type="text"
							placeholder="邮件主题"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							required
						/>
					</div>
					<div className="space-y-1.5">
						<Label>正文</Label>
						<RichTextEditor value={body} onChange={setBody} />
					</div>
					<div className="flex items-center justify-between pt-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeComposeModal}
							disabled={isSending}
						>
							丢弃
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isSending || isSavingDraft}
								onClick={handleSaveDraft}
							>
								<FloppyDiskIcon size={14} />
								{isSavingDraft ? "保存中……" : "存草稿"}
							</Button>
							<Button
								type="submit"
								size="sm"
								disabled={isSavingDraft || isSending}
							>
								<PaperPlaneTiltIcon size={14} />
								{isSending ? "发送中……" : "发送"}
							</Button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

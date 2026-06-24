// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useComposeForm } from "~/hooks/useComposeForm";
import RecipientInput from "./RecipientInput";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

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
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId, folder);

	return (
		<div className="flex h-full flex-col bg-card">
			<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-6">
				<h2 className="text-sm font-semibold text-foreground">{formTitle}</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={closeCompose}
					disabled={isSending}
					aria-label="关闭撰写"
					className="text-muted-foreground"
				>
					<XIcon size={18} />
				</Button>
			</div>

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex min-h-0 flex-1 flex-col overflow-y-auto"
			>
				<div className="space-y-4 p-4 md:p-6">
					{error && (
						<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{error}
						</div>
					)}

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<label className="w-12 shrink-0 text-sm font-medium text-muted-foreground">
								收件人
							</label>
							<div className="flex min-w-0 flex-1 items-center gap-2">
								<div className="min-w-0 flex-1">
									<RecipientInput
										placeholder="recipient@example.com"
										value={to}
										onChange={setTo}
										required
									/>
								</div>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
									>
										抄送 / 密送
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="w-12 shrink-0 text-sm font-medium text-muted-foreground">
									抄送
								</label>
								<div className="flex-1">
									<RecipientInput
										value={cc}
										onChange={setCc}
										placeholder="多个地址用逗号分隔"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="w-12 shrink-0 text-sm font-medium text-muted-foreground">
									密送
								</label>
								<div className="flex-1">
									<RecipientInput
										value={bcc}
										onChange={setBcc}
										placeholder="多个地址用逗号分隔"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="w-12 shrink-0 text-sm font-medium text-muted-foreground">
								主题
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="邮件主题"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					<div className="overflow-hidden rounded-md border border-border bg-card">
						<RichTextEditor value={body} onChange={setBody} />
					</div>
				</div>

				{/* Footer actions */}
				<div className="mt-auto shrink-0 border-t border-border bg-muted/30 px-4 py-3 md:px-6">
					<div className="flex items-center justify-between">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeCompose}
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
				</div>
			</form>
		</div>
	);
}

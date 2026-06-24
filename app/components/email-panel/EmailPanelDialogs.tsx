// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { downloadFile } from "~/lib/utils";
import type { Email } from "~/types";

interface PreviewImage {
	url: string;
	filename: string;
}

interface EmailPanelDialogsProps {
	sourceViewEmail: Email | null;
	previewImage: PreviewImage | null;
	onCloseSource: () => void;
	onClosePreview: () => void;
}

function getSourceHeaders(msg: Email): { key: string; value: string }[] {
	if (msg.raw_headers) {
		try {
			const parsed = JSON.parse(msg.raw_headers);
			if (Array.isArray(parsed)) {
				return parsed.map((header) => ({
					key: header.key || header.name || "",
					value: String(header.value || ""),
				}));
			}
			if (typeof parsed === "object" && parsed !== null) {
				return Object.entries(parsed).map(([key, value]) => ({
					key,
					value: String(value),
				}));
			}
		} catch {
			// Fall through to field-based headers.
		}
	}

	const headers: { key: string; value: string }[] = [];
	if (msg.sender) headers.push({ key: "From", value: msg.sender });
	if (msg.recipient) headers.push({ key: "To", value: msg.recipient });
	if (msg.cc) headers.push({ key: "Cc", value: msg.cc });
	if (msg.bcc) headers.push({ key: "Bcc", value: msg.bcc });
	if (msg.subject) headers.push({ key: "Subject", value: msg.subject });
	if (msg.date) headers.push({ key: "Date", value: msg.date });
	if (msg.message_id) headers.push({ key: "Message-ID", value: msg.message_id });
	if (msg.in_reply_to) headers.push({ key: "In-Reply-To", value: msg.in_reply_to });
	if (msg.email_references) {
		headers.push({ key: "References", value: msg.email_references });
	}
	if (msg.thread_id) headers.push({ key: "X-Thread-ID", value: msg.thread_id });
	return headers;
}

export default function EmailPanelDialogs({
	sourceViewEmail,
	previewImage,
	onCloseSource,
	onClosePreview,
}: EmailPanelDialogsProps) {
	const sourceHeaders = sourceViewEmail ? getSourceHeaders(sourceViewEmail) : [];

	return (
		<>
			<Dialog
				open={sourceViewEmail !== null}
				onOpenChange={(open) => {
					if (!open) onCloseSource();
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							邮件源码头部
							{sourceViewEmail && (
								<span className="ml-2 text-sm font-normal text-muted-foreground">
									{sourceViewEmail.subject}
								</span>
							)}
						</DialogTitle>
					</DialogHeader>
					{sourceViewEmail && (
						<div className="max-h-[60vh] overflow-y-auto">
							<table className="w-full border-collapse text-sm">
								<tbody>
									{sourceHeaders.map((header, idx) => (
										<tr
											key={`${header.key}-${idx}`}
											className={idx % 2 === 0 ? "bg-muted/40" : ""}
										>
											<td className="w-40 whitespace-nowrap px-3 py-1.5 align-top font-mono font-semibold text-foreground">
												{header.key}
											</td>
											<td className="break-all px-3 py-1.5 font-mono text-muted-foreground">
												{header.value}
											</td>
										</tr>
									))}
								</tbody>
							</table>
							{sourceHeaders.length === 0 && (
								<p className="py-8 text-center text-sm text-muted-foreground">
									该邮件没有可用的头部数据。
								</p>
							)}
						</div>
					)}
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline" size="sm">
								关闭
							</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) onClosePreview();
				}}
			>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>{previewImage?.filename}</DialogTitle>
					</DialogHeader>
					{previewImage && (
						<div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg bg-muted/40 p-4">
							<img
								src={previewImage.url}
								alt={previewImage.filename}
								className="max-h-[70vh] max-w-full rounded object-contain shadow-sm"
							/>
						</div>
					)}
					<DialogFooter className="justify-between">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								if (previewImage) downloadFile(previewImage.url, previewImage.filename);
							}}
						>
							下载原文件
						</Button>
						<DialogClose asChild>
							<Button size="sm">关闭</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

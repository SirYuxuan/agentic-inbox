// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import EmailPanelDialogs from "~/components/email-panel/EmailPanelDialogs";
import EmailPanelHeader from "~/components/email-panel/EmailPanelHeader";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import SingleMessageView from "~/components/email-panel/SingleMessageView";
import ThreadMessage from "~/components/email-panel/ThreadMessage";
import { normalizeEmailAddress, splitEmailList, toEmailListValue } from "~/lib/utils";
import api from "~/services/api";
import { useDeleteEmail, useEmail, useMoveEmail, useReplyToEmail, useSendEmail, useThreadReplies, useTranslateEmail, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email, EmailTranslation, Folder, Mailbox } from "~/types";

function EmailPanelSkeleton() {
	return (
		<div className="animate-pulse p-5 space-y-4">
			<div className="h-5 w-2/3 rounded bg-muted" />
			<div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-muted" /><div className="space-y-2 flex-1"><div className="h-3 w-40 rounded bg-muted" /><div className="h-2.5 w-24 rounded bg-muted" /></div></div>
			<div className="space-y-2 pt-4"><div className="h-2.5 w-full rounded bg-muted" /><div className="h-2.5 w-5/6 rounded bg-muted" /><div className="h-2.5 w-4/6 rounded bg-muted" /><div className="h-2.5 w-3/4 rounded bg-muted" /></div>
		</div>
	);
}

export default function EmailPanel({ emailId }: { emailId: string }) {
	const { mailboxId, folder } = useParams<{ mailboxId: string; folder: string }>();
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: threadRepliesRaw } = useThreadReplies(mailboxId, email?.thread_id) as {
		data?: Email[];
	};
	const updateEmail = useUpdateEmail();
	const deleteEmailMut = useDeleteEmail();
	const moveEmailMut = useMoveEmail();
	const translateEmailMut = useTranslateEmail();
	const sendEmailMut = useSendEmail();
	const replyMut = useReplyToEmail();
	const updateMailboxMutation = useUpdateMailbox();
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };
	const { data: currentMailbox } = useMailbox(mailboxId) as {
		data?: Mailbox;
	};
	const { closePanel, startCompose } = useUIStore();
	const toastManager = useKumoToastManager();
	const [isSending, setIsSending] = useState(false);
	const [sourceViewEmail, setSourceViewEmail] = useState<Email | null>(null);
	const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
	const [translations, setTranslations] = useState<Record<string, EmailTranslation>>({});
	const [trustedSenderOverrides, setTrustedSenderOverrides] = useState<string[]>([]);
	const [remoteImagesVisibleOnce, setRemoteImagesVisibleOnce] = useState<Set<string>>(new Set());
	const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
	const isDraftFolder = folder === Folders.DRAFT;

	const threadReplies = useMemo(() => {
		if (!threadRepliesRaw || !email) return [];
		return threadRepliesRaw.filter((e) => e.id !== email.id);
	}, [threadRepliesRaw, email]);

	const allMessages = useMemo(() => {
		if (!email) return [];
		return [email, ...threadReplies].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [email, threadReplies]);

	// Reset expanded state only when the selected email changes, not on every refetch.
	// Using allMessages as a dependency would reset user expand/collapse state on background refetches.
	const currentEmailId = email?.id;
	useEffect(() => { if (allMessages.length > 1) setExpandedMessages(new Set([allMessages[0].id])); }, [currentEmailId]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggleExpand = (msgId: string) => { setExpandedMessages((prev) => { const next = new Set(prev); if (next.has(msgId)) next.delete(msgId); else next.add(msgId); return next; }); };

	const draftMessageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const msg of allMessages) { if (msg.folder_id === Folders.DRAFT) ids.add(msg.id); else if (isDraftFolder && msg.id === emailId) ids.add(msg.id); }
		return ids;
	}, [allMessages, isDraftFolder, emailId]);

	const lastReceivedMessage = useMemo(() => {
		const ce = currentMailbox?.email;
		const received = allMessages.filter((msg) => !draftMessageIds.has(msg.id) && msg.sender !== ce);
		if (received.length > 0) return received[0];
		const nonDrafts = allMessages.filter((msg) => !draftMessageIds.has(msg.id));
		return nonDrafts.length > 0 ? nonDrafts[0] : email;
	}, [allMessages, draftMessageIds, currentMailbox?.email, email]);

	const moveToFolders = useMemo(() => { const cur = folder || email?.folder_id; return folders.filter((f) => f.id !== cur); }, [folders, folder, email?.folder_id]);

	const trustedImageSenders = useMemo(() => {
		const configured = currentMailbox?.settings?.trustedImageSenders ?? [];
		return new Set([...configured, ...trustedSenderOverrides].map(normalizeEmailAddress).filter(Boolean));
	}, [currentMailbox?.settings?.trustedImageSenders, trustedSenderOverrides]);

	if (!email) return <EmailPanelSkeleton />;

	const toggleStar = () => { if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } }); };
	const handleMove = (folderId: string) => { if (mailboxId) { moveEmailMut.mutate({ mailboxId, id: email.id, folderId }); closePanel(); } };
	const handleDelete = () => { if (mailboxId) { if (!window.confirm("确定要删除这封邮件吗？")) return; deleteEmailMut.mutate({ mailboxId, id: email.id }); closePanel(); } };

	const isRemoteImagesAllowed = (msg: Email) => {
		const sender = normalizeEmailAddress(msg.sender);
		return (
			remoteImagesVisibleOnce.has(msg.id) ||
			(sender !== "" && sender === normalizeEmailAddress(currentMailbox?.email)) ||
			trustedImageSenders.has(sender)
		);
	};

	const handleShowRemoteImages = (msgId: string) => {
		setRemoteImagesVisibleOnce((prev) => new Set(prev).add(msgId));
	};

	const handleTrustSender = async (sender: string) => {
		if (!mailboxId || !currentMailbox) return;
		const normalizedSender = normalizeEmailAddress(sender);
		if (!normalizedSender) return;

		const existing = currentMailbox.settings?.trustedImageSenders ?? [];
		const nextTrusted = Array.from(
			new Set([...existing.map(normalizeEmailAddress), normalizedSender].filter(Boolean)),
		);

		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...currentMailbox.settings,
					trustedImageSenders: nextTrusted,
				},
			});
			setTrustedSenderOverrides((prev) =>
				prev.includes(normalizedSender) ? prev : [...prev, normalizedSender],
			);
			toastManager.add({ title: "已信任此发件人" });
		} catch {
			toastManager.add({ title: "保存信任发件人失败", variant: "error" });
		}
	};

	const handleTranslate = async () => {
		if (!mailboxId) return;
		try {
			const translation = await translateEmailMut.mutateAsync({
				mailboxId,
				id: email.id,
			});
			setTranslations((prev) => ({ ...prev, [email.id]: translation }));
			toastManager.add({ title: "翻译完成" });
		} catch (err) {
			const message = (err instanceof Error ? err.message : null) || "翻译失败，请稍后重试。";
			toastManager.add({ title: message, variant: "error" });
		}
	};

	const handleEditDraft = (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (target.in_reply_to) { startCompose({ mode: "reply", originalEmail: allMessages.find((msg) => msg.id === target.in_reply_to), draftEmail: target }); }
		else { startCompose({ mode: "new", originalEmail: undefined, draftEmail: target }); }
	};

	const handleDeleteDraft = async (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (!mailboxId) return;
		if (!window.confirm("丢弃这份草稿吗？")) return;
		deleteEmailMut.mutate({ mailboxId, id: target.id });
		toastManager.add({ title: "草稿已丢弃" });
		if (target.id === emailId) closePanel();
	};

	const handleSendDraft = async (draftMsg?: Email) => {
		let target = draftMsg || email;
		if (!mailboxId || !currentMailbox) return;
		setIsSending(true);
		try {
			if (!target.recipient || !target.subject) { try { const fresh = await api.getEmail(mailboxId, target.id) as Email; if (fresh) target = fresh; } catch {} }
			if (!target.recipient) { toastManager.add({ title: "无法发送：该草稿未设置收件人。", variant: "error" }); return; }
			const toRecipients = splitEmailList(target.recipient);
			if (toRecipients.length === 0) { toastManager.add({ title: "无法发送：该草稿没有有效的收件人。", variant: "error" }); return; }
			const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
			const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
			const originalEmail = target.in_reply_to ? allMessages.find((msg) => msg.id === target.in_reply_to) : undefined;
			const emailData = {
				to: toEmailListValue(toRecipients),
				cc: toEmailListValue(splitEmailList(target.cc)),
				bcc: toEmailListValue(splitEmailList(target.bcc)),
				from,
				subject: target.subject || "（无主题）",
				html: target.body || "",
				text: target.body ? target.body.replace(/<[^>]*>/g, "").trim() : "",
			};
			if (originalEmail) await replyMut.mutateAsync({ mailboxId, emailId: originalEmail.id, email: emailData }); else await sendEmailMut.mutateAsync({ mailboxId, email: emailData });
			await deleteEmailMut.mutateAsync({ mailboxId, id: target.id });
			toastManager.add({ title: "邮件已发送！" });
			if (isDraftFolder) closePanel();
		} catch (err) {
			const message = (err instanceof Error ? err.message : null) || "发送邮件失败。";
			toastManager.add({ title: message, variant: "error" });
		} finally { setIsSending(false); }
	};

	const hasThread = allMessages.length > 1;

	return (
		<div className="flex flex-col h-full">
			<EmailPanelToolbar
				email={email}
				mailboxId={mailboxId}
				isDraftFolder={isDraftFolder}
				isSending={isSending}
				isTranslating={translateEmailMut.isPending}
				hasTranslation={!!translations[email.id]}
				moveToFolders={moveToFolders}
				onBack={closePanel}
				onSendDraft={() => handleSendDraft()}
				onEditDraft={() => handleEditDraft()}
				onReply={() =>
					startCompose({ mode: "reply", originalEmail: lastReceivedMessage })
				}
				onReplyAll={() =>
					startCompose({
						mode: "reply-all",
						originalEmail: lastReceivedMessage,
					})
				}
				onForward={() => startCompose({ mode: "forward", originalEmail: email })}
				onToggleStar={toggleStar}
				onToggleRead={() => {
					if (mailboxId) {
						updateEmail.mutate({
							mailboxId,
							id: email.id,
							data: { read: !email.read },
						});
					}
				}}
				onMove={handleMove}
				onTranslate={handleTranslate}
				onViewSource={() => setSourceViewEmail(email)}
				onDelete={handleDelete}
			/>

			<EmailPanelHeader
				subject={email.subject}
				translatedSubject={translations[email.id]?.subject}
				messageCount={allMessages.length}
				showThreadCount={hasThread}
			/>

			<div className="flex-1 overflow-y-auto">
				{hasThread ? (
					allMessages.map((msg, idx) => {
						const isDraft = draftMessageIds.has(msg.id);
						return (
							<ThreadMessage
								key={msg.id}
								email={msg}
								mailboxId={mailboxId}
								mailboxEmail={currentMailbox?.email}
								isLast={idx === allMessages.length - 1}
								isDraft={isDraft}
								isSending={isDraft ? isSending : false}
								isExpanded={expandedMessages.has(msg.id)}
								allowRemoteImages={isRemoteImagesAllowed(msg)}
								onToggleExpand={() => toggleExpand(msg.id)}
								onShowRemoteImages={() => handleShowRemoteImages(msg.id)}
								onTrustSender={() => handleTrustSender(msg.sender)}
								onSendDraft={isDraft ? () => handleSendDraft(msg) : undefined}
								onEditDraft={isDraft ? () => handleEditDraft(msg) : undefined}
								onDeleteDraft={isDraft ? () => handleDeleteDraft(msg) : undefined}
								onViewSource={() => setSourceViewEmail(msg)}
								translation={translations[msg.id]}
								onPreviewImage={(url, filename) =>
									setPreviewImage({ url, filename })
								}
							/>
						);
					})
				) : (
					<SingleMessageView
						email={email}
						mailboxId={mailboxId}
						translation={translations[email.id]}
						allowRemoteImages={isRemoteImagesAllowed(email)}
						onShowRemoteImages={() => handleShowRemoteImages(email.id)}
						onTrustSender={() => handleTrustSender(email.sender)}
						onPreviewImage={(url, filename) =>
							setPreviewImage({ url, filename })
						}
					/>
				)}
			</div>

			<EmailPanelDialogs
				sourceViewEmail={sourceViewEmail}
				previewImage={previewImage}
				onCloseSource={() => setSourceViewEmail(null)}
				onClosePreview={() => setPreviewImage(null)}
			/>
		</div>
	);
}

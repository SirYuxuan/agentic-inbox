// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { ArrowCounterClockwiseIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { normalizeEmailAddress } from "~/lib/utils";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `你是一个帮助管理此收件箱的邮件助手。你会阅读邮件、起草回复，并帮助整理会话。\n\n像真人一样写作。简短、直接、自然流畅。仅使用纯文本。\n\n（留空则使用内置的完整默认提示词）`;

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [displayName, setDisplayName] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [autoDraft, setAutoDraft] = useState(true);
	const [trustedImageSenders, setTrustedImageSenders] = useState<string[]>([]);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
			setAutoDraft(mailbox.settings?.autoDraftEnabled !== false);
			setTrustedImageSenders(
				(mailbox.settings?.trustedImageSenders ?? [])
					.map(normalizeEmailAddress)
					.filter(Boolean),
			);
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
			autoDraftEnabled: autoDraft,
			trustedImageSenders,
		};
		try {
			await updateMailboxMutation.mutateAsync({ mailboxId, settings });
			toastManager.add({ title: "设置已保存！" });
		} catch {
			toastManager.add({ title: "保存设置失败", variant: "error" });
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => setAgentPrompt("");
	const removeTrustedSender = (sender: string) => {
		setTrustedImageSenders((prev) => prev.filter((item) => item !== sender));
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-2xl px-4 py-5 md:px-8 md:py-6">
				<h1 className="mb-6 text-lg font-semibold text-foreground">设置</h1>

				<div className="space-y-5">
					{/* Account */}
					<div className="rounded-xl border border-border bg-card p-5">
						<div className="mb-4 text-sm font-medium text-foreground">账户</div>
						<div className="space-y-3">
							<div className="space-y-1.5">
								<Label>显示名称</Label>
								<Input
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label>邮箱</Label>
								<Input type="email" value={mailbox.email} disabled />
							</div>
						</div>
					</div>

					{/* Auto-draft */}
					<div className="rounded-xl border border-border bg-card p-5">
						<div className="flex items-center justify-between gap-4">
							<div className="min-w-0">
								<div className="text-sm font-medium text-foreground">
									新邮件自动起草回复
								</div>
								<p className="mt-1 text-xs text-muted-foreground">
									收到新邮件时，让 AI 助手自动起草一封回复草稿（不会自动发送）。关闭后仍可正常收信，并随时手动让助手起草。
								</p>
							</div>
							<Switch
								checked={autoDraft}
								onCheckedChange={setAutoDraft}
								aria-label="新邮件自动起草回复"
							/>
						</div>
					</div>

					{trustedImageSenders.length > 0 && (
						<div className="rounded-xl border border-border bg-card p-5">
							<div className="mb-3 text-sm font-medium text-foreground">
								已信任图片发件人
							</div>
							<div className="space-y-2">
								{trustedImageSenders.map((sender) => (
									<div
										key={sender}
										className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
									>
										<span className="min-w-0 truncate text-sm text-foreground">
											{sender}
										</span>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={() => removeTrustedSender(sender)}
											aria-label={`移除 ${sender}`}
											className="shrink-0 text-muted-foreground"
										>
											<XIcon size={16} />
										</Button>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Agent system prompt */}
					<div className="rounded-xl border border-border bg-card p-5">
						<div className="mb-4 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<RobotIcon size={16} weight="duotone" className="text-muted-foreground" />
								<span className="text-sm font-medium text-foreground">AI 助手提示词</span>
								{isCustomPrompt ? (
									<Badge variant="default">自定义</Badge>
								) : (
									<Badge variant="secondary">默认</Badge>
								)}
							</div>
							{isCustomPrompt && (
								<Button variant="ghost" size="sm" onClick={handleResetPrompt}>
									<ArrowCounterClockwiseIcon size={14} />
									恢复默认
								</Button>
							)}
						</div>
						<p className="mb-3 text-xs text-muted-foreground">
							自定义 AI 助手在此邮箱中的行为方式。留空则使用内置的默认提示词。
						</p>
						<textarea
							value={agentPrompt}
							onChange={(e) => setAgentPrompt(e.target.value)}
							placeholder={PROMPT_PLACEHOLDER}
							rows={12}
							className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
						<p className="mt-2 text-xs text-muted-foreground">
							该提示词会作为系统消息发送给 AI 模型，用于控制助手的人设、写作风格和行为规则。
						</p>
					</div>

					<div className="flex justify-end">
						<Button onClick={handleSave} disabled={isSaving}>
							{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
							保存更改
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

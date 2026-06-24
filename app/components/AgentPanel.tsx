// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader2 } from "lucide-react";
import {
	ArrowUpIcon,
	RobotIcon,
	TrashIcon,
	UserIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	PaperPlaneTiltIcon,
	EyeIcon,
	ArrowBendUpLeftIcon,
	WrenchIcon,
	CheckCircleIcon,
	StopIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";
import { useUIStore } from "~/hooks/useUIStore";
import type { UIMessage } from "ai";

const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
	list_emails: {
		label: "正在获取邮件",
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
	get_email: {
		label: "正在读取邮件",
		icon: <EyeIcon size={14} weight="bold" />,
	},
	get_thread: {
		label: "正在加载会话",
		icon: <ArrowBendUpLeftIcon size={14} weight="bold" />,
	},
	search_emails: {
		label: "正在搜索",
		icon: <MagnifyingGlassIcon size={14} weight="bold" />,
	},
	draft_email: {
		label: "正在起草邮件",
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	draft_reply: {
		label: "正在起草回复",
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	discard_draft: {
		label: "正在丢弃草稿",
		icon: <TrashIcon size={14} weight="bold" />,
	},
	mark_email_read: {
		label: "正在更新状态",
		icon: <CheckCircleIcon size={14} weight="bold" />,
	},
	move_email: {
		label: "正在移动邮件",
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
};

function ToolCallBadge({
	toolName,
	state,
}: {
	toolName: string;
	state: string;
}) {
	const info = TOOL_LABELS[toolName] || {
		label: toolName,
		icon: <WrenchIcon size={14} weight="bold" />,
	};
	const isDone =
		state === "output-available" ||
		state === "result" ||
		state === "output-error";

	return (
		<div className="flex items-center gap-1.5 py-1 px-2 rounded bg-muted/50 text-xs">
			<span className="text-foreground">{info.icon}</span>
			<span className="text-foreground">{info.label}</span>
			{isDone ? (
				<CheckCircleIcon
					size={12}
					weight="fill"
					className="text-emerald-500 ml-auto"
				/>
			) : (
				<Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />
			)}
		</div>
	);
}

function getToolNameFromPart(part: UIMessage["parts"][number]): string | null {
	if (part.type === "dynamic-tool") return (part as any).toolName ?? null;
	if (part.type.startsWith("tool-")) return part.type.replace("tool-", "");
	return null;
}

function hasDraftReplyTool(message: UIMessage): boolean {
	return message.parts.some((part) => {
		const toolName = getToolNameFromPart(part);
		return toolName === "draft_reply";
	});
}

function DraftActions({
	onEdit,
	disabled,
}: {
	onEdit: () => void;
	disabled: boolean;
}) {
	return (
		<div className="flex gap-1.5 mt-1">
			<Button size="sm" onClick={onEdit} disabled={disabled}>
				<PencilSimpleIcon size={14} />
				在撰写框中编辑并发送
			</Button>
		</div>
	);
}

function MessageBubble({
	message,
	onAction,
	isStreaming,
}: {
	message: UIMessage;
	onAction?: (action: string) => void;
	isStreaming: boolean;
}) {
	const isUser = message.role === "user";

	return (
		<div
			className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
		>
			<div
				className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
					isUser
						? "bg-foreground text-background"
						: "bg-muted text-foreground"
				}`}
			>
				{isUser ? (
					<UserIcon size={12} weight="bold" />
				) : (
					<RobotIcon size={12} weight="bold" />
				)}
			</div>
			<div
				className={`flex flex-col gap-1 max-w-[85%] min-w-0 ${
					isUser ? "items-end" : "items-start"
				}`}
			>
				{message.parts.map((part, i) => {
					const key = `${message.id}-part-${i}`;
					if (part.type === "text" && part.text.trim()) {
						return (
							<div
								key={key}
								className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed break-words overflow-wrap-anywhere ${
									isUser
										? "bg-foreground text-background rounded-br-sm"
										: "bg-popover text-foreground border border-border rounded-bl-sm overflow-hidden"
								}`}
							>
								{isUser ? (
									part.text
								) : (
									<Markdown
										remarkPlugins={[remarkGfm]}
										components={{
											a: ({ href, children }) => (
												<a
													href={href}
													target="_blank"
													rel="noopener noreferrer"
													className="underline underline-offset-2"
												>
													{children}
												</a>
											),
											p: ({ children }) => (
												<p className="mb-2 last:mb-0">
													{children}
												</p>
											),
											strong: ({ children }) => (
												<strong className="font-semibold">
													{children}
												</strong>
											),
											ul: ({ children }) => (
												<ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">
													{children}
												</ul>
											),
											ol: ({ children }) => (
												<ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">
													{children}
												</ol>
											),
											li: ({ children }) => (
												<li>{children}</li>
											),
											h1: ({ children }) => (
												<h3 className="font-semibold text-sm mb-1">
													{children}
												</h3>
											),
											h2: ({ children }) => (
												<h4 className="font-semibold text-[13px] mb-1">
													{children}
												</h4>
											),
											h3: ({ children }) => (
												<h5 className="font-semibold text-[13px] mb-0.5">
													{children}
												</h5>
											),
											code: ({ children }) => (
												<code className="bg-muted px-1 py-0.5 rounded text-[12px]">
													{children}
												</code>
											),
											table: ({ children }) => (
												<div className="overflow-x-auto my-2">
													<table className="w-full text-xs border-collapse">
														{children}
													</table>
												</div>
											),
											thead: ({ children }) => (
												<thead className="border-b border-border bg-muted/30">
													{children}
												</thead>
											),
											th: ({ children }) => (
												<th className="text-left px-2 py-1 font-semibold text-foreground">
													{children}
												</th>
											),
											td: ({ children }) => (
												<td className="px-2 py-1 border-b border-border/50">
													{children}
												</td>
											),
										}}
									>
										{part.text}
									</Markdown>
								)}
							</div>
						);
					}
					const toolName = getToolNameFromPart(part);
					if (toolName) {
						return (
							<ToolCallBadge
								key={key}
								toolName={toolName}
								state={(part as any).state ?? "running"}
							/>
						);
					}
					return null;
				})}
				{/* Show action buttons for draft replies */}
				{!isUser && hasDraftReplyTool(message) && onAction && (
					<DraftActions
						onEdit={() => onAction("edit")}
						disabled={isStreaming}
					/>
				)}
			</div>
		</div>
	);
}

function AgentChatConnected({
	mailboxId,
	useAgent,
	useAgentChat,
}: {
	mailboxId: string;
	useAgent: typeof import("agents/react").useAgent;
	useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [inputValue, setInputValue] = useState("");
	const { startCompose } = useUIStore();

	const agent = useAgent({ agent: "EmailAgent", name: mailboxId });
	const { messages, sendMessage, status, clearHistory, stop } =
		useAgentChat({ agent });
	const isStreaming = status === "streaming" || status === "submitted";

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSend = () => {
		const text = inputValue.trim();
		if (!text || isStreaming) return;
		setInputValue("");
		sendMessage({ text });
		if (inputRef.current) inputRef.current.style.height = "auto";
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const suggestedPrompts = [
		"看看收件箱里最新的邮件",
		"有未读邮件吗？",
		"帮我起草一封对最新邮件的回复",
	];

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
				<div className="flex items-center gap-2">
					<Badge variant="secondary">AI</Badge>
					<span className="text-xs text-muted-foreground">
						邮件助手
					</span>
				</div>
				<div className="flex items-center gap-1">
					{isStreaming && (
						<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
					)}
					{messages.length > 0 && (
						<Tooltip content="清空对话">
							<Button
								variant="ghost"
								size="icon-sm"
								className="h-7 w-7 text-muted-foreground"
								onClick={() => {
									if (window.confirm("清空聊天记录吗？")) {
										clearHistory();
									}
								}}
								aria-label="清空对话"
							>
								<TrashIcon size={14} />
							</Button>
						</Tooltip>
					)}
				</div>
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
							<RobotIcon
								size={24}
								weight="duotone"
								className="text-foreground"
							/>
						</div>
						<p className="text-xs text-muted-foreground text-center leading-relaxed px-4">
							我可以阅读邮件、搜索会话，并帮你起草回复。
						</p>
						<div className="flex flex-col gap-1.5 w-full">
							{suggestedPrompts.map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() =>
										sendMessage({ text: prompt })
									}
									className="text-left px-3 py-2 rounded-lg border border-border text-xs text-foreground hover:bg-accent hover:border-border transition-colors cursor-pointer bg-transparent"
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{messages.map((msg) => (
							<MessageBubble
								key={msg.id}
								message={msg}
								isStreaming={isStreaming}
							onAction={(action) => {
								if (action === "edit") {
										// Extract draft data from the draft_reply tool result
										let draftData: {
											to?: string;
											subject?: string;
											body?: string;
											id?: string;
										} | null = null;
										for (const part of msg.parts) {
											if (
												(part as any).toolName === "draft_reply" &&
												(part as any).result
											) {
												draftData = (part as any).result;
												break;
											}
										}
										if (draftData) {
											const draftEmail = {
												id: draftData.id || "",
												subject: draftData.subject || "",
												sender: mailboxId,
												recipient: draftData.to || "",
												date: new Date().toISOString(),
												read: true,
												starred: false,
												body: draftData.body || "",
											};
											startCompose({
												mode: "reply",
												originalEmail: null,
												draftEmail,
											});
										} else {
											sendMessage({
												text: "我想先编辑这份草稿。把现有内容给我看看，方便我修改。",
											});
										}
									}
								}}
							/>
						))}
						{isStreaming && (
							<div className="flex gap-2">
								<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
									<RobotIcon size={12} weight="bold" />
								</div>
								<div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-popover border border-border rounded-bl-sm">
									<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
									<span className="text-xs text-muted-foreground">
										思考中……
									</span>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Input */}
			<div className="shrink-0 border-t border-border px-3 py-2">
				{isStreaming ? (
					<div className="flex justify-center">
						<Button variant="secondary" size="sm" onClick={() => stop()}>
							<StopIcon size={14} weight="fill" />
							停止生成
						</Button>
					</div>
				) : (
					<div className="flex items-end gap-1.5">
						<textarea
							ref={inputRef}
							id="agent-chat-input"
							name="agent-chat-input"
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="向你的邮件助手提问……"
							rows={1}
							aria-label="聊天消息输入框"
							className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-[100px]"
							style={{ height: "auto", overflow: "hidden" }}
							onInput={(e) => {
								const t = e.target as HTMLTextAreaElement;
								t.style.height = "auto";
								t.style.height = `${Math.min(t.scrollHeight, 100)}px`;
								t.style.overflow =
									t.scrollHeight > 100 ? "auto" : "hidden";
							}}
						/>
						<Button
							size="icon"
							disabled={!inputValue.trim()}
							onClick={handleSend}
							aria-label="发送消息"
							className="h-9 w-9 shrink-0"
						>
							<ArrowUpIcon size={16} weight="bold" />
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

export default function AgentPanel() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [hooks, setHooks] = useState<{
		useAgent: typeof import("agents/react").useAgent;
		useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
	} | null>(null);

	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			import("agents/react"),
			import("@cloudflare/ai-chat/react"),
		]).then(([a, c]) =>
			setHooks({
				useAgent: a.useAgent,
				useAgentChat: c.useAgentChat,
			}),
		).catch((err) => {
			console.error("Failed to load agent modules:", err);
			setLoadError("连接助手失败。请刷新页面重试。");
		});
	}, []);

	if (loadError) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
				<span className="text-xs text-destructive">{loadError}</span>
			</div>
		);
	}

	if (!hooks) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				<span className="text-xs text-muted-foreground">
					连接中……
				</span>
			</div>
		);
	}

	return (
		<AgentChatConnected
			mailboxId={mailboxId ?? "default"}
			useAgent={hooks.useAgent}
			useAgentChat={hooks.useAgentChat}
		/>
	);
}

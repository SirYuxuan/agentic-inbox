// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	CheckIcon,
	CopyIcon,
	PlugsIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API unavailable or permission denied — ignore silently
		}
	};

	return (
		<Tooltip content={copied ? "已复制！" : "复制"}>
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={handleCopy}
				aria-label="复制到剪贴板"
				className="h-7 w-7 text-muted-foreground"
			>
				{copied ? (
					<CheckIcon size={12} weight="bold" className="text-emerald-500" />
				) : (
					<CopyIcon size={12} />
				)}
			</Button>
		</Tooltip>
	);
}

const TOOLS = [
	{ name: "list_mailboxes", desc: "列出所有邮箱" },
	{ name: "list_emails", desc: "列出文件夹中的邮件" },
	{ name: "get_email", desc: "读取完整邮件正文" },
	{ name: "get_thread", desc: "加载会话线程" },
	{ name: "search_emails", desc: "按关键词搜索邮件" },
	{ name: "draft_reply", desc: "起草邮件回复" },
	{ name: "send_reply", desc: "发送回复" },
	{ name: "send_email", desc: "发送新邮件" },
	{ name: "mark_email_read", desc: "标记邮件已读/未读" },
	{ name: "move_email", desc: "将邮件移到文件夹" },
];

export default function MCPPanel() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const baseUrl =
		typeof window !== "undefined" ? window.location.origin : "https://your-app.workers.dev";
	const mcpUrl = `${baseUrl}/mcp`;

	return (
		<div className="flex flex-col h-full">
			{/* Content */}
			<div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
				{/* Intro */}
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
							<PlugsIcon
								size={20}
								weight="duotone"
								className="text-foreground"
							/>
						</div>
						<div>
							<h3 className="text-sm font-semibold text-foreground">
								通过 MCP 连接
							</h3>
							<p className="text-xs text-muted-foreground">
								Model Context Protocol
							</p>
						</div>
					</div>
					<p className="text-xs text-muted-foreground leading-relaxed">
						这个邮件助手提供了一个 MCP 服务器，让 AI 编程助手可以直接管理你的收件箱——用自然语言阅读邮件、搜索、起草回复并发送消息。
					</p>
				</div>

				{/* MCP URL */}
				<div className="space-y-1.5">
					<label className="text-xs font-medium text-foreground block">
						服务器地址
					</label>
					<div className="relative group">
						<div className="absolute right-1.5 top-1/2 -translate-y-1/2">
							<CopyButton text={mcpUrl} />
						</div>
						<div className="bg-muted/40 text-foreground font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-border break-all leading-relaxed">
							{mcpUrl}
						</div>
					</div>
				</div>

				{/* Available tools */}
				<div className="space-y-2">
					<h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
						可用工具
					</h4>
					<div className="border border-border rounded-lg divide-y divide-border">
						{TOOLS.map((tool) => (
							<div
								key={tool.name}
								className="flex items-center gap-2.5 px-3 py-2"
							>
								<WrenchIcon
									size={12}
									weight="bold"
									className="text-foreground shrink-0"
								/>
								<div className="min-w-0 flex-1">
									<span className="text-xs font-mono font-medium text-foreground">
										{tool.name}
									</span>
								</div>
								<span className="text-[11px] text-muted-foreground shrink-0">
									{tool.desc}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

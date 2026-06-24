// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
}: EmailPanelHeaderProps) {
	return (
		<div className="shrink-0 border-b border-border px-4 py-3 md:px-6">
			<h2 className="text-base font-semibold text-foreground">{subject}</h2>
			{showThreadCount && (
				<span className="mt-0.5 block text-xs text-muted-foreground">
					此会话共 {messageCount} 封邮件
				</span>
			)}
		</div>
	);
}

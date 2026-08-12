// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { RobotIcon } from "@phosphor-icons/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

function LazyAgentPanel() {
	const [AgentChat, setAgentChat] = useState<React.ComponentType | null>(
		null,
	);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		import("~/components/AgentPanel").then((mod) => {
			setAgentChat(() => mod.default);
		}).catch((err) => {
			console.error("Failed to load AgentPanel:", err);
			setLoadError("加载助手面板失败");
		});
	}, []);

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-full">
				<span className="text-xs text-destructive">{loadError}</span>
			</div>
		);
	}
	if (!AgentChat) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				<span className="text-xs text-muted-foreground">正在加载助手……</span>
			</div>
		);
	}
	return <AgentChat />;
}

export default function AgentSidebar() {
	return (
		<div className="flex flex-col h-full">
			{/* MCP is intentionally not advertised here until it has a dedicated
			    non-browser credential flow. */}
			<div className="flex items-center border-b border-border shrink-0">
				<div className="flex items-center gap-1.5 border-b-2 border-foreground px-4 py-2.5 text-sm font-medium text-foreground">
					<RobotIcon size={14} weight="fill" />
					助手
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-hidden">
				<div className="h-full">
					<LazyAgentPanel />
				</div>
			</div>
		</div>
	);
}

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "~/components/ui/button";

interface RemoteImageNoticeProps {
	sender: string;
	onShowOnce: () => void;
	onTrustSender: () => void;
	className?: string;
}

export default function RemoteImageNotice({
	sender,
	onShowOnce,
	onTrustSender,
	className,
}: RemoteImageNoticeProps) {
	return (
		<div className={className}>
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
				<div className="min-w-0 text-xs text-muted-foreground">
					已阻止来自 {sender} 的远程图片。
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button variant="outline" size="sm" onClick={onShowOnce}>
						显示一次
					</Button>
					<Button size="sm" onClick={onTrustSender}>
						始终信任此发件人
					</Button>
				</div>
			</div>
		</div>
	);
}

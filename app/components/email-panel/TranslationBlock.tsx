// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { EmailTranslation } from "~/types";

interface TranslationBlockProps {
	translation?: EmailTranslation;
	className?: string;
}

export default function TranslationBlock({
	translation,
	className,
}: TranslationBlockProps) {
	if (!translation?.body) return null;

	return (
		<div className={className}>
			<div className="rounded-md border border-border bg-muted/30 px-3 py-2">
				<div className="mb-1 text-xs font-medium text-muted-foreground">翻译</div>
				<div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
					{translation.body}
				</div>
			</div>
		</div>
	);
}

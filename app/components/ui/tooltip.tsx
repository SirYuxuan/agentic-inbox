import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * Simple tooltip wrapper: <Tooltip content="..."><button/></Tooltip>.
 * Bundles its own Provider so callers don't need a root provider.
 */
export function Tooltip({
	content,
	side = "bottom",
	children,
}: {
	content: React.ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	children: React.ReactNode;
}) {
	if (!content) return <>{children}</>;
	return (
		<TooltipPrimitive.Provider delayDuration={200}>
			<TooltipPrimitive.Root>
				<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						side={side}
						sideOffset={6}
						className={cn(
							"z-50 overflow-hidden rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md",
							"data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
						)}
					>
						{content}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}

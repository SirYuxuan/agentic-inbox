// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";

// Force every link rendered inside the email to open in a new tab and drop
// the opener reference, so a bypass of the click interceptor can never
// hijack the parent app via top-level navigation. Registered/removed around
// the email-body sanitize call only, so it never affects the other
// DOMPurify.sanitize call sites (signatures, utils) sharing the singleton.
function forceBlankTargetHook(node: Element) {
	if (node.nodeName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer");
	}
}

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
	/** When false, remote http(s) images are blocked while same-origin attachment images still load. */
	allowRemoteImages?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`
 *   for auto-sizing. Instead, the injected HTML includes a tiny inline
 *   script that posts its body height to the parent via `postMessage`.
 *   The `allow-scripts` flag is required for this, but scripts inside
 *   the opaque-origin sandbox cannot access anything useful.
 * - A strict CSP meta tag blocks external resource loads inside the
 *   iframe as a defense-in-depth layer.
 */
export default function EmailIframe({
	body,
	autoSize,
	allowRemoteImages,
}: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	// URL the user clicked inside the email, awaiting explicit confirmation
	// before we open it in a new tab.
	const [pendingUrl, setPendingUrl] = useState<string | null>(null);

	// Listen for messages posted by the sandboxed iframe (height + link clicks)
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			const data = event.data;
			if (!data || typeof data !== "object") return;

			if (autoSize && data.__emailIframeHeight && typeof data.height === "number" && data.height > 0) {
				setHeight(data.height);
				return;
			}

			if (data.__emailLinkClick && typeof data.href === "string") {
				setPendingUrl(data.href);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !body) return;

		DOMPurify.addHook("afterSanitizeAttributes", forceBlankTargetHook);
		const cleanBody = DOMPurify.sanitize(body, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ["style"],
			ADD_ATTR: ["target"],
			FORCE_BODY: true,
		});
		DOMPurify.removeHook("afterSanitizeAttributes");

		const padding = autoSize ? "0" : "24px";
		const currentOrigin = window.location.origin;
		const imgSrc = allowRemoteImages
			? `data: cid: ${currentOrigin} https: http:`
			: `data: cid: ${currentOrigin}`;

		// Height-reporting script: sends body.scrollHeight to the parent.
		// Runs inside the opaque-origin sandbox so it has zero access to
		// the parent page — it can only postMessage.
		const heightScript = autoSize
			? `<script>
				function reportHeight() {
					var h = document.body.scrollHeight;
					if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
				}
				reportHeight();
				setTimeout(reportHeight, 50);
				setTimeout(reportHeight, 150);
				setTimeout(reportHeight, 400);
			<\/script>`
			: "";

		// Intercept clicks on links: block the default navigation and hand the
		// resolved URL to the parent so it can prompt for confirmation and open
		// the link in a new tab from the trusted (non-sandboxed) context.
		const linkScript = `<script>
			document.addEventListener("click", function (e) {
				var el = e.target;
				while (el && el.tagName !== "A") el = el.parentElement;
				if (!el) return;
				var href = el.href;
				if (!/^https?:|^mailto:/i.test(href)) return;
				e.preventDefault();
				parent.postMessage({ __emailLinkClick: true, href: href }, "*");
			}, true);
		<\/script>`;

		// Use srcdoc so the iframe is truly sandboxed (no same-origin access).
		// We can't use doc.write() because that requires allow-same-origin.
		iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
html {
	background: #ffffff;
	color-scheme: light;
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.6;
	color: #1a1a1a;
	background: #ffffff;
	padding: ${padding};
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote {
	border-left: 3px solid #d1d5db;
	padding-left: 1em;
	margin-left: 0;
	color: #6b7280;
}
pre {
	background: #f3f4f6;
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
</style>
</head>
<body>${cleanBody}${heightScript}${linkScript}</body>
</html>`;
	}, [body, autoSize, allowRemoteImages]);

	return (
		<>
			<iframe
				ref={iframeRef}
				className="block w-full border-0"
				style={autoSize ? { height: `${height}px` } : { height: "100%" }}
				sandbox="allow-scripts allow-popups"
				title="邮件内容"
			/>
			<Dialog open={pendingUrl !== null} onOpenChange={(open) => !open && setPendingUrl(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>确认打开外部链接</DialogTitle>
						<DialogDescription>
							即将在新标签页打开以下链接。请确认地址可信后再继续。
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-32 overflow-y-auto break-all rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
						{pendingUrl}
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setPendingUrl(null)}>
							取消
						</Button>
						<Button
							onClick={() => {
								if (pendingUrl) window.open(pendingUrl, "_blank", "noopener,noreferrer");
								setPendingUrl(null);
							}}
						>
							打开链接
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

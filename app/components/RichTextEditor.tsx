// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	QuotesIcon,
	TextBIcon,
	TextItalicIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Tooltip } from "~/components/ui/tooltip";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
}

function TB({
	label,
	active,
	disabled,
	onClick,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Tooltip content={label}>
			<Button
				type="button"
				variant={active ? "secondary" : "ghost"}
				size="icon-sm"
				disabled={disabled}
				onClick={onClick}
				aria-label={label}
				className="h-7 w-7 text-muted-foreground data-[active=true]:text-foreground"
				data-active={active ? "true" : undefined}
			>
				{children}
			</Button>
		</Tooltip>
	);
}

export default function RichTextEditor({ value, onChange }: RichTextEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:bg-muted [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) editor.commands.focus("start");
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	const setLink = useCallback(() => {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href;
		const url = window.prompt("链接地址", previousUrl);
		if (url === null) return;
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}, [editor]);

	if (!editor) return null;

	return (
		<div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
			{/* Toolbar */}
			<div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5">
				<TB label="加粗" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
					<TextBIcon size={16} />
				</TB>
				<TB label="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
					<TextItalicIcon size={16} />
				</TB>
				<TB label="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
					<TextUnderlineIcon size={16} />
				</TB>
				<TB label="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
					<TextStrikethroughIcon size={16} />
				</TB>

				<div className="mx-1 h-5 w-px bg-border" />

				<TB label="无序列表" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
					<ListBulletsIcon size={16} />
				</TB>
				<TB label="有序列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
					<ListNumbersIcon size={16} />
				</TB>

				<div className="mx-1 h-5 w-px bg-border" />

				<TB label="引用" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
					<QuotesIcon size={16} />
				</TB>
				<TB label="链接" active={editor.isActive("link")} onClick={setLink}>
					<LinkSimpleIcon size={16} />
				</TB>
				{editor.isActive("link") && (
					<TB label="移除链接" onClick={() => editor.chain().focus().unsetLink().run()}>
						<LinkBreakIcon size={16} />
					</TB>
				)}
				<TB label="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
					<MinusIcon size={16} />
				</TB>

				<div className="mx-1 h-5 w-px bg-border" />

				<TB label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
					<ArrowCounterClockwiseIcon size={16} />
				</TB>
				<TB label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
					<ArrowClockwiseIcon size={16} />
				</TB>
			</div>

			{/* Editor content */}
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}

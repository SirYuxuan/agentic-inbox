// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Input } from "@cloudflare/kumo";
import { useMemo, useRef, useState } from "react";
import { useContacts } from "~/queries/contacts";
import type { Contact } from "~/types";

interface RecipientInputProps {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	placeholder?: string;
	size?: "sm" | "base";
	required?: boolean;
	"aria-label"?: string;
}

const MAX_SUGGESTIONS = 6;

/**
 * Recipient input with address-book autocomplete.
 *
 * The field holds a comma-separated list of addresses. Autocomplete matches
 * against the *current* token (the text after the last comma) and, on select,
 * replaces just that token with the chosen contact's email.
 */
export default function RecipientInput({
	value,
	onChange,
	label,
	placeholder,
	size = "sm",
	required,
	"aria-label": ariaLabel,
}: RecipientInputProps) {
	const { data: contacts = [] } = useContacts();
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Current token = text after the last comma.
	const lastComma = value.lastIndexOf(",");
	const token = value.slice(lastComma + 1).trim().toLowerCase();

	const alreadyAdded = useMemo(() => {
		const set = new Set<string>();
		for (const part of value.split(",")) {
			const e = part.trim().toLowerCase();
			if (e) set.add(e);
		}
		return set;
	}, [value]);

	const suggestions = useMemo(() => {
		if (!token) return [] as Contact[];
		return contacts
			.filter(
				(ct) =>
					!alreadyAdded.has(ct.email.toLowerCase()) &&
					(ct.name.toLowerCase().includes(token) ||
						ct.email.toLowerCase().includes(token)),
			)
			.slice(0, MAX_SUGGESTIONS);
	}, [contacts, token, alreadyAdded]);

	const showDropdown = open && suggestions.length > 0;

	const select = (contact: Contact) => {
		const head = value.slice(0, lastComma + 1); // "" or "a@x.com,"
		const next = (head ? `${head} ` : "") + contact.email + ", ";
		onChange(next);
		setOpen(false);
		setActiveIndex(0);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (!showDropdown) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((i) => (i + 1) % suggestions.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
		} else if (e.key === "Enter") {
			// Pick the highlighted contact instead of submitting the form.
			e.preventDefault();
			select(suggestions[activeIndex] ?? suggestions[0]);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div className="relative w-full">
			<Input
				label={label}
				type="text"
				placeholder={placeholder}
				size={size}
				value={value}
				required={required}
				aria-label={ariaLabel}
				onChange={(e) => {
					onChange(e.target.value);
					setOpen(true);
					setActiveIndex(0);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={handleKeyDown}
				onBlur={() => {
					// Delay so a click on a suggestion registers first.
					blurTimer.current = setTimeout(() => setOpen(false), 120);
				}}
			/>
			{showDropdown && (
				<div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1 max-h-60 overflow-y-auto">
					{suggestions.map((contact, idx) => (
						<button
							key={contact.id}
							type="button"
							onMouseDown={(e) => {
								// Prevent input blur from firing before the click.
								e.preventDefault();
								if (blurTimer.current) clearTimeout(blurTimer.current);
								select(contact);
							}}
							onMouseEnter={() => setActiveIndex(idx)}
							className={`w-full text-left px-3 py-1.5 transition-colors ${
								idx === activeIndex ? "bg-kumo-tint" : "hover:bg-kumo-overlay"
							}`}
						>
							<div className="text-sm text-kumo-default truncate">{contact.name}</div>
							<div className="text-xs text-kumo-subtle truncate">{contact.email}</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

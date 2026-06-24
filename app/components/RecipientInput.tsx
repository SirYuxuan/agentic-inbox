// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMemo, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useContacts } from "~/queries/contacts";
import type { Contact } from "~/types";

interface RecipientInputProps {
	value: string;
	onChange: (value: string) => void;
	label?: string;
	placeholder?: string;
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
	required,
	"aria-label": ariaLabel,
}: RecipientInputProps) {
	const { data: contacts = [] } = useContacts();
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
		const head = value.slice(0, lastComma + 1);
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
			e.preventDefault();
			select(suggestions[activeIndex] ?? suggestions[0]);
		} else if (e.key === "Escape") {
			setOpen(false);
		}
	};

	return (
		<div className="relative w-full space-y-1.5">
			{label && <Label>{label}</Label>}
			<Input
				type="text"
				placeholder={placeholder}
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
					blurTimer.current = setTimeout(() => setOpen(false), 120);
				}}
			/>
			{showDropdown && (
				<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-md">
					{suggestions.map((contact, idx) => (
						<button
							key={contact.id}
							type="button"
							onMouseDown={(e) => {
								e.preventDefault();
								if (blurTimer.current) clearTimeout(blurTimer.current);
								select(contact);
							}}
							onMouseEnter={() => setActiveIndex(idx)}
							className={`w-full px-3 py-1.5 text-left transition-colors ${
								idx === activeIndex ? "bg-accent" : "hover:bg-accent/60"
							}`}
						>
							<div className="truncate text-sm text-foreground">{contact.name}</div>
							<div className="truncate text-xs text-muted-foreground">
								{contact.email}
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

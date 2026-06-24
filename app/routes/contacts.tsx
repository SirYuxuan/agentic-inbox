// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import {
	AddressBookIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	useContacts,
	useCreateContact,
	useDeleteContact,
	useUpdateContact,
} from "~/queries/contacts";
import type { Contact } from "~/types";

export function meta() {
	return [{ title: "通讯录 · Agentic Inbox" }];
}

export default function ContactsRoute() {
	const toastManager = useKumoToastManager();
	const { data: contacts = [], isLoading } = useContacts();
	const createContact = useCreateContact();
	const updateContact = useUpdateContact();
	const deleteContact = useDeleteContact();

	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editing, setEditing] = useState<Contact | null>(null);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [toDelete, setToDelete] = useState<Contact | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	const openCreate = () => {
		setEditing(null);
		setName("");
		setEmail("");
		setError(null);
		setIsFormOpen(true);
	};

	const openEdit = (contact: Contact) => {
		setEditing(contact);
		setName(contact.name);
		setEmail(contact.email);
		setError(null);
		setIsFormOpen(true);
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!name.trim() || !email.trim()) {
			setError("请填写姓名和邮箱");
			return;
		}
		setIsSaving(true);
		try {
			if (editing) {
				await updateContact.mutateAsync({ id: editing.id, name: name.trim(), email: email.trim() });
				toastManager.add({ title: "联系人已更新" });
			} else {
				await createContact.mutateAsync({ name: name.trim(), email: email.trim() });
				toastManager.add({ title: "联系人已添加" });
			}
			setIsFormOpen(false);
		} catch (err: unknown) {
			setError((err instanceof Error ? err.message : null) || "保存失败");
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!toDelete) return;
		setIsDeleting(true);
		try {
			await deleteContact.mutateAsync(toDelete.id);
			toastManager.add({ title: "联系人已删除" });
			setToDelete(null);
		} catch {
			toastManager.add({ title: "删除失败", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-2xl px-4 py-5 md:px-8 md:py-6">
				{/* Header: title left, create button top-right */}
				<div className="mb-5 flex items-center justify-between gap-4">
					<div>
						<h1 className="text-lg font-semibold text-foreground">通讯录</h1>
						{contacts.length > 0 && (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{contacts.length} 个联系人
							</p>
						)}
					</div>
					<Button size="sm" onClick={openCreate}>
						<PlusIcon size={16} />
						新建联系人
					</Button>
				</div>

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : contacts.length > 0 ? (
					<div className="overflow-hidden rounded-xl border border-border bg-card">
						{contacts.map((contact, idx) => (
							<div
								key={contact.id}
								className={`group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/60 ${
									idx > 0 ? "border-t border-border" : ""
								}`}
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
									{contact.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium text-foreground">
										{contact.name}
									</div>
									<div className="truncate text-xs text-muted-foreground">
										{contact.email}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
									<Button
										variant="ghost"
										size="icon-sm"
										className="text-muted-foreground"
										aria-label={`编辑 ${contact.name}`}
										onClick={() => openEdit(contact)}
									>
										<PencilSimpleIcon size={16} />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										className="text-muted-foreground hover:text-destructive"
										aria-label={`删除 ${contact.name}`}
										onClick={() => setToDelete(contact)}
									>
										<TrashIcon size={16} />
									</Button>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-border bg-card px-6 py-16">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
								<AddressBookIcon size={24} className="text-muted-foreground" />
							</div>
							<h3 className="mb-1.5 text-base font-semibold text-foreground">
								还没有联系人
							</h3>
							<p className="mb-5 max-w-sm text-sm text-muted-foreground">
								添加常用联系人，写邮件时即可在收件人栏快速选择。
							</p>
							<Button size="sm" onClick={openCreate}>
								<PlusIcon size={16} />
								新建联系人
							</Button>
						</div>
					</div>
				)}
			</div>

			{/* Create / edit dialog */}
			<Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{editing ? "编辑联系人" : "新建联系人"}</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleSubmit} className="space-y-4">
						{error && <p className="text-sm text-destructive">{error}</p>}
						<div className="space-y-1.5">
							<Label>姓名</Label>
							<Input
								placeholder="张三"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label>邮箱</Label>
							<Input
								type="email"
								placeholder="zhangsan@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</div>
						<DialogFooter>
							<DialogClose asChild>
								<Button type="button" variant="outline" size="sm">
									取消
								</Button>
							</DialogClose>
							<Button type="submit" size="sm" disabled={isSaving}>
								{isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
								{editing ? "保存" : "添加"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete dialog */}
			<Dialog
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>删除联系人</DialogTitle>
						<DialogDescription>
							确定要删除{" "}
							<strong className="text-foreground">{toDelete?.name}</strong>
							{" "}吗？此操作无法撤销。
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" size="sm">
								取消
							</Button>
						</DialogClose>
						<Button
							variant="destructive"
							size="sm"
							disabled={isDeleting}
							onClick={handleDelete}
						>
							{isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
							删除
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

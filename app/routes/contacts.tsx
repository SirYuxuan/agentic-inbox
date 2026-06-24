// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	AddressBookIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
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
			<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6">
				<div className="mb-6">
					<div className="flex items-center justify-between">
						<h1 className="text-lg font-semibold text-kumo-default">通讯录</h1>
						<Button
							variant="primary"
							icon={<PlusIcon size={16} />}
							onClick={openCreate}
						>
							新建联系人
						</Button>
					</div>
				</div>

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : contacts.length > 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						{contacts.map((contact, idx) => (
							<div
								key={contact.id}
								className={`group flex items-center gap-4 px-5 py-4 ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
									{contact.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-kumo-default truncate">
										{contact.name}
									</div>
									<div className="text-sm text-kumo-subtle truncate">
										{contact.email}
									</div>
								</div>
								<div className="flex items-center gap-1 shrink-0">
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<PencilSimpleIcon size={16} />}
										aria-label={`编辑 ${contact.name}`}
										onClick={() => openEdit(contact)}
									/>
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										icon={<TrashIcon size={16} />}
										aria-label={`删除 ${contact.name}`}
										onClick={() => setToDelete(contact)}
									/>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4">
								<AddressBookIcon size={48} weight="thin" className="text-kumo-subtle" />
							</div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">
								还没有联系人
							</h3>
							<p className="text-sm text-kumo-subtle max-w-sm mb-5">
								添加常用联系人，写邮件时即可在收件人栏快速选择。
							</p>
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								onClick={openCreate}
							>
								新建联系人
							</Button>
						</div>
					</div>
				)}
			</div>

			{/* Create / edit dialog */}
			<Dialog.Root open={isFormOpen} onOpenChange={setIsFormOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-5">
						{editing ? "编辑联系人" : "新建联系人"}
					</Dialog.Title>
					<form onSubmit={handleSubmit} className="space-y-4">
						{error && (
							<Text variant="error" size="sm">
								{error}
							</Text>
						)}
						<Input
							label="姓名"
							placeholder="张三"
							size="sm"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
						<Input
							label="邮箱"
							type="email"
							placeholder="zhangsan@example.com"
							size="sm"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										取消
									</Button>
								)}
							/>
							<Button type="submit" variant="primary" size="sm" loading={isSaving}>
								{editing ? "保存" : "添加"}
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete dialog */}
			<Dialog.Root
				open={toDelete !== null}
				onOpenChange={(open) => {
					if (!open) setToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						删除联系人
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						确定要删除{" "}
						<strong className="text-kumo-default">{toDelete?.name}</strong>
						{" "}吗？此操作无法撤销。
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									取消
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isDeleting}
							onClick={handleDelete}
						>
							删除
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}

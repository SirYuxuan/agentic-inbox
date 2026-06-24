// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { ChevronLeft, ChevronRight, GripVertical, Inbox, Loader2, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Badge } from "~/components/ui/badge";
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
import api from "~/services/api";
import {
	getMailboxOrderKey,
	readMailboxOrder,
	sortMailboxesByOrder,
	writeMailboxOrder,
	type MailboxListItem,
} from "~/lib/mailbox-order";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";

const MAILBOX_PAGE_SIZE = 8;

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const { data: mailboxes = [], refetch: refetchMailboxes, isFetched: mailboxesFetched } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [mailboxOrder, setMailboxOrder] = useState<string[]>([]);
	const [page, setPage] = useState(1);
	const [draggedEmail, setDraggedEmail] = useState<string | null>(null);
	const [dragOverEmail, setDragOverEmail] = useState<string | null>(null);

	useEffect(() => {
		setMailboxOrder(readMailboxOrder());
	}, []);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(
			mailboxes.map((m) => m.email.toLowerCase()),
		);
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => { if (!cancelled) refetchMailboxes(); });
		return () => { cancelled = true; };
	}, [emailAddresses, mailboxes, refetchMailboxes]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError("请填写所有字段");
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: "邮箱创建成功！" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "创建邮箱失败";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "邮箱已删除" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "删除邮箱失败", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const mailboxesByEmail = new Map(
		mailboxes.map((mailbox) => [mailbox.email.toLowerCase(), mailbox]),
	);
	const accounts: MailboxListItem[] = isConfigured
		? emailAddresses.map((addr) => {
				const mailbox = mailboxesByEmail.get(addr.toLowerCase());
				const localPart = addr.split("@")[0] || addr;
				return {
					id: mailbox?.id ?? addr,
					email: addr,
					name: mailbox?.settings?.fromName || mailbox?.name || localPart,
					settings: mailbox?.settings,
				};
			})
		: mailboxes;
	const orderedAccounts = useMemo(
		() => sortMailboxesByOrder(accounts, mailboxOrder),
		[accounts, mailboxOrder],
	);
	const pageCount = Math.max(1, Math.ceil(orderedAccounts.length / MAILBOX_PAGE_SIZE));
	const visibleAccounts = orderedAccounts.slice(
		(page - 1) * MAILBOX_PAGE_SIZE,
		page * MAILBOX_PAGE_SIZE,
	);

	useEffect(() => {
		setPage((current) => Math.min(current, pageCount));
	}, [pageCount]);

	const moveMailbox = (sourceEmail: string, targetEmail: string) => {
		if (sourceEmail === targetEmail) return;
		const currentOrder = orderedAccounts.map(getMailboxOrderKey);
		const sourceIndex = currentOrder.indexOf(sourceEmail);
		const targetIndex = currentOrder.indexOf(targetEmail);
		if (sourceIndex === -1 || targetIndex === -1) return;
		const nextOrder = [...currentOrder];
		const [moved] = nextOrder.splice(sourceIndex, 1);
		nextOrder.splice(targetIndex, 0, moved);
		setMailboxOrder(nextOrder);
		writeMailboxOrder(nextOrder);
	};

	const isLoading = !configData;

	return (
		<div className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-xl px-6 py-16 md:py-24">
				<div className="mb-8 flex items-end justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">邮箱</h1>
						{domains.length > 0 && (
							<p className="mt-1 text-sm text-muted-foreground">
								{domains.join("、")}
							</p>
						)}
					</div>
					{!isConfigured && (
						<Button size="sm" onClick={() => setIsCreateOpen(true)}>
							<Plus className="h-4 w-4" />
							新建邮箱
						</Button>
					)}
				</div>

				{isLoading ? (
					<div className="flex justify-center py-24">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				) : orderedAccounts.length > 0 ? (
					<>
					<div className="overflow-hidden rounded-xl border border-border bg-card">
						{visibleAccounts.map((account, idx) => {
							const orderKey = getMailboxOrderKey(account);
							return (
							<RouterLink
								key={account.id}
								to={`/mailbox/${account.id}`}
								draggable
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = "move";
									e.dataTransfer.setData("text/plain", orderKey);
									setDraggedEmail(orderKey);
								}}
								onDragOver={(e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									setDragOverEmail(orderKey);
								}}
								onDragLeave={() => {
									setDragOverEmail((current) => current === orderKey ? null : current);
								}}
								onDrop={(e) => {
									e.preventDefault();
									const sourceEmail = e.dataTransfer.getData("text/plain") || draggedEmail;
									if (sourceEmail) moveMailbox(sourceEmail, orderKey);
									setDraggedEmail(null);
									setDragOverEmail(null);
								}}
								onDragEnd={() => {
									setDraggedEmail(null);
									setDragOverEmail(null);
								}}
								className={`group flex items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-accent ${
									idx > 0 ? "border-t border-border" : ""
								} ${
									dragOverEmail === orderKey && draggedEmail !== orderKey ? "bg-accent/70" : ""
								} ${
									draggedEmail === orderKey ? "opacity-60" : ""
								}`}
							>
								<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm font-medium">
										{account.name}
									</div>
									<div className="truncate text-xs text-muted-foreground">
										{account.email}
									</div>
								</div>
								{!isConfigured && (
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`删除邮箱 ${account.email}`}
										className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToDelete({
												id: account.id,
												email: account.email,
											});
											setIsDeleteOpen(true);
										}}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								)}
							</RouterLink>
							);
						})}
					</div>
					{pageCount > 1 && (
						<div className="mt-4 flex items-center justify-center gap-2">
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="上一页"
								disabled={page === 1}
								onClick={() => setPage((current) => Math.max(1, current - 1))}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
							<div className="min-w-16 text-center text-xs text-muted-foreground">
								{page} / {pageCount}
							</div>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="下一页"
								disabled={page === pageCount}
								onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</div>
					)}
					</>
				) : (
					<div className="rounded-xl border border-border bg-card px-6 py-16">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
								<Inbox className="h-6 w-6 text-muted-foreground" />
							</div>
							<h3 className="mb-1.5 text-base font-semibold">还没有邮箱</h3>
							<p className="mb-5 max-w-sm text-sm text-muted-foreground">
								{isConfigured
									? "邮件路由已配置，但还没有创建邮箱。创建后会自动显示在这里。"
									: "创建一个邮箱，即可用你的域名收发邮件。"}
							</p>
							{!isConfigured && (
								<Button size="sm" onClick={() => setIsCreateOpen(true)}>
									<Plus className="h-4 w-4" />
									创建邮箱
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>创建新邮箱</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<p className="text-sm text-destructive">{createError}</p>
						)}
						<div className="space-y-1.5">
							<Label>邮箱地址</Label>
							<div className="flex items-center gap-2">
								<Input
									aria-label="地址前缀"
									placeholder="info"
									value={newPrefix}
									onChange={(e) => setNewPrefix(e.target.value)}
									required
								/>
								<span className="text-sm text-muted-foreground">@</span>
								{domains.length > 1 ? (
									<select
										aria-label="域名"
										value={selectedDomain}
										onChange={(e) => setSelectedDomain(e.target.value)}
										className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{domains.map((d) => (
											<option key={d} value={d}>
												{d}
											</option>
										))}
									</select>
								) : (
									<Badge variant="secondary" className="shrink-0">
										{selectedDomain || "无域名"}
									</Badge>
								)}
							</div>
						</div>
						<div className="space-y-1.5">
							<Label>显示名称（可选）</Label>
							<Input
								placeholder="Info"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
							/>
						</div>
						<DialogFooter className="pt-2">
							<DialogClose asChild>
								<Button type="button" variant="outline" size="sm">
									取消
								</Button>
							</DialogClose>
							<Button type="submit" size="sm" disabled={!selectedDomain || isCreating}>
								{isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
								创建
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>删除邮箱</DialogTitle>
						<DialogDescription>
							确定要删除{" "}
							<strong className="text-foreground">{mailboxToDelete?.email}</strong>
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

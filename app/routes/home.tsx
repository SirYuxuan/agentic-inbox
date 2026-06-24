// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import {
	AtSign,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	GripVertical,
	Inbox,
	Loader2,
	Mail,
	Network,
	Plus,
	Route,
	ShieldCheck,
	Trash2,
} from "lucide-react";
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
import { cn } from "~/lib/utils";
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseMailboxEntries(
	value: string,
	defaultDomain: string,
): { email: string; name: string }[] {
	const entries = value
		.split(/[\s,，;；]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
	const seen = new Set<string>();

	return entries.map((entry) => {
		const email = (entry.includes("@") ? entry : `${entry}@${defaultDomain}`).toLowerCase();
		if (!EMAIL_RE.test(email)) {
			throw new Error(`邮箱格式不正确：${entry}`);
		}
		if (seen.has(email)) {
			throw new Error(`邮箱重复：${email}`);
		}
		seen.add(email);
		return { email, name: email.split("@")[0] || email };
	});
}

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
		if (!newPrefix.trim()) {
			setCreateError("请填写邮箱地址");
			return;
		}
		let mailboxEntries: { email: string; name: string }[];
		try {
			mailboxEntries = parseMailboxEntries(newPrefix, selectedDomain);
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "邮箱格式不正确");
			return;
		}
		setIsCreating(true);
		try {
			await Promise.all(
				mailboxEntries.map((entry) =>
					createMailbox.mutateAsync({
						email: entry.email,
						name: mailboxEntries.length === 1 && newName.trim()
							? newName.trim()
							: entry.name,
					}),
				),
			);
			toastManager.add({
				title: mailboxEntries.length === 1
					? "邮箱创建成功！"
					: `已创建 ${mailboxEntries.length} 个邮箱`,
			});
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
	const mailboxCount = orderedAccounts.length;
	const configuredCount = emailAddresses.length;
	const routeMode = isConfigured ? "固定路由" : "手动管理";
	const primaryDomain = domains[0] || "未配置";

	return (
		<div className="min-h-screen bg-muted/30 text-foreground">
			<div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
				<header className="mb-4 flex flex-col gap-3 border-b border-border/80 pb-4 md:flex-row md:items-center md:justify-between">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h1 className="mr-1 text-xl font-semibold tracking-tight">
							邮箱
						</h1>
						<Badge variant="secondary" className="rounded-full px-2.5">
							{routeMode}
						</Badge>
						<div className="flex flex-wrap gap-2">
							{domains.length > 0 ? (
								domains.map((domain) => (
									<Badge key={domain} variant="outline" className="rounded-full bg-background/80 px-2.5">
										<AtSign className="h-3.5 w-3.5" />
										{domain}
									</Badge>
								))
							) : (
								<Badge variant="outline" className="rounded-full bg-background/80 px-2.5">
									<AtSign className="h-3.5 w-3.5" />
									未配置域名
								</Badge>
							)}
						</div>
					</div>
					{!isConfigured && (
						<Button onClick={() => setIsCreateOpen(true)}>
							<Plus className="h-4 w-4" />
							新建邮箱
						</Button>
					)}
				</header>

				{isLoading ? (
					<div className="flex flex-1 items-center justify-center">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="h-5 w-5 animate-spin" />
							加载中
						</div>
					</div>
				) : orderedAccounts.length > 0 ? (
					<>
					<div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm shadow-sm">
						<div className="flex items-center gap-2 pr-3">
							<Mail className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium">{mailboxCount}</span>
							<span className="text-muted-foreground">邮箱</span>
						</div>
						<div className="h-4 w-px bg-border" />
						<div className="flex items-center gap-2 px-3">
							<AtSign className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium">{domains.length || 0}</span>
							<span className="text-muted-foreground">域名</span>
						</div>
						<div className="h-4 w-px bg-border" />
						<div className="flex items-center gap-2 pl-3">
							<Route className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium">{configuredCount || "不限"}</span>
							<span className="text-muted-foreground">路由地址</span>
						</div>
					</div>

					<div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
						<section className="min-w-0">
							<div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
								<div className="hidden grid-cols-[28px_minmax(0,1fr)_160px_44px] items-center gap-3 border-b border-border bg-muted/50 px-5 py-3 text-xs font-medium text-muted-foreground md:grid">
									<div />
									<div>邮箱</div>
									<div>域名</div>
									<div />
								</div>
								{visibleAccounts.map((account, idx) => {
									const orderKey = getMailboxOrderKey(account);
									const domain = account.email.split("@")[1] || primaryDomain;
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
											className={cn(
												"group grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 no-underline transition-colors hover:bg-accent/60 md:grid-cols-[28px_minmax(0,1fr)_160px_44px] md:px-5",
												idx > 0 && "border-t border-border",
												dragOverEmail === orderKey && draggedEmail !== orderKey && "bg-accent/70",
												draggedEmail === orderKey && "opacity-60",
											)}
										>
											<GripVertical className="h-4 w-4 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
											<div className="flex min-w-0 items-center gap-3">
												<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-foreground ring-1 ring-border">
													{account.name.charAt(0).toUpperCase()}
												</div>
												<div className="min-w-0">
													<div className="truncate text-sm font-medium">
														{account.name}
													</div>
													<div className="truncate text-xs text-muted-foreground">
														{account.email}
													</div>
												</div>
											</div>
											<div className="hidden truncate text-sm text-muted-foreground md:block">
												{domain}
											</div>
											{!isConfigured ? (
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`删除邮箱 ${account.email}`}
													className="justify-self-end text-muted-foreground opacity-100 hover:text-destructive md:opacity-0 md:transition-opacity md:group-hover:opacity-100"
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
											) : (
												<div className="hidden md:block" />
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
									<div className="min-w-14 text-center text-xs text-muted-foreground">
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
						</section>

						<aside className="space-y-4">
							<div className="rounded-xl border border-border bg-card p-5 shadow-sm">
								<div className="mb-4 flex items-center gap-2">
									<Mail className="h-4 w-4 text-muted-foreground" />
									<h2 className="text-sm font-medium">概览</h2>
								</div>
								<div className="space-y-3.5 text-sm">
									<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
										<span className="text-muted-foreground">邮箱</span>
										<span className="font-medium">{mailboxCount}</span>
									</div>
									<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
										<span className="text-muted-foreground">域名</span>
										<span className="truncate font-medium">{domains.length || 0}</span>
									</div>
									<div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
										<span className="text-muted-foreground">路由地址</span>
										<span className="font-medium">{configuredCount || "不限"}</span>
									</div>
								</div>
							</div>

							<div className="rounded-xl border border-border bg-card p-5 shadow-sm">
								<div className="mb-4 flex items-center gap-2">
									<Network className="h-4 w-4 text-muted-foreground" />
									<h2 className="text-sm font-medium">路由</h2>
								</div>
								<div className="space-y-4">
									<div className="rounded-lg border border-border bg-background px-3 py-3">
										<div className="text-xs text-muted-foreground">主域名</div>
										<div className="mt-1 truncate text-sm font-medium">{primaryDomain}</div>
									</div>
									<div className="rounded-lg border border-border bg-background px-3 py-3">
										<div className="text-xs text-muted-foreground">创建模式</div>
										<div className="mt-1 flex items-center gap-2 text-sm font-medium">
											<ShieldCheck className="h-4 w-4 text-muted-foreground" />
											{routeMode}
										</div>
									</div>
								</div>
							</div>

							<div className="rounded-xl border border-border bg-card p-5 shadow-sm">
								<div className="flex items-start gap-3">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
										<CheckCircle2 className="h-4 w-4" />
									</div>
									<div className="min-w-0">
										<div className="text-sm font-medium">本地偏好已启用</div>
										<div className="mt-1 text-xs leading-relaxed text-muted-foreground">
											邮箱排序会保存在当前浏览器。
										</div>
									</div>
								</div>
							</div>
						</aside>
					</div>
					</>
				) : (
					<div className="flex flex-1 items-center justify-center">
					<div className="w-full max-w-lg rounded-xl border border-border bg-card px-6 py-16 shadow-sm">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
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
							<textarea
								aria-label="邮箱地址"
								placeholder="info&#10;sales&#10;support@example.com"
								value={newPrefix}
								onChange={(e) => setNewPrefix(e.target.value)}
								required
								rows={4}
								className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
							<p className="text-xs text-muted-foreground">
								支持一行一个，或用逗号、空格分隔；未带 @ 的条目会使用默认域名。
							</p>
						</div>
						<div className="space-y-1.5">
							<Label>默认域名</Label>
							{domains.length > 1 ? (
								<select
									aria-label="默认域名"
									value={selectedDomain}
									onChange={(e) => setSelectedDomain(e.target.value)}
									className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{domains.map((d) => (
										<option key={d} value={d}>
											{d}
										</option>
									))}
								</select>
							) : (
								<Badge variant="secondary" className="w-fit shrink-0">
									{selectedDomain || "无域名"}
								</Badge>
							)}
						</div>
						<div className="space-y-1.5">
							<Label>显示名称（可选）</Label>
							<Input
								placeholder="Info"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								批量创建时会自动使用邮箱前缀作为显示名称。
							</p>
						</div>
						<DialogFooter className="pt-2">
							<DialogClose asChild>
								<Button type="button" variant="outline" size="sm">
									取消
								</Button>
							</DialogClose>
							<Button type="submit" size="sm" disabled={!newPrefix.trim() || isCreating}>
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

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Mail, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

interface AuthPageProps {
	title: string;
	description: string;
	children: ReactNode;
	footer: ReactNode;
}

export function AuthPage({ title, description, children, footer }: AuthPageProps) {
	return (
		<div className="relative min-h-screen overflow-hidden bg-muted/30">
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-foreground/[0.035] blur-3xl" />
				<div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-foreground/[0.04] blur-3xl" />
			</div>

			<div className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-12 px-5 py-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-10">
				<section className="hidden max-w-xl lg:block">
					<div className="mb-8 flex items-center gap-3">
						<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
							<Mail className="h-5 w-5" />
						</div>
						<div>
							<div className="text-base font-semibold tracking-tight">Agentic Inbox</div>
							<div className="text-xs text-muted-foreground">你的智能邮件工作台</div>
						</div>
					</div>
					<h1 className="max-w-lg text-4xl font-semibold leading-tight tracking-tight text-foreground">
						让每个邮箱都更清晰、更高效。
					</h1>
					<p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
						在一个安全的工作台中管理邮件、会话和 AI 草稿，每个账号的数据彼此隔离。
					</p>
					<div className="mt-9 grid max-w-lg gap-3 sm:grid-cols-2">
						<div className="rounded-xl border border-border bg-card/70 p-4">
							<ShieldCheck className="mb-3 h-5 w-5 text-muted-foreground" />
							<div className="text-sm font-medium">账号数据隔离</div>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								只能查看和管理属于你的邮箱。
							</p>
						</div>
						<div className="rounded-xl border border-border bg-card/70 p-4">
							<Sparkles className="mb-3 h-5 w-5 text-muted-foreground" />
							<div className="text-sm font-medium">AI 辅助处理</div>
							<p className="mt-1 text-xs leading-5 text-muted-foreground">
								阅读、搜索和起草回复都在同一处完成。
							</p>
						</div>
					</div>
				</section>

				<main className="mx-auto w-full max-w-[420px]">
					<div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground text-background">
							<Mail className="h-4 w-4" />
						</div>
						<span className="font-semibold tracking-tight">Agentic Inbox</span>
					</div>
					<Card className="shadow-sm">
						<CardHeader className="pb-5">
							<CardTitle className="text-xl">{title}</CardTitle>
							<CardDescription className="leading-5">{description}</CardDescription>
						</CardHeader>
						<CardContent>
							{children}
							<div className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
								{footer}
							</div>
						</CardContent>
					</Card>
				</main>
			</div>
		</div>
	);
}

// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader2, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AuthPage } from "~/components/AuthPage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getSafeNextPath } from "~/lib/auth-client";
import { useAuthSession, useLogin } from "~/queries/auth";
import { ApiError } from "~/services/api";

function getLoginErrorMessage(error: Error) {
	if (error instanceof ApiError && error.status === 401) return "账号或密码错误。";
	if (error instanceof ApiError && error.status === 429) return "尝试次数过多，请稍后再试。";
	return error.message || "登录失败，请稍后重试。";
}

export function meta() {
	return [{ title: "登录 · Agentic Inbox" }];
}

export default function LoginRoute() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const next = getSafeNextPath(searchParams.get("next"));
	const session = useAuthSession(true);
	const login = useLogin();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");

	if (!session.isFetching && session.data?.user) {
		return <Navigate to={next} replace />;
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		login.reset();
		try {
			await login.mutateAsync({ username: username.trim(), password });
			navigate(next, { replace: true });
		} catch {
			// The mutation error is rendered below the form.
		}
	};

	const registerHref = next === "/"
		? "/register"
		: `/register?next=${encodeURIComponent(next)}`;

	return (
		<AuthPage
			title="欢迎回来"
			description="使用你的账号和密码登录邮箱工作台。"
			footer={
				<>
					还没有账号？{" "}
					<Link className="font-medium text-foreground underline-offset-4 hover:underline" to={registerHref}>
						注册账号
					</Link>
				</>
			}
		>
			<form className="space-y-4" onSubmit={handleSubmit}>
				{login.error && (
					<div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
						{getLoginErrorMessage(login.error)}
					</div>
				)}
				<div className="space-y-1.5">
					<Label htmlFor="username">账号</Label>
					<Input
						id="username"
						name="username"
						autoComplete="username"
						autoFocus
						required
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						placeholder="请输入账号"
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="password">密码</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						placeholder="请输入密码"
					/>
				</div>
				<Button type="submit" className="mt-2 w-full" disabled={login.isPending}>
					{login.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<LogIn className="h-4 w-4" />
					)}
					登录
				</Button>
			</form>
		</AuthPage>
	);
}

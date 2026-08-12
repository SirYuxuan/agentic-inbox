// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AuthPage } from "~/components/AuthPage";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { getSafeNextPath } from "~/lib/auth-client";
import { useAuthSession, useRegister } from "~/queries/auth";
import { ApiError } from "~/services/api";

const MAILBOX_PREFIX_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

function getRegisterErrorMessage(error: Error | null) {
	if (!error) return null;
	if (error instanceof ApiError && error.status === 403) return "注册密钥无效。";
	if (error instanceof ApiError && error.status === 409) return "账号或邮箱前缀已被使用。";
	if (error instanceof ApiError && error.status === 503) return "注册服务暂不可用，请联系管理员。";
	return error.message || "注册失败，请稍后重试。";
}

export function meta() {
	return [{ title: "注册 · Agentic Inbox" }];
}

export default function RegisterRoute() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const next = getSafeNextPath(searchParams.get("next"));
	const session = useAuthSession(true);
	const register = useRegister();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [registrationKey, setRegistrationKey] = useState("");
	const [mailboxPrefix, setMailboxPrefix] = useState("");
	const [validationError, setValidationError] = useState<string | null>(null);

	if (!session.isFetching && session.data?.user) {
		return <Navigate to={next} replace />;
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		register.reset();
		setValidationError(null);
		const normalizedUsername = username.trim();
		const normalizedPrefix = mailboxPrefix.trim().toLowerCase();
		if (!USERNAME_RE.test(normalizedUsername)) {
			setValidationError("账号只能包含字母、数字、下划线和短横线。");
			return;
		}
		if (password.length < 8) {
			setValidationError("密码至少需要 8 个字符。");
			return;
		}
		if (password !== confirmPassword) {
			setValidationError("两次输入的密码不一致。");
			return;
		}
		if (!MAILBOX_PREFIX_RE.test(normalizedPrefix)) {
			setValidationError("邮箱前缀只能包含小写字母、数字和短横线，且不能以短横线开头或结尾。");
			return;
		}

		try {
			await register.mutateAsync({
				username: normalizedUsername,
				password,
				mailboxPrefix: normalizedPrefix,
				registrationKey: registrationKey.trim(),
			});
			navigate(next, { replace: true });
		} catch {
			// The mutation error is rendered below the form.
		}
	};

	const loginHref = next === "/"
		? "/login"
		: `/login?next=${encodeURIComponent(next)}`;
	const visibleError = validationError || getRegisterErrorMessage(register.error);

	return (
		<AuthPage
			title="创建账号"
			description="注册后，你创建的邮箱都会归属于这个账号。"
			footer={
				<>
					已有账号？{" "}
					<Link className="font-medium text-foreground underline-offset-4 hover:underline" to={loginHref}>
						返回登录
					</Link>
				</>
			}
		>
			<form className="space-y-3.5" onSubmit={handleSubmit}>
				{visibleError && (
					<div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
						{visibleError}
					</div>
				)}
				<div className="grid gap-3.5 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="username">账号</Label>
						<Input
							id="username"
							name="username"
							autoComplete="username"
							autoFocus
							required
							minLength={3}
							maxLength={64}
							value={username}
							onChange={(event) => setUsername(event.target.value)}
							placeholder="登录账号"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="mailbox-prefix">邮箱前缀</Label>
						<Input
							id="mailbox-prefix"
							name="mailboxPrefix"
							autoComplete="off"
							required
							maxLength={62}
							value={mailboxPrefix}
							onChange={(event) => setMailboxPrefix(event.target.value.toLowerCase())}
							placeholder="例如 lpp"
						/>
					</div>
				</div>
				<p className="-mt-1 text-xs text-muted-foreground">
					普通邮箱将使用 <span className="font-medium text-foreground">{mailboxPrefix.trim().toLowerCase() || "你的前缀"}.自定义@oofo.cc</span>
				</p>
				<div className="grid gap-3.5 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label htmlFor="password">密码</Label>
						<Input
							id="password"
							name="password"
							type="password"
							autoComplete="new-password"
							required
							minLength={8}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							placeholder="至少 8 个字符"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="confirm-password">确认密码</Label>
						<Input
							id="confirm-password"
							name="confirmPassword"
							type="password"
							autoComplete="new-password"
							required
							value={confirmPassword}
							onChange={(event) => setConfirmPassword(event.target.value)}
							placeholder="再次输入密码"
						/>
					</div>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="registration-key">注册密钥</Label>
					<Input
						id="registration-key"
						name="registrationKey"
						type="password"
						autoComplete="off"
						required
						value={registrationKey}
						onChange={(event) => setRegistrationKey(event.target.value)}
						placeholder="请输入管理员提供的注册密钥"
					/>
				</div>
				<Button type="submit" className="mt-2 w-full" disabled={register.isPending}>
					{register.isPending ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<UserPlus className="h-4 w-4" />
					)}
					注册并登录
				</Button>
			</form>
		</AuthPage>
	);
}

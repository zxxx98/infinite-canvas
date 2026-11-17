import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { Lock, User } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { extractApiError } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [submitting, setSubmitting] = useState(false);
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const hydrateSession = useUserStore((state) => state.hydrateSession);
    const login = useUserStore((state) => state.login);

    const redirectTo = searchParams.get("redirect") || "/";

    useEffect(() => {
        if (!isReady) void hydrateSession();
    }, [hydrateSession, isReady]);

    if (isReady && user) {
        return <Navigate to={redirectTo} replace />;
    }

    const handleFinish = async (values: { username: string; password: string }) => {
        setSubmitting(true);
        try {
            await login({ username: values.username.trim(), password: values.password });
            message.success("登录成功");
            navigate(redirectTo, { replace: true });
        } catch (error) {
            message.error(extractApiError(error, "登录失败，请检查用户名和密码"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <div className="absolute right-6 top-4 z-10">
                <UserStatusActions showConfig={false} />
            </div>
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 text-stone-900 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] dark:text-stone-100">
                <section className="w-full max-w-sm rounded-xl border border-stone-200 bg-white/95 p-7 shadow-sm backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
                    <div className="mb-6 flex flex-col items-center text-center">
                        <span
                            className="mb-3 size-9 bg-stone-950 dark:bg-stone-100"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">{t("meta.title")}</h1>
                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">请使用管理员分配的账号登录</p>
                    </div>

                    <Form layout="vertical" requiredMark={false} onFinish={(values) => void handleFinish(values)}>
                        <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                            <Input prefix={<User className="size-4 text-stone-400" />} placeholder="请输入用户名" autoComplete="username" size="large" />
                        </Form.Item>
                        <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password prefix={<Lock className="size-4 text-stone-400" />} placeholder="请输入密码" autoComplete="current-password" size="large" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={submitting} className="mt-2">
                            登录
                        </Button>
                    </Form>
                </section>
            </main>
        </div>
    );
}

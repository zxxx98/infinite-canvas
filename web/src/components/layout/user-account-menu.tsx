import type { CSSProperties } from "react";
import { useState } from "react";
import { App, Dropdown, Form, Input, Modal, Tag } from "antd";
import { KeyRound, LogOut, Server, Shield, UserRound, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { changePasswordApi, extractApiError } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export function UserAccountMenu({ variant = "default" }: { variant?: "default" | "canvas" }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [form] = Form.useForm<{ currentPassword: string; newPassword: string }>();
    const [pwdOpen, setPwdOpen] = useState(false);
    const [savingPwd, setSavingPwd] = useState(false);

    const theme = useThemeStore((state) => state.theme);
    const user = useUserStore((state) => state.user);
    const token = useUserStore((state) => state.token);
    const setSession = useUserStore((state) => state.setSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    if (!user) return null;

    const canvasTheme = canvasThemes[theme];
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const isAdmin = user.role === "admin";

    const handleChangePassword = async (values: { currentPassword: string; newPassword: string }) => {
        if (!token) return;
        setSavingPwd(true);
        try {
            const session = await changePasswordApi(token, values);
            setSession(session.token, session.user);
            message.success("密码已修改");
            setPwdOpen(false);
            form.resetFields();
        } catch (error) {
            message.error(extractApiError(error, "修改密码失败"));
        } finally {
            setSavingPwd(false);
        }
    };

    const handleLogout = () => {
        clearSession();
        navigate("/login", { replace: true });
    };

    return (
        <>
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                    items: [
                        {
                            key: "profile",
                            disabled: true,
                            label: (
                                <div className="cursor-default py-0.5 text-stone-900 dark:text-stone-100">
                                    <div className="flex items-center gap-2 font-medium">
                                        <span className="truncate">{user.displayName || user.username}</span>
                                        <Tag color={isAdmin ? "gold" : "default"} className="m-0 text-[10px]">
                                            {isAdmin ? "管理员" : "普通用户"}
                                        </Tag>
                                    </div>
                                    <div className="text-xs text-stone-500">@{user.username}</div>
                                </div>
                            ),
                        },
                        { type: "divider" },
                        ...(isAdmin
                            ? [
                                  {
                                      key: "channels",
                                      icon: <Server className="size-3.5" />,
                                      label: "渠道配置",
                                      onClick: () => openConfigDialog(false, "channels"),
                                  },
                                  {
                                      key: "users",
                                      icon: <Users className="size-3.5" />,
                                      label: "账号管理",
                                      onClick: () => openConfigDialog(false, "users"),
                                  },
                                  { type: "divider" as const },
                              ]
                            : []),
                        {
                            key: "password",
                            icon: <KeyRound className="size-3.5" />,
                            label: "修改密码",
                            onClick: () => {
                                form.resetFields();
                                setPwdOpen(true);
                            },
                        },
                        {
                            key: "logout",
                            danger: true,
                            icon: <LogOut className="size-3.5" />,
                            label: "退出登录",
                            onClick: handleLogout,
                        },
                    ],
                }}
            >
                <button
                    type="button"
                    className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4"
                    style={iconStyle}
                    aria-label="当前账号"
                    title={`${user.displayName || user.username} (${isAdmin ? "管理员" : "普通用户"})`}
                >
                    {isAdmin ? <Shield className="size-4" /> : <UserRound className="size-4" />}
                </button>
            </Dropdown>

            <Modal
                title="修改密码"
                open={pwdOpen}
                centered
                width={380}
                onCancel={() => setPwdOpen(false)}
                onOk={() => form.submit()}
                confirmLoading={savingPwd}
                okText="保存"
                cancelText="取消"
            >
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void handleChangePassword(values)} className="mt-3">
                    <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
                        <Input.Password placeholder="请输入当前密码" autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: "请输入新密码" }]} className="mb-0">
                        <Input.Password placeholder="请输入新密码" autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}

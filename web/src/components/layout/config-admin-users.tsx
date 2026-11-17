import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Select, Switch, Tag } from "antd";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import {
    createAdminUserApi,
    deleteAdminUserApi,
    extractApiError,
    fetchAdminUsersApi,
    updateAdminUserApi,
    type AuthUser,
    type UserRole,
} from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";

type UserFormValues = {
    username: string;
    displayName: string;
    role: UserRole;
    password?: string;
};

export function ConfigAdminUsers() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<UserFormValues>();
    const token = useUserStore((state) => state.token);
    const currentUser = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);

    const [users, setUsers] = useState<AuthUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [editingUser, setEditingUser] = useState<AuthUser | null>(null);

    const loadUsers = async () => {
        if (!token) return;
        setLoading(true);
        try {
            setUsers(await fetchAdminUsersApi(token));
        } catch (error) {
            message.error(extractApiError(error, "加载账号列表失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadUsers();
    }, [token]);

    const openCreate = () => {
        setEditingUser(null);
        form.setFieldsValue({ username: "", displayName: "", role: "user", password: "" });
        setModalOpen(true);
    };

    const openEdit = (user: AuthUser) => {
        setEditingUser(user);
        form.setFieldsValue({
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            password: "",
        });
        setModalOpen(true);
    };

    const handleToggleDisabled = async (target: AuthUser, enabled: boolean) => {
        if (!token) return;
        try {
            const updated = await updateAdminUserApi(token, target.id, { disabled: !enabled });
            setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            message.success(enabled ? `已启用账号 ${target.username}` : `已禁用账号 ${target.username}`);
        } catch (error) {
            message.error(extractApiError(error, "更新账号状态失败"));
        }
    };

    const handleDelete = (target: AuthUser) => {
        modal.confirm({
            title: `确认删除账号「${target.username}」？`,
            content: "删除后该账号将无法登录系统。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                if (!token) return;
                try {
                    await deleteAdminUserApi(token, target.id);
                    setUsers((prev) => prev.filter((item) => item.id !== target.id));
                    message.success("已删除账号");
                } catch (error) {
                    message.error(extractApiError(error, "删除账号失败"));
                }
            },
        });
    };

    const handleSubmit = async (values: UserFormValues) => {
        if (!token) return;
        setSubmitting(true);
        try {
            if (editingUser) {
                const updated = await updateAdminUserApi(token, editingUser.id, {
                    displayName: values.displayName?.trim() || editingUser.username,
                    role: values.role,
                    ...(values.password?.trim() ? { password: values.password.trim() } : {}),
                });
                setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
                if (currentUser && updated.id === currentUser.id) {
                    setSession(token, updated);
                }
                message.success("账号已更新");
            } else {
                const created = await createAdminUserApi(token, {
                    username: values.username.trim(),
                    password: values.password?.trim() || "",
                    displayName: values.displayName?.trim() || values.username.trim(),
                    role: values.role,
                });
                setUsers((prev) => [...prev, created]);
                message.success("账号创建成功");
            }
            setModalOpen(false);
        } catch (error) {
            message.error(extractApiError(error, editingUser ? "更新账号失败" : "创建账号失败"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-stone-500">管理可登录系统的账号与权限，支持新增账号、重置密码、切换角色与禁用账号。</div>
                <div className="flex items-center gap-2">
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void loadUsers()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        新增账号
                    </Button>
                </div>
            </div>

            <div className="space-y-2">
                {users.map((item) => {
                    const isSelf = item.id === currentUser?.id;
                    return (
                        <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <Switch
                                size="small"
                                checked={!item.disabled}
                                disabled={isSelf}
                                title={isSelf ? "不能禁用当前登录账号" : item.disabled ? "点击启用" : "点击禁用"}
                                onChange={(checked) => void handleToggleDisabled(item, checked)}
                            />
                            <div className="min-w-[200px] flex-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="truncate text-sm font-semibold">{item.displayName || item.username}</span>
                                    <span className="text-xs text-stone-500">@{item.username}</span>
                                    <Tag color={item.role === "admin" ? "gold" : "default"} className="m-0 text-[10px]">
                                        {item.role === "admin" ? "管理员" : "普通用户"}
                                    </Tag>
                                    {item.disabled ? (
                                        <Tag color="error" className="m-0 text-[10px]">
                                            已禁用
                                        </Tag>
                                    ) : null}
                                    {isSelf ? <Tag className="m-0 text-[10px]">当前账号</Tag> : null}
                                </div>
                                <div className="mt-1 text-xs text-stone-500">创建于 {formatUserTime(item.createdAt)}</div>
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => openEdit(item)}>
                                    编辑
                                </Button>
                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={isSelf} onClick={() => handleDelete(item)} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <Modal
                title={editingUser ? `编辑账号 · ${editingUser.username}` : "新增账号"}
                open={modalOpen}
                centered
                width={420}
                onCancel={() => setModalOpen(false)}
                onOk={() => form.submit()}
                confirmLoading={submitting}
                okText="保存"
                cancelText="取消"
            >
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void handleSubmit(values)} className="mt-3">
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input placeholder="例如：zhangsan" disabled={Boolean(editingUser)} autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="displayName" label="显示名称">
                        <Input placeholder="可选，默认与用户名相同" autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="role" label="角色权限" rules={[{ required: true }]}>
                        <Select
                            disabled={Boolean(editingUser && editingUser.id === currentUser?.id)}
                            options={[
                                { value: "user", label: "普通用户（仅使用已配置渠道）" },
                                { value: "admin", label: "管理员（可管理渠道与账号）" },
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label={editingUser ? "重置密码" : "初始密码"}
                        rules={editingUser ? [] : [{ required: true, message: "请输入初始密码" }]}
                        extra={editingUser ? "留空则保持原密码不变" : undefined}
                        className="mb-0"
                    >
                        <Input.Password placeholder={editingUser ? "留空不修改" : "请输入初始密码"} autoComplete="new-password" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

function formatUserTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

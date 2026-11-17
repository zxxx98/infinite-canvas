import type { ReactNode } from "react";
import { useEffect } from "react";
import { Spin } from "antd";
import { Navigate, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGuard({ children }: { children: ReactNode }) {
    const location = useLocation();
    const user = useUserStore((state) => state.user);
    const isReady = useUserStore((state) => state.isReady);
    const hydrateSession = useUserStore((state) => state.hydrateSession);

    useEffect(() => {
        if (!isReady) void hydrateSession();
    }, [hydrateSession, isReady]);

    if (!isReady) {
        return (
            <div className="flex h-dvh w-full items-center justify-center bg-background">
                <Spin />
            </div>
        );
    }

    if (!user) {
        const current = `${location.pathname}${location.search}`;
        const target = current && current !== "/" ? `/login?redirect=${encodeURIComponent(current)}` : "/login";
        return <Navigate to={target} replace />;
    }

    return <>{children}</>;
}

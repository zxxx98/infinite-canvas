import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
    applyServerChannelsToStore,
    fetchCurrentUserApi,
    fetchServerChannelsApi,
    loginApi,
    type AuthUser,
} from "@/services/api/auth";

export type LocalUser = AuthUser;

export const AUTH_STORAGE_KEY = "infinite-canvas:auth_session";

type UserStore = {
    token: string;
    user: AuthUser | null;
    isReady: boolean;
    isLoading: boolean;
    setSession: (token: string, user: AuthUser) => void;
    clearSession: () => void;
    hydrateSession: () => Promise<void>;
    login: (payload: { username: string; password: string }) => Promise<AuthUser>;
};

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            token: "",
            user: null,
            isReady: false,
            isLoading: false,
            setSession: (token, user) => set({ token, user, isReady: true }),
            clearSession: () => {
                applyServerChannelsToStore([], false);
                set({ token: "", user: null, isReady: true, isLoading: false });
            },
            hydrateSession: async () => {
                const { token, isLoading } = get();
                if (isLoading) return;
                if (!token) {
                    applyServerChannelsToStore([], false);
                    set({ user: null, isReady: true, isLoading: false });
                    return;
                }
                set({ isLoading: true });
                try {
                    const [user, channels] = await Promise.all([
                        fetchCurrentUserApi(token),
                        fetchServerChannelsApi(token),
                    ]);
                    applyServerChannelsToStore(channels, user.role === "admin");
                    set({ user, isReady: true, isLoading: false });
                } catch {
                    applyServerChannelsToStore([], false);
                    set({ token: "", user: null, isReady: true, isLoading: false });
                }
            },
            login: async (payload) => {
                set({ isLoading: true });
                try {
                    const { token, user } = await loginApi(payload);
                    const channels = await fetchServerChannelsApi(token);
                    applyServerChannelsToStore(channels, user.role === "admin");
                    set({ token, user, isReady: true, isLoading: false });
                    return user;
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },
        }),
        {
            name: AUTH_STORAGE_KEY,
            partialize: (state) => ({ token: state.token }),
            onRehydrateStorage: () => (state) => {
                if (state) state.isReady = false;
            },
        },
    ),
);

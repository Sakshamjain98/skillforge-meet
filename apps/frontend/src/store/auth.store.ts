import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@/types/conference.types';

interface AuthStore {
  user:          User | null;
  accessToken:   string | null;
  refreshToken:  string | null;

  setAuth:        (user: User, accessToken: string, refreshToken: string) => void;
  setAccessToken: (token: string) => void;
  logout:         () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user:         null,
      accessToken:  null,
      refreshToken: null,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),

      setAccessToken: (accessToken) =>
        set({ accessToken }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null }),

      isAuthenticated: () => !!get().accessToken && !!get().user,
    }),
    {
      name:    'skillforge-auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields — never store tokens in sessionStorage in real apps
      partialize: (state) => ({
        user:         state.user,
        accessToken:  state.accessToken,
        refreshToken: state.refreshToken,
      }),
    }
  )
);
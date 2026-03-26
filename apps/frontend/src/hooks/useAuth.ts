'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

export function useAuth() {
  const router = useRouter();
  const store  = useAuthStore();

  const register = useCallback(
    async (data: {
      orgName:  string;
      name:     string;
      email:    string;
      password: string;
    }) => {
      const res = await api.post('/auth/register', data);
      store.setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      return res.data;
    },
    []
  );

  const login = useCallback(
    async (data: { orgId: string; email: string; password: string }) => {
      const res = await api.post('/auth/login', data);
      store.setAuth(res.data.user, res.data.accessToken, res.data.refreshToken);
      return res.data;
    },
    []
  );

  const logout = useCallback(() => {
    store.logout();
    router.push('/login');
    toast.success('Signed out');
  }, []);

  return {
    user:            store.user,
    isAuthenticated: store.isAuthenticated(),
    register,
    login,
    logout,
  };
}
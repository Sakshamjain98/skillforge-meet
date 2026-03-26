'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Video } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuth();
  const [form, setForm]       = useState({ orgId: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) router.replace('/dashboard');
  }, [isAuthenticated]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.orgId || !form.email || !form.password) {
      toast.error('All fields are required');
      return;
    }
    setLoading(true);
    try {
      await login(form);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed — check your credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/25">
            <Video size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">SkillForge Meet</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to your organization</p>
        </div>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 rounded-2xl border border-gray-800 p-8 space-y-5"
        >
          <Field
            label="Organization ID"
            value={form.orgId}
            onChange={set('orgId')}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            hint="Provided when your organization was created"
          />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={set('email')}
            placeholder="you@company.com"
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set('password')}
            placeholder="••••••••"
            autoComplete="current-password"
          />

          <Button type="submit" loading={loading} fullWidth size="lg">
            Sign in
          </Button>

          <p className="text-center text-gray-500 text-sm">
            No organization yet?{' '}
            <Link href="/register" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
              Create one free
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

// ── Reusable field ────────────────────────────────────────────────────────────
function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <div>
      <label className="block text-sm text-gray-300 font-medium mb-1.5">
        {label}
      </label>
      <input
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5
          text-white placeholder:text-gray-500 text-sm
          focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
          transition-colors"
        {...props}
      />
      {hint && <p className="text-gray-600 text-xs mt-1">{hint}</p>}
    </div>
  );
}
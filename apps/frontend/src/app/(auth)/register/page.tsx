'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Video, Copy, CheckCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const router      = useRouter();
  const { register } = useAuth();

  const [form, setForm]       = useState({ orgName: '', name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [orgId, setOrgId]     = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const data = await register(form);
      setOrgId(data.user.orgId);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const copyOrgId = async () => {
    if (!orgId) return;
    await navigator.clipboard.writeText(orgId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Success screen: show org ID ────────────────────────────────────────────
  if (orgId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCheck size={28} className="text-white" />
          </div>
          <h2 className="text-white text-2xl font-bold mb-2">Organization created!</h2>
          <p className="text-gray-400 text-sm mb-8">
            Save your Organization ID — you and your team will need it to sign in.
          </p>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Organization ID</p>
            <div className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3">
              <code className="text-indigo-400 font-mono text-sm flex-1 break-all">
                {orgId}
              </code>
              <button
                onClick={copyOrgId}
                className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              >
                {copied ? <CheckCheck size={16} className="text-green-400" /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-3">
              Share this with your team members when they register.
            </p>
          </div>

          <Button onClick={() => router.push('/dashboard')} fullWidth size="lg">
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── Registration form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">

        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/25">
            <Video size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create organization</h1>
          <p className="text-gray-400 text-sm mt-1">Set up your learning space</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-900 rounded-2xl border border-gray-800 p-8 space-y-5"
        >
          {[
            { key: 'orgName',  label: 'Organization name', placeholder: 'Acme Corp',         type: 'text' },
            { key: 'name',     label: 'Your name',          placeholder: 'Alice Smith',        type: 'text' },
            { key: 'email',    label: 'Email',              placeholder: 'you@company.com',    type: 'email', autoComplete: 'email' },
            { key: 'password', label: 'Password',           placeholder: 'Min. 8 characters',  type: 'password', autoComplete: 'new-password' },
          ].map(({ key, label, ...rest }) => (
            <div key={key}>
              <label className="block text-sm text-gray-300 font-medium mb-1.5">{label}</label>
              <input
                value={(form as any)[key]}
                onChange={set(key as any)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5
                  text-white placeholder:text-gray-500 text-sm
                  focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                  transition-colors"
                {...rest}
              />
            </div>
          ))}

          <Button type="submit" loading={loading} fullWidth size="lg">
            Create organization
          </Button>

          <p className="text-center text-gray-500 text-sm">
            Already have an account?{' '}
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
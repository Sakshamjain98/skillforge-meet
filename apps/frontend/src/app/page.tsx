import { redirect } from 'next/navigation';

// Root → redirect to /login
// (or /dashboard if user is already authenticated — handled client-side in login page)
export default function RootPage() {
  redirect('/login');
}
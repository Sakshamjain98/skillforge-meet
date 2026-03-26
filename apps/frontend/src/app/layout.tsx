import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';

const inter = Inter({
  subsets:  ['latin'],
  display:  'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title:       'SkillForge Meet',
  description: 'Live learning sessions — video, audio, chat',
  icons:       { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gray-950 text-white antialiased">
        {children}

        <Toaster
          position="top-right"
          gutter={8}
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1f2937',
              color:       '#f9fafb',
              border:      '1px solid #374151',
              borderRadius: '12px',
              fontSize:    '14px',
            },
            success: {
              iconTheme: { primary: '#6366f1', secondary: '#f9fafb' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#f9fafb' },
            },
          }}
        />
      </body>
    </html>
  );
}
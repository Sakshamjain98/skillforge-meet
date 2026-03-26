'use client';
import { useState, useRef, useEffect, FormEvent } from 'react';
import { X, Send } from 'lucide-react';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { useConferenceStore } from '@/store/conference.store';
import { useAuthStore } from '@/store/auth.store';

interface ChatPanelProps {
  onSend:  (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ onSend, onClose }: ChatPanelProps) {
  const messages   = useConferenceStore((s) => s.messages);
  const { user }   = useAuthStore();
  const [draft, setDraft]   = useState('');
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    try {
      onSend(text);
    } catch (err: any) {
      // onSend may be async but we still want to show failures
      console.error('[chat] send failed', err);
      // best-effort toast (importing toast here would add small dependency; keep console at minimum)
    }
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col w-80 min-w-[320px] h-full bg-gray-900 border-l border-gray-800 animate-slide-up">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <span className="text-white font-semibold">In-session chat</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800"
          aria-label="Close chat"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-700">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">No messages yet.</p>
            <p className="text-gray-600 text-xs mt-1">Say hello! 👋</p>
          </div>
        )}

        {messages.map((msg) => {
          const isOwn = msg.userId === user?.id;
          return (
            <div
              key={msg.id}
              className={clsx(
                'flex flex-col gap-1',
                isOwn ? 'items-end' : 'items-start'
              )}
            >
              {/* Name + time */}
              <div className="flex items-baseline gap-2 px-1">
                <span className="text-xs text-gray-400 font-medium">
                  {isOwn ? 'You' : msg.name}
                </span>
                <span className="text-[10px] text-gray-600">
                  {format(new Date(msg.timestamp), 'HH:mm')}
                </span>
              </div>

              {/* Bubble */}
              <div
                className={clsx(
                  'max-w-[220px] px-3 py-2 rounded-2xl text-sm break-words leading-relaxed',
                  isOwn
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-gray-800 text-gray-100 rounded-tl-sm'
                )}
              >
                {msg.text}
              </div>
            </div>
          );
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex-shrink-0 border-t border-gray-800 p-3"
      >
        <div className="flex items-end gap-2 bg-gray-800 rounded-2xl px-3 py-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message everyone…"
            maxLength={2000}
            rows={1}
            className={clsx(
              'flex-1 bg-transparent text-sm text-white placeholder:text-gray-500',
              'outline-none resize-none max-h-24 leading-relaxed pt-0.5'
            )}
            style={{ minHeight: '24px' }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex-shrink-0 text-indigo-400 hover:text-indigo-300 disabled:opacity-30 transition-colors pb-0.5"
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5 text-right">
          Enter to send · Shift+Enter for new line
        </p>
      </form>
    </div>
  );
}
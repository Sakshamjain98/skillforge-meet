'use client';
import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { useConferenceStore } from '@/store/conference.store';

/**
 * Manages the Socket.IO connection lifecycle.
 * Connects on mount, disconnects on unmount.
 * Returns the connected socket instance.
 */
export function useSocket(): Socket {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setConnected = useConferenceStore((s) => s.setConnected);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) return;

    const socket = connectSocket(accessToken);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
      setConnected(false);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      disconnectSocket();
      setConnected(false);
    };
  }, [accessToken]);

  return socketRef.current ?? getSocket();
}
import { create } from 'zustand';
import type { UIState } from '@/types/conference.types';

interface UIStore extends UIState {
  openChat:            () => void;
  closeChat:           () => void;
  toggleChat:          () => void;
  openParticipants:    () => void;
  closeParticipants:   () => void;
  toggleParticipants:  () => void;
  openDeviceSelector:  () => void;
  closeDeviceSelector: () => void;
  incrementUnread:     () => void;
  resetUnread:         () => void;
  closeSidePanels:     () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  showChat:           false,
  showParticipants:   false,
  showDeviceSelector: false,
  chatUnreadCount:    0,

  openChat:  () => set({ showChat: true,  showParticipants: false }),
  closeChat: () => set({ showChat: false }),
  toggleChat: () =>
    set((s) => ({
      showChat:         !s.showChat,
      showParticipants: false,
      chatUnreadCount:  0,
    })),

  openParticipants:  () => set({ showParticipants: true,  showChat: false }),
  closeParticipants: () => set({ showParticipants: false }),
  toggleParticipants: () =>
    set((s) => ({
      showParticipants: !s.showParticipants,
      showChat:         false,
    })),

  openDeviceSelector:  () => set({ showDeviceSelector: true }),
  closeDeviceSelector: () => set({ showDeviceSelector: false }),

  incrementUnread: () =>
    set((s) => ({ chatUnreadCount: s.chatUnreadCount + 1 })),
  resetUnread: () => set({ chatUnreadCount: 0 }),

  closeSidePanels: () =>
    set({ showChat: false, showParticipants: false }),
}));
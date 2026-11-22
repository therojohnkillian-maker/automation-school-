import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  offlineReady: boolean;
  needRefresh: boolean;
  online: boolean;
  installEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  update: () => void;
  install: () => Promise<void>;
  dismissUpdate: () => void;
}

let updateSW: (reload?: boolean) => Promise<void> = async () => {};

export const usePwa = create<PwaState>((set, get) => ({
  offlineReady: false,
  needRefresh: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  installEvent: null,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
  update: () => void updateSW(true),
  dismissUpdate: () => set({ needRefresh: false }),
  install: async () => {
    const e = get().installEvent;
    if (!e) return;
    await e.prompt();
    const choice = await e.userChoice;
    set({ installEvent: null, installed: choice.outcome === 'accepted' });
  },
}));

export function startPwa() {
  if ('serviceWorker' in navigator) {
    updateSW = registerSW({
      immediate: true,
      onOfflineReady: () => usePwa.setState({ offlineReady: true }),
      onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
      onRegisteredSW: (_url, reg) => {
        // A controlling, activated worker means the app is cached for offline use.
        if (reg?.active && navigator.serviceWorker.controller) usePwa.setState({ offlineReady: true });
      },
    });
  }
  window.addEventListener('online', () => usePwa.setState({ online: true }));
  window.addEventListener('offline', () => usePwa.setState({ online: false }));
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwa.setState({ installEvent: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ installed: true, installEvent: null }));
}

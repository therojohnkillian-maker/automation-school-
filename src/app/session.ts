import { create } from 'zustand';
import type { Profile } from '../data/db';

interface SessionState {
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
}

/** Who is using the app right now. Kept in memory only: on a shared device, everyone picks their profile after a restart. */
export const useSession = create<SessionState>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
}));

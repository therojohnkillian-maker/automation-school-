import { db, type Profile, type Role } from './db';
import { baseFields, nowIso } from './ids';
import { hashPin, isValidPin } from './pin';

export async function listProfiles(): Promise<Profile[]> {
  const all = await db.profiles.toArray();
  return all
    .filter((p) => !p.deleted)
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'trainer' ? -1 : 1));
}

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40);
}

export async function createProfile(input: { name: string; role: Role; pin?: string }): Promise<Profile> {
  const name = cleanName(input.name);
  if (!name) throw new Error('Enter a name.');
  const existing = await listProfiles();
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(`There is already a profile called "${name}".`);
  }
  const base = await baseFields('');
  const profile: Profile = { ...base, profileId: base.id, name, role: input.role };
  if (input.pin) {
    if (!isValidPin(input.pin)) throw new Error('A PIN must be 4 to 8 digits.');
    Object.assign(profile, await hashPin(input.pin));
  }
  await db.profiles.add(profile);
  return profile;
}

export async function updateProfile(id: string, changes: { name?: string; pin?: string | null }) {
  const p = await db.profiles.get(id);
  if (!p) throw new Error('Profile not found.');
  const next: Profile = { ...p, updatedAt: nowIso() };
  if (changes.name !== undefined) {
    const name = cleanName(changes.name);
    if (!name) throw new Error('Enter a name.');
    const others = (await listProfiles()).filter((o) => o.id !== id);
    if (others.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There is already a profile called "${name}".`);
    }
    next.name = name;
  }
  if (changes.pin === null) {
    delete next.pinHash;
    delete next.pinSalt;
  } else if (changes.pin !== undefined) {
    if (!isValidPin(changes.pin)) throw new Error('A PIN must be 4 to 8 digits.');
    Object.assign(next, await hashPin(changes.pin));
  }
  await db.profiles.put(next);
  return next;
}

/** Soft delete so an older progress import cannot bring the person back by accident. */
export async function removeProfile(id: string) {
  const p = await db.profiles.get(id);
  if (!p) return;
  if (p.role === 'trainer') {
    const trainers = (await listProfiles()).filter((t) => t.role === 'trainer');
    if (trainers.length <= 1) throw new Error('You cannot remove the only trainer.');
  }
  await db.profiles.put({ ...p, deleted: true, updatedAt: nowIso() });
}

import { getSupabaseClient } from '@/backend/supabaseClient';

export const EMAIL_CONFIRMATION_REDIRECT = 'safemelink://email-confirmed';
export type EmailConfirmationResult = 'verified' | 'invalid' | 'unavailable' | 'login_required';

// Never persist URL tokens or replace an existing account session from a callback.
export async function verifyEmailConfirmation(url: string | null): Promise<EmailConfirmationResult> {
  if (!url) return 'login_required';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'safemelink:' || parsed.hostname !== 'email-confirmed' || (parsed.pathname && parsed.pathname !== '/')) return 'invalid';
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    if (parsed.searchParams.has('error') || fragment.has('error') || parsed.searchParams.has('error_code') || fragment.has('error_code')) return 'invalid';
    const token = fragment.get('access_token');
    if (!token) return 'login_required';
    const client = getSupabaseClient();
    if (!client) return 'unavailable';
    const { data, error } = await Promise.race([
      client.auth.getUser(token),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 10_000); }),
    ]);
    if (error) return 'unavailable';
    return data.user?.email_confirmed_at ? 'verified' : 'invalid';
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from './supabase';

export async function sendLocalMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!host || !from) return { ok: false, error: 'SMTP is not configured.' };
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'SMTP configuration is invalid.' };
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const sb = supabaseAdmin();
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || '');
    if (origin.protocol !== 'https:') throw new Error('HTTPS required');
    const link = new URL('/auth/callback', origin);
    link.searchParams.set('token_hash', token);
    const { error } = await sb.from('self_host_login_tokens').insert({
      email, token_hash: hash, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    if (error) throw new Error('Token persistence failed');
    const mail = nodemailer.createTransport({
      host, port, secure: port === 465,
      requireTLS: process.env.SMTP_ALLOW_INSECURE !== 'true',
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
      connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 10_000,
    });
    await mail.sendMail({ from, to: email, subject: 'Sign in to The Broadside', text: `Sign in using this link within 15 minutes:\n\n${link}\n\nIf you did not request this, ignore this email.` });
    return { ok: true };
  } catch {
    await sb.from('self_host_login_tokens').delete().eq('token_hash', hash);
    return { ok: false, error: 'Sign-in email could not be sent.' };
  }
}

export async function verifyLocalMagicLink(token: string): Promise<{ id: string; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await supabaseAdmin().rpc('consume_self_host_login', {
    p_hash: createHash('sha256').update(token).digest('hex'),
  });
  return !error && data?.id && typeof data.email === 'string' ? data : null;
}

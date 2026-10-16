import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { error } = await supabaseAdmin().from('streams').select('id').limit(1);
    return NextResponse.json({ ok: !error }, { status: error ? 503 : 200 });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}

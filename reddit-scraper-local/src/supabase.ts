import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const supabase: SupabaseClient | null = 
  process.env['SUPABASE_URL'] && process.env['SUPABASE_SERVICE_ROLE_KEY']
    ? createClient(
        process.env['SUPABASE_URL'],
        process.env['SUPABASE_SERVICE_ROLE_KEY']
      )
    : null;

export const isDbEnabled = Boolean(supabase);

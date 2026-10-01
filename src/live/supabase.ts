import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isConfigured } from './config';

export const supabase: SupabaseClient | null = isConfigured()
  ? createClient(config.supabaseUrl!, config.supabaseAnonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

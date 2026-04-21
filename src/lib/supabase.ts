import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://vnuvmbnlxhhhbfpiwzef.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZudXZtYm5seGhoaGJmcGl3emVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNzUzNDIsImV4cCI6MjA4Nzc1MTM0Mn0.jnImxezvHLiRCdUkgBLgQ97uW-9FHpfcgL3ipvOLpas';

export const supabase = createClient(supabaseUrl, supabaseKey);

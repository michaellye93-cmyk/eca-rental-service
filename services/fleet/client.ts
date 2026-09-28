import { supabase } from '../../supabaseClient';
import { fleetApi } from './api.ts';

/** The Fleet page's data access, through the app's signed-in Supabase client. */
export const fleet = fleetApi(supabase);

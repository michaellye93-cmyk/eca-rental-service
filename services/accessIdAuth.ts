import { supabase } from "../supabaseClient";

type AccessIdLoginResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
};

function functionErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("context" in error)) return undefined;
  const context = (error as { context?: unknown }).context;
  return context instanceof Response ? context.status : undefined;
}

function loginFailure(error: unknown): Error {
  const status = functionErrorStatus(error);
  if (status === 429) {
    return new Error("Too many sign-in attempts. Please wait before trying again.");
  }
  if (status === 400 || status === 401 || status === 403) {
    return new Error("That Access ID is not valid.");
  }
  return new Error("The Access ID login service is unavailable. Please try again.");
}

export async function signInWithAccessId(accessId: string): Promise<void> {
  const normalizedAccessId = accessId.trim();
  if (!normalizedAccessId) throw new Error("Enter your Access ID.");

  const { data, error } = await supabase.functions.invoke<AccessIdLoginResponse>(
    "access-id-login",
    { body: { access_id: normalizedAccessId } },
  );
  if (error) throw loginFailure(error);

  const accessToken = data?.access_token;
  const refreshToken = data?.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new Error("That Access ID is not valid.");
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (sessionError) {
    throw new Error("Unable to start a secure session. Please try again.");
  }
}

export type AccessAccount = { access_id_sha256: string; user_id: string; role: 'admin' | 'staff' };
export type AccountIdentity = { id: string; email?: string; role: string; is_anonymous?: boolean; banned_until?: string | null; deleted_at?: string | null };
type LoginDependencies = {
  accounts: AccessAccount[];
  callerBucket: string;
  consumeAttempt: (bucket: string) => Promise<boolean>;
  getAccount: (userId: string) => Promise<AccountIdentity | null>;
  createSession: (account: AccountIdentity) => Promise<{ user_id: string; access_token: string; refresh_token: string }>;
};
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
export function parseAccounts(value: string): AccessAccount[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 20) throw new Error('Access accounts unavailable');
  const hashes = new Set<string>();
  for (const account of parsed) {
    if (!account || !/^[a-f0-9]{64}$/.test(account.access_id_sha256) || !/^[a-f0-9-]{36}$/.test(account.user_id) || !['admin','staff'].includes(account.role) || hashes.has(account.access_id_sha256)) throw new Error('Access accounts unavailable');
    hashes.add(account.access_id_sha256);
  }
  return parsed;
}
export async function hashAccessId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
}
function equalHashes(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let index=0; index<64; index++) difference |= (left.charCodeAt(index)||0) ^ (right.charCodeAt(index)||0);
  return difference===0;
}
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing input');
  let size=0;
  const chunks: Uint8Array[]=[];
  while (true) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if(size>1024) {await reader.cancel();throw new Error('Input too large');}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleAccessIdLogin(request: Request, deps: LoginDependencies): Promise<Response> {
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return respond({error:'POST required'},405);
  let accessId: string;
  try {
    const body=await readBody(request) as {access_id?:unknown}|null;
    if(typeof body?.access_id!=='string'||!body.access_id.trim()||body.access_id.length>128)throw new Error('Invalid input');
    accessId=body.access_id.trim();
  }catch{return respond({error:'Enter a valid Access ID.'},400);}
  try {
    if(!await deps.consumeAttempt(deps.callerBucket))return respond({error:'Too many login attempts. Try again in a minute.'},429);
    const digest=await hashAccessId(accessId);
    const configured=deps.accounts.find(account=>equalHashes(account.access_id_sha256,digest));
    if(!configured)return respond({error:'Invalid Access ID.'},401);
    if(!await deps.consumeAttempt(`account:${configured.user_id}`))return respond({error:'Too many login attempts. Try again in a minute.'},429);
    const account=await deps.getAccount(configured.user_id);
    if(!account||account.id!==configured.user_id||account.role!==configured.role||!account.email||account.is_anonymous||account.deleted_at||(account.banned_until&&new Date(account.banned_until).getTime()>Date.now()))return respond({error:'Invalid Access ID.'},401);
    const session=await deps.createSession(account);
    if(session.user_id!==configured.user_id||!session.access_token||!session.refresh_token)throw new Error('Session identity mismatch');
    return respond({access_token:session.access_token,refresh_token:session.refresh_token});
  }catch{return respond({error:'Unable to sign in right now. Please try again.'},503);}
}

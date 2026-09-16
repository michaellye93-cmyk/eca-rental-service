import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { handleAccessIdLogin, parseAccounts, hashAccessId } from './handler.ts';

Deno.serve(async request => {
  try {
    const url=Deno.env.get('SUPABASE_URL')??'';
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
    const publicKey=Deno.env.get('SUPABASE_ANON_KEY')??'';
    if(!url||!serviceKey||!publicKey)throw new Error('Unavailable server configuration');
    const accounts=parseAccounts(Deno.env.get('ACCESS_ID_ACCOUNTS')??'');
    // Hosted Supabase supplies the client address. Never accept a caller ID from
    // the body. Missing gateway metadata shares a restrictive fallback budget.
    const clientAddress=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim().toLowerCase()||'unknown';
    const callerBucket=`client:${await hashAccessId(clientAddress)}`;
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    return await handleAccessIdLogin(request,{
      accounts,callerBucket,
      consumeAttempt:async bucket=>{
        const {data,error}=await admin.rpc('access_id_login_attempt',{p_bucket:bucket});
        if(error)throw error;
        return data===true;
      },
      getAccount:async id=>{
        const [{data:auth,error:authError},{data:profile,error:profileError}]=await Promise.all([
          admin.auth.admin.getUserById(id),admin.from('profiles').select('id,role').eq('id',id).single(),
        ]);
        if(authError||profileError||!auth.user||!profile)return null;
        return {...auth.user,role:profile.role};
      },
      createSession:async account=>{
        // Generate a one-time token locally; this method sends no email.
        const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:account.email!});
        if(linkError||link.user?.id!==account.id||!link.properties?.hashed_token)throw new Error('Could not issue session');
        const verifier=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
        const {data,error}=await verifier.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'email'});
        if(error||!data.session||data.user?.id!==account.id){
          if(data.session)await verifier.auth.signOut({scope:'local'});
          throw new Error('Could not issue session');
        }
        return {user_id:data.user.id,access_token:data.session.access_token,refresh_token:data.session.refresh_token};
      },
    });
  }catch{
    return new Response(JSON.stringify({error:'Unable to sign in right now. Please try again.'}),{
      status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},
    });
  }
});

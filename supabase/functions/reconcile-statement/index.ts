import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      throw new Error("No file uploaded");
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64File = encodeBase64(new Uint8Array(arrayBuffer));
    const mimeType = file.type;

    console.log(`Processing file: size=${arrayBuffer.byteLength}, mime=${mimeType}`);

    // Use Gemini 3.0 Flash model (or fallback to latest stable 1.5 flash if 3.0 not universally routed yet)
    // using the HTTP POST API.
    const modelName = "gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Read the following bank statement visually. Return ONLY a structured JSON array of transactions. Each object MUST contain: trans_date (converted to YYYY-MM-DD), amount (numeric float), sender_name, and reference (a combined string of all reference metadata/info). Only output raw JSON, no markdown blocks.",
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64File,
                },
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
        }
      }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error("Gemini API Error: " + err);
    }

    const aiData = await response.json();
    const resultText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!resultText) {
        throw new Error("Failed to parse Gemini response");
    }

    const batchTransactions = JSON.parse(resultText);

    // Initialise Supabase Service Role Client to execute the RPC
    const supabaseAdmin = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY!
    );

    // Call Reconcile RPC
    const { data: reconciliationResult, error: rpcError } = await supabaseAdmin
      .rpc("reconcile_bank_statement", {
        batch_transactions: batchTransactions,
      });

    if (rpcError) {
      throw rpcError;
    }

    return new Response(JSON.stringify(reconciliationResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

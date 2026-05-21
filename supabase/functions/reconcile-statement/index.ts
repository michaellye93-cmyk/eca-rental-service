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
    const contentType = req.headers.get("content-type") || "";

    let batchTransactions: any = null;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      batchTransactions = body.transactions;
      if (!batchTransactions) {
        throw new Error("Missing 'transactions' in JSON body");
      }
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File;

      if (!file) {
        throw new Error("No file uploaded");
      }

      if (file.type === "application/json" || file.name.endsWith(".json")) {
          const text = await file.text();
          batchTransactions = JSON.parse(text);
          if (batchTransactions.transactions && Array.isArray(batchTransactions.transactions)) {
              batchTransactions = batchTransactions.transactions;
          } else if (!Array.isArray(batchTransactions)) {
              throw new Error("JSON file must contain an array of transactions");
          }
      } else {
          const arrayBuffer = await file.arrayBuffer();
          const base64File = encodeBase64(new Uint8Array(arrayBuffer));
          const mimeType = file.type;

          console.log(`Processing file: size=${arrayBuffer.byteLength}, mime=${mimeType}`);

          // Use Gemini 3.0 Flash model (or fallback to latest stable 1.5 flash if 3.0 not universally routed yet)
          // using the HTTP POST API.
          const modelName = "gemini-3.1-pro-preview";
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;

          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: "Read the following bank statement visually. Return ONLY a structured JSON array of transactions. VERY IMPORTANT: You must extract EVERY SINGLE transaction line item present in the document. Do not summarize or skip any rows. Process the entire table until the very end. Each object MUST contain: trans_date (converted to YYYY-MM-DD for processing), display_date (DD-MM-YYYY EXACTLY as shown in image), branch_description, sender_name, reference_1, reference_2, ref_num, amount_dr (numeric float or null), amount_cr (numeric float or null), balance (numeric float), amount (numeric float representing the absolute value of CR or DR), and reference (a combined string of reference_1 + reference_2 if available). Only output raw JSON array, no markdown blocks.",
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

          batchTransactions = JSON.parse(resultText);
      }
    }

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

    if (reconciliationResult) {
        // Merge original extra properties back into the response
        // because the RPC might strip out fields it doesn't know about
        const paired = [];
        const unpaired = [];

        // Simple match back strategy using date+amount+reference
        const getOriginal = (tx: any) => {
             return batchTransactions.find((btx: any) => 
                 btx.trans_date === tx.trans_date && 
                 Number(btx.amount) === Number(tx.amount) &&
                 btx.reference === tx.reference
             ) || {};
        };

        if (Array.isArray(reconciliationResult.paired_transactions)) {
            reconciliationResult.paired_transactions = reconciliationResult.paired_transactions.map((tx: any) => ({
                ...getOriginal(tx),
                ...tx
            }));
        }
        if (Array.isArray(reconciliationResult.unpaired_transactions)) {
            reconciliationResult.unpaired_transactions = reconciliationResult.unpaired_transactions.map((tx: any) => ({
                ...getOriginal(tx),
                ...tx
            }));
        }
        if (!Array.isArray(reconciliationResult.unsolved_system_transactions)) {
             reconciliationResult.unsolved_system_transactions = [];
        }
    }

    return new Response(JSON.stringify(reconciliationResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    const errorMsg = error?.message || (typeof error === 'string' ? error : "Unknown error");
    return new Response(JSON.stringify({ error: errorMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

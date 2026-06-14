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

    let summary: any = null;

    if (contentType.includes("application/json")) {
      const body = await req.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
          batchTransactions = body.transactions;
          if (body.summary) {
              summary = body.summary;
          }
      } else {
          batchTransactions = body;
      }
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
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              batchTransactions = parsed.transactions;
              if (parsed.summary) {
                  summary = parsed.summary;
              }
          } else {
              batchTransactions = parsed;
          }
          if (batchTransactions && batchTransactions.transactions && Array.isArray(batchTransactions.transactions)) {
              batchTransactions = batchTransactions.transactions;
          } else if (!Array.isArray(batchTransactions)) {
              throw new Error("JSON file must contain an array of transactions or transactions field");
          }
      } else {
          const arrayBuffer = await file.arrayBuffer();
          const base64File = encodeBase64(new Uint8Array(arrayBuffer));
          const mimeType = file.type;

          console.log(`Processing file: size=${arrayBuffer.byteLength}, mime=${mimeType}`);

          // Use Gemini 3.1 Pro model (or latest preview) to read visual statement
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
                      text: "Read the following bank statement visually. Return a JSON object containing two main keys: 'summary' and 'transactions'. Under 'summary', locate and extract: 'beginning_balance' (numeric float, the Beginning Balance of the statement as of start date), 'total_deposits_amount' (numeric float, the total amount of Deposits/Credits/Plus), 'total_deposits_count' (numeric integer, the total count of Deposits/Credits/Plus), 'total_withdrawals_amount' (numeric float, the total amount of Withdrawals/Debits/Minus), 'total_withdrawals_count' (numeric integer, the total count of Withdrawals/Debits/Minus), and 'ending_balance' (numeric float, the Ending Balance of the statement as of end date). Under 'transactions', return ONLY a structured JSON array of DEPOSIT (incoming money / Credit / CR) transactions. VERY IMPORTANT: Do NOT extract, process, or include any DR / Debit / Withdrawal / money-out transactions in this 'transactions' array. Completely ignore and skip all rows that represent money leaving the account. For each and every DEPOSIT / CREDIT transaction, you must extract: trans_date (converted to YYYY-MM-DD for processing), display_date (DD-MM-YYYY EXACTLY as shown in image), branch_description, sender_name, reference_1, reference_2, ref_num, amount_dr (always null since we ignore withdrawals), amount_cr (numeric float representing the deposit/credit amount), balance (numeric float representing the running balance on that row), amount (numeric float representing the deposit/credit amount), and reference (a combined string of reference_1 + reference_2 if available). Make sure to capture every single deposit/credit without skipping any. Only output raw JSON object, no markdown blocks.",
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

          const parsed = JSON.parse(resultText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              if (parsed.transactions && Array.isArray(parsed.transactions)) {
                  batchTransactions = parsed.transactions;
              } else {
                  batchTransactions = [];
              }
              if (parsed.summary) {
                  summary = parsed.summary;
              }
          } else if (Array.isArray(parsed)) {
              batchTransactions = parsed;
          }
      }
    }

    let deposits: any[] = [];
    let withdrawals: any[] = [];

    // Strict Filter: Ensure only actual Credit/Deposit transactions are processed
    if (Array.isArray(batchTransactions)) {
        const normalizedList = batchTransactions.map((rawTx: any, index: number) => {
            if (!rawTx || typeof rawTx !== 'object') return null;

            // Deep clone / copy to avoid mutations
            const tx = { ...rawTx };

            // Helper to find a value by case-insensitive key patterns representing columns
            const getValueByPatterns = (obj: any, patterns: RegExp[]): any => {
                const keys = Object.keys(obj);
                for (const pattern of patterns) {
                    const matchedKey = keys.find(k => pattern.test(k));
                    if (matchedKey !== undefined) {
                        return obj[matchedKey];
                    }
                }
                return undefined;
            };

            // 1. Normalize Date
            if (tx.trans_date === undefined) {
                const dateVal = getValueByPatterns(tx, [/trans.*date/i, /display.*date/i, /^date$/i, /tx.*date/i, /transaction.*date/i]);
                if (dateVal !== undefined) {
                    tx.trans_date = String(dateVal);
                }
            }
            
            // Normalize trans_date to YYYY-MM-DD for PostgreSQL and keep original in display_date
            if (tx.trans_date) {
                const dStr = String(tx.trans_date).trim();
                const dmyMatch = dStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
                if (dmyMatch) {
                    tx.trans_date = `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
                    if (!tx.display_date) {
                        tx.display_date = dStr;
                    }
                } else if (!tx.display_date) {
                    tx.display_date = dStr;
                }
            }

            // 2. Normalize Sender Name
            const isValidStr = (v: any): boolean => {
                if (v === undefined || v === null) return false;
                const s = String(v).trim();
                if (s === '' || s === '-' || s === '/' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'none') {
                    return false;
                }
                return true;
            };

            const isSenderBlank = !isValidStr(tx.sender_name);
            
            if (isSenderBlank) {
                let resolvedSender = "";

                // Check explicit variations
                if (isValidStr(tx.senderName)) resolvedSender = String(tx.senderName).trim();
                else if (isValidStr(tx.sender)) resolvedSender = String(tx.sender).trim();
                else {
                    const keys = Object.keys(tx);
                    const specificPatterns = [
                        /sender/i,
                        /beneficiary/i,
                        /customer/i,
                        /payer/i,
                        /remitter/i,
                        /payee/i,
                        /recipient/i,
                        /party/i,
                        /from/i,
                        /applicant/i,
                        /client/i,
                        /depositor/i,
                        /originator/i,
                        /name/i
                    ];

                    outerLoop: for (const pattern of specificPatterns) {
                        const matchedKeys = keys.filter(k => 
                            pattern.test(k) && 
                            !/date/i.test(k) && 
                            !/amount/i.test(k) && 
                            !/credit/i.test(k) && 
                            !/debit/i.test(k) && 
                            !/balance/i.test(k) && 
                            !/reference/i.test(k) && 
                            !/index/i.test(k) && 
                            !/status/i.test(k) && 
                            !/plate/i.test(k) &&
                            !/driver/i.test(k) &&
                            !/match/i.test(k)
                        );

                        for (const matchedKey of matchedKeys) {
                            const val = tx[matchedKey];
                            if (val !== undefined && val !== null) {
                                if (typeof val === 'object') {
                                    const innerKeys = Object.keys(val);
                                    const nameKey = innerKeys.find(ik => /name/i.test(ik) && isValidStr(val[ik]));
                                    if (nameKey) {
                                        resolvedSender = String(val[nameKey]).trim();
                                        break outerLoop;
                                    }
                                    const secondaryKey = innerKeys.find(ik => isValidStr(val[ik]));
                                    if (secondaryKey) {
                                        resolvedSender = String(val[secondaryKey]).trim();
                                        break outerLoop;
                                    }
                                } else if (isValidStr(val)) {
                                    resolvedSender = String(val).trim();
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    if (!resolvedSender) {
                        const blocklistKeys = [
                            'trans_date', 'display_date', 'date', 'amount', 'amount_cr', 'amount_dr', 
                            'balance', 'reference', 'reference_1', 'reference_2', 'ref_num', 'status', 
                            'original_index', 'plate_number', 'matched_by', 'driver_id', 'is_deposit',
                            'matched_driver_name', 'branch_description'
                        ];
                        for (const key of keys) {
                            if (!blocklistKeys.includes(key) && isValidStr(tx[key]) && typeof tx[key] === 'string') {
                                resolvedSender = String(tx[key]).trim();
                                break;
                            }
                        }
                    }
                }

                if (resolvedSender) {
                    tx.sender_name = resolvedSender;
                }
            }

            // 3. Normalize Reference 1
            if (tx.reference_1 === undefined) {
                const ref1Val = getValueByPatterns(tx, [/ref.*1/i, /recipient.*ref/i, /^reference$/i, /^ref$/i]);
                if (ref1Val !== undefined) {
                    tx.reference_1 = String(ref1Val);
                    tx.reference = String(ref1Val);
                }
            }

            // 4. Normalize Reference 2
            if (tx.reference_2 === undefined) {
                const ref2Val = getValueByPatterns(tx, [/ref.*2/i, /other.*payment/i, /payment.*detail/i, /description/i, /desc/i]);
                if (ref2Val !== undefined) {
                    tx.reference_2 = String(ref2Val);
                    if (!tx.reference) {
                        tx.reference = tx.reference_2;
                    } else if (tx.reference && tx.reference !== tx.reference_2) {
                        tx.reference = tx.reference + " " + tx.reference_2;
                    }
                }
            }

            // 5. Normalize Ref Num
            if (tx.ref_num === undefined) {
                const refNumVal = getValueByPatterns(tx, [/ref.*num/i, /reference.*num/i, /transaction.*id/i, /^refnum$/i]);
                if (refNumVal !== undefined) {
                    tx.ref_num = String(refNumVal);
                }
            }

            // 6. Normalize Branch Description
            if (tx.branch_description === undefined) {
                const branchVal = getValueByPatterns(tx, [/branch/i, /location/i]);
                if (branchVal !== undefined) {
                    tx.branch_description = String(branchVal);
                }
            }

            const parseNum = (val: any): number => {
                if (val === undefined || val === null || val === "") return 0;
                const str = String(val).replace(/[^0-9.-]/g, "").trim();
                const num = Number(str);
                return isNaN(num) ? 0 : num;
            };

            let cr = 0;
            let dr = 0;
            let amt = 0;
            
            let hasExplicitCrKey = false;
            let isExplicitCrEmpty = false;

            // Check deposit/credit keys
            const crKeys = ["amount_cr", "amountCr", "credit", "credit_amount", "creditAmount", "deposit", "deposit_amount", "depositAmount", "cr_amount", "cr", "plus", "received", "Amount (CR)", "deposit account summary"];
            for (const key of crKeys) {
                if (tx[key] !== undefined && tx[key] !== null) {
                    hasExplicitCrKey = true;
                    const strVal = String(tx[key]).trim();
                    if (strVal === "-" || strVal === "" || strVal.toLowerCase() === "null") {
                        isExplicitCrEmpty = true;
                    }
                    const val = parseNum(tx[key]);
                    if (val > 0) {
                        cr = val;
                        isExplicitCrEmpty = false;
                        break;
                    }
                }
            }
            if (cr === 0) {
                const crVal = getValueByPatterns(tx, [/amount.*cr/i, /credit/i, /deposit/i, /received/i]);
                if (crVal !== undefined) {
                    hasExplicitCrKey = true;
                    const strVal = String(crVal).trim();
                    if (strVal === "-" || strVal === "" || strVal.toLowerCase() === "null") {
                        isExplicitCrEmpty = true;
                    }
                    cr = parseNum(crVal);
                    if (cr > 0) {
                         isExplicitCrEmpty = false;
                    }
                }
            }

            // Check debit/withdrawal keys
            const drKeys = ["amount_dr", "amountDr", "debit", "debit_amount", "debitAmount", "withdrawal", "withdrawal_amount", "withdrawalAmount", "dr_amount", "dr", "minus", "paid", "spent", "Amount (DR)"];
            for (const key of drKeys) {
                if (tx[key] !== undefined && tx[key] !== null) {
                    const val = parseNum(tx[key]);
                    if (val > 0) {
                        // Ignore boolean or non-numeric status strings for paid/spent
                        if ((key === "paid" || key === "spent") && isNaN(Number(String(tx[key]).trim()))) {
                            continue;
                        }
                        dr = val;
                        break;
                    }
                }
            }
            if (dr === 0) {
                const drVal = getValueByPatterns(tx, [/amount.*dr/i, /debit/i, /withdrawal/i, /spent/i, /paid/i]);
                if (drVal !== undefined) {
                    dr = parseNum(drVal);
                }
            }

            // Check generic amount
            const amtKeys = ["amount", "amount_value", "value", "amt", "transaction_amount", "tx_amount", "Amount"];
            for (const key of amtKeys) {
                if (tx[key] !== undefined && tx[key] !== null) {
                    const val = parseNum(tx[key]);
                    if (val !== 0) {
                        amt = val;
                        break;
                    }
                }
            }
            if (amt === 0) {
                const amtVal = getValueByPatterns(tx, [/^amount$/i, /tx.*amount/i, /value/i]);
                if (amtVal !== undefined) {
                    amt = parseNum(amtVal);
                }
            }

            // Check generic type indicators
            let typeStr = "";
            const typeKeys = ["type", "trsType", "transaction_type", "tx_type", "trans_type", "dr_cr", "drCr", "cr_dr", "crDr", "indicator", "direction", "status", "action"];
            for (const key of typeKeys) {
                if (tx[key] !== undefined && tx[key] !== null) {
                    typeStr = String(tx[key]).toUpperCase().trim();
                    break;
                }
            }
            if (!typeStr) {
                const typeVal = getValueByPatterns(tx, [/type/i, /direction/i, /dr.*cr/i, /cr.*dr/i]);
                if (typeVal !== undefined) {
                    typeStr = String(typeVal).toUpperCase().trim();
                }
            }

            // If amount is explicitly negative, it is a withdrawal
            if (amt < 0) {
                dr = Math.abs(amt);
                amt = dr;
            }

            // Determine if it is a deposit (credit)
            let isDeposit = false;
            
            if (hasExplicitCrKey && isExplicitCrEmpty) {
                isDeposit = false;
            } else if (cr > 0 && dr === 0) {
                isDeposit = true;
            } else if (dr > 0 && cr === 0) {
                isDeposit = false;
            } else if (["CR", "CREDIT", "DEPOSIT", "IN", "PLUS", "PAYMENT_IN", "INWARD", "C", "RECEIVE", "RECEIVED"].includes(typeStr)) {
                isDeposit = true;
            } else if (["DR", "DEBIT", "WITHDRAWAL", "WITHDRAW", "OUT", "MINUS", "CHARGE", "FEE", "PAYMENT_OUT", "OUTWARD", "D", "SPEND", "SPENT"].includes(typeStr)) {
                isDeposit = false;
            } else {
                const desc = (tx.branch_description || tx.description || "").toUpperCase();
                const ref = (tx.reference || tx.reference_1 || tx.reference_2 || "").toUpperCase();
                const combinedText = ` ${desc} ${ref} `;

                // Strict word-boundary matching to prevent single character/substring false positives
                const hasDebitWord = /\b(DR|DEBIT|WITHDRAWAL|WITHDRAW|OUT|MINUS|CHARGE|CHG|FEE|PAY_OUT|PAYMENT_OUT|OUTWARD|SPEND|SPENT)\b/.test(combinedText);
                const hasDepositWord = /\b(CR|CREDIT|DEPOSIT|IN|PLUS|PAY_IN|PAYMENT_IN|INWARD|RECEIVE|RECEIVED|CDM|DIRECT DEPOSIT|CASH DEPOSIT|TRF)\b/.test(combinedText) || 
                                       combinedText.includes("RPP INWARD") || 
                                       combinedText.includes("TRF FROM") ||
                                       combinedText.includes("DIRECT DEPOSIT") ||
                                       combinedText.includes("CASH DEPOSIT");

                if (hasDebitWord && !hasDepositWord) {
                    isDeposit = false;
                } else if (hasDepositWord && !hasDebitWord) {
                    isDeposit = true;
                } else {
                    isDeposit = true; // Default to deposit if positive amount and no explicit debit markers
                }
            }

            const finalAmt = amt || cr || dr || 0;

            return {
                ...tx,
                amount_cr: isDeposit ? (cr || finalAmt) : null,
                amount_dr: !isDeposit ? (dr || finalAmt) : null,
                amount: finalAmt,
                is_deposit: isDeposit,
                original_index: index
            };
        });

        const validList = normalizedList.filter((tx: any) => tx !== null && tx.amount > 0);
        deposits = validList.filter((tx: any) => tx.is_deposit === true);
        withdrawals = validList.filter((tx: any) => tx.is_deposit === false);

        batchTransactions = deposits;
    }

    // Initialise Supabase Service Role Client to execute the RPC
    const supabaseAdmin = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch all drivers and payments for Javascript based matching 
    const { data: driversData, error: driversError } = await supabaseAdmin
      .from('drivers')
      .select('id, name, car_plate, is_delisted, paymentHistory:payments(id, amount, date, payment_method)');

    if (driversError) {
      throw driversError;
    }

    const paired: any[] = [];
    const unpaired: any[] = [];
    const unsolved: any[] = [];
    const allSystemPayments: any[] = [];

    // Flatten all system payments
    for (const d of (driversData || [])) {
         for (const pt of (d.paymentHistory || [])) {
             allSystemPayments.push({
                 id: pt.id || Math.random().toString(),
                 amount: pt.amount,
                 trans_date: pt.date,
                 driver_name: d.name,
                 plate_number: d.car_plate,
                 p_method: pt.payment_method || 'BANK TRANSFER',
                 driver_id: d.id,
                 isMatched: false
             });
         }
    }

    // Two-pass matching to ensure Plate matches are NEVER stolen by eager Name matches.
    batchTransactions.forEach((bankTx: any) => {
        bankTx.isMatched = false;
    });

    // Pass 1: Plate Matches Only (Score >= 100)
    batchTransactions.forEach((bankTx: any) => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             if (Number(sysPay.amount) === Number(bankTx.amount)) {
                 const sysDateObj = new Date(new Date(sysPay.trans_date).getTime() + (8 * 3600 * 1000));
                 const sysDateLocal = sysDateObj.toISOString().split('T')[0];
                 if (sysDateLocal === bankTx.trans_date) {
                     let sysPlate = String(sysPay.plate_number).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                     let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                  String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                  String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                     let isPlateMatch = sysPlate.length > 3 && rawRef.includes(sysPlate);
                     let score = isPlateMatch ? 100 : 0;
                     if (score >= 100 && score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ ...bankTx, status: 'MATCHED', plate_number: bestSysPay.plate_number, driver_id: bestSysPay.driver_id, matched_driver_name: bestSysPay.driver_name });
        }
    });

    // Pass 2: Name & Cash Deposit Matches (Score >= 10)
    batchTransactions.forEach((bankTx: any) => {
        if (bankTx.isMatched) return;
        let bestMatchIndex = -1;
        let bestScore = -1;
        
        for (let i = 0; i < allSystemPayments.length; i++) {
             const sysPay = allSystemPayments[i];
             if (sysPay.isMatched) continue;
             
             if (Number(sysPay.amount) === Number(bankTx.amount)) {
                 const sysDateObj = new Date(new Date(sysPay.trans_date).getTime() + (8 * 3600 * 1000));
                 const sysDateLocal = sysDateObj.toISOString().split('T')[0];
                 if (sysDateLocal === bankTx.trans_date) {
                     let sysName = String(sysPay.driver_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                     let rawSender = String(bankTx.sender_name).toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                     let rawRef = String(bankTx.reference || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                  String(bankTx.reference_1 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '') + 
                                  String(bankTx.reference_2 || '').toUpperCase().replace(/-/g, '').replace(/\s+/g, '');
                     
                     let isNameMatch = sysName.length > 3 && (rawSender.includes(sysName) || sysName.includes(rawSender));
                     let isCashDeposit = (rawSender.includes('CASHDEPOSIT') || rawSender.includes('CDM') || rawRef.includes('CASHDEPOSIT') || rawRef.includes('CDM'));
                     if (isCashDeposit && sysPay.p_method === 'CASH DEPOSIT') isNameMatch = true; 
                     
                     let score = isNameMatch ? 10 : 0;
                     if (score >= 10 && score > bestScore) {
                         bestScore = score;
                         bestMatchIndex = i;
                     }
                 }
             }
        }
        
        if (bestMatchIndex > -1) {
             const bestSysPay = allSystemPayments[bestMatchIndex];
             bestSysPay.isMatched = true;
             bankTx.isMatched = true;
             paired.push({ ...bankTx, status: 'MATCHED', plate_number: bestSysPay.plate_number, driver_id: bestSysPay.driver_id, matched_driver_name: bestSysPay.driver_name });
        } else {
             unpaired.push({ ...bankTx, status: 'UNMATCHED', plate_number: 'UNKNOWN' });
        }
    });

    allSystemPayments.forEach(sysPay => {
         if (!sysPay.isMatched) {
              unsolved.push({
                   id: sysPay.id,
                   amount: sysPay.amount,
                   trans_date: sysPay.trans_date,
                   driver_name: sysPay.driver_name,
                   plate_number: sysPay.plate_number,
                   payment_method: sysPay.p_method,
                   status: 'SYSTEM_UNSOLVED'
              });
         }
    });

    const formattedWithdrawals = withdrawals.map((tx: any) => ({
        ...tx,
        status: "WITHDRAWAL"
    }));

    const allTransactions = [
        ...paired,
        ...unpaired,
        ...formattedWithdrawals
    ];
    allTransactions.sort((a: any, b: any) => (a.original_index ?? 0) - (b.original_index ?? 0));

    const finalResult = {
        summary: summary,
        paired_transactions: paired,
        unpaired_transactions: unpaired,
        unsolved_system_transactions: unsolved,
        all_transactions: allTransactions
    };

    return new Response(JSON.stringify(finalResult), {
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

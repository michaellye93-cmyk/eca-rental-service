// Compatibility adapter for the existing production provider during the clone phase.
export async function extractGeminiStatement(file: File, options: {
  apiKey?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
}) {
  if (!options.apiKey?.trim()) throw new Error('GEMINI_API_KEY is missing from the Supabase Edge Function secrets.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const model = options.model?.trim() || 'gemini-3.1-pro-preview';
  const response = await (options.fetch ?? globalThis.fetch)(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        contents: [{ parts: [{
          text: "Read the following bank statement visually. Return a JSON object containing two main keys: 'summary' and 'transactions'. Under 'summary', locate and extract: 'beginning_balance' (numeric float, the Beginning Balance of the statement as of start date), 'total_deposits_amount' (numeric float, the total amount of Deposits/Credits/Plus), 'total_deposits_count' (numeric integer, the total count of Deposits/Credits/Plus), 'total_withdrawals_amount' (numeric float, the total amount of Withdrawals/Debits/Minus), 'total_withdrawals_count' (numeric integer, the total count of Withdrawals/Debits/Minus), and 'ending_balance' (numeric float, the Ending Balance of the statement as of end date). Under 'transactions', return ONLY a structured JSON array of DEPOSIT (incoming money / Credit / CR) transactions. VERY IMPORTANT: Do NOT extract, process, or include any DR / Debit / Withdrawal / money-out transactions in this 'transactions' array. Completely ignore and skip all rows that represent money leaving the account. For each and every DEPOSIT / CREDIT transaction, you must extract: trans_date (converted to YYYY-MM-DD for processing), display_date (DD-MM-YYYY EXACTLY as shown in image), branch_description, sender_name, reference_1, reference_2, ref_num, amount_dr (always null since we ignore withdrawals), amount_cr (numeric float representing the deposit/credit amount), balance (numeric float representing the running balance on that row), amount (numeric float representing the deposit/credit amount), and reference (a combined string of reference_1 + reference_2 if available). Make sure to capture every single deposit/credit without skipping any. Only output raw JSON object, no markdown blocks.",
        }, { inline_data: { mime_type: file.type, data: btoa(binary) } }] }],
        generationConfig: { response_mime_type: 'application/json' },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini request failed (HTTP ${response.status}). Check the server API key, model access and API quota.`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Failed to parse Gemini response');
  const parsed = JSON.parse(text);
  return {
    transactions: Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.transactions) ? parsed.transactions : []),
    summary: Array.isArray(parsed) ? null : (parsed?.summary ?? null),
  };
}

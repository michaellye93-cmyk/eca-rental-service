-- Migration: Add payment_method column to public.payments
-- Date: 2026-05-26

ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'BANK TRANSFER';

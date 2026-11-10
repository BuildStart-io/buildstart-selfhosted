-- Migration: 04_performance_optimization.sql
-- Optimizes Chats, Leads, and Orders querying in public schema

-- 1. Performance Indexes on public schema
CREATE INDEX IF NOT EXISTS idx_conversations_user_created 
  ON public.conversations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_user_phone_created 
  ON public.conversations (user_id, phone_number, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_orders_user_created 
  ON public.orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_status_created 
  ON public.orders (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_phones 
  ON public.orders (user_id, customer_phone);

CREATE INDEX IF NOT EXISTS idx_leads_user_updated 
  ON public.leads (user_id, updated_at DESC);

-- 2. Add inbound_count to public.leads if not exists
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS inbound_count integer DEFAULT 0 NOT NULL;

-- 3. Backfill missing leads from conversations
INSERT INTO public.leads (user_id, phone_number, customer_name, status, created_at, updated_at)
SELECT DISTINCT ON (c.user_id, c.phone_number)
  c.user_id,
  c.phone_number,
  c.metadata->>'senderName',
  'new',
  c.created_at,
  c.created_at
FROM public.conversations c
WHERE NOT EXISTS (
  SELECT 1 FROM public.leads l WHERE l.user_id = c.user_id AND l.phone_number = c.phone_number
)
ORDER BY c.user_id, c.phone_number, c.created_at ASC
ON CONFLICT (user_id, phone_number) DO NOTHING;

-- 4. Backfill inbound_count for all leads
UPDATE public.leads l
SET inbound_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT user_id, phone_number, count(*) as cnt
  FROM public.conversations
  WHERE direction = 'inbound'
  GROUP BY user_id, phone_number
) sub
WHERE l.user_id = sub.user_id AND l.phone_number = sub.phone_number;

-- 5. Trigger to automatically keep public.leads in sync on new conversations
CREATE OR REPLACE FUNCTION public.handle_new_conversation_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    INSERT INTO public.leads (
      user_id,
      phone_number,
      customer_name,
      status,
      inbound_count,
      created_at,
      updated_at
    )
    VALUES (
      NEW.user_id,
      NEW.phone_number,
      COALESCE(NEW.metadata->>'senderName', NULL),
      'new',
      1,
      NEW.created_at,
      NEW.created_at
    )
    ON CONFLICT (user_id, phone_number)
    DO UPDATE SET
      inbound_count = public.leads.inbound_count + 1,
      customer_name = COALESCE(public.leads.customer_name, EXCLUDED.customer_name),
      updated_at = EXCLUDED.updated_at;
  ELSE
    INSERT INTO public.leads (
      user_id,
      phone_number,
      customer_name,
      status,
      inbound_count,
      created_at,
      updated_at
    )
    VALUES (
      NEW.user_id,
      NEW.phone_number,
      NULL,
      'new',
      0,
      NEW.created_at,
      NEW.created_at
    )
    ON CONFLICT (user_id, phone_number)
    DO UPDATE SET
      updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_sync_lead ON public.conversations;
CREATE TRIGGER trg_conversation_sync_lead
AFTER INSERT ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_conversation_lead();

-- 6. RPC: get_chat_threads with search and pagination
CREATE OR REPLACE FUNCTION public.get_chat_threads(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _search text DEFAULT NULL
)
RETURNS TABLE (
  phone_number text,
  last_message text,
  last_time timestamp with time zone,
  sender_name text,
  unread_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid;
  v_target_user_id uuid;
  v_clean_search text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  -- Check if caller is staff with conversations permission
  SELECT sa.owner_id INTO v_target_user_id
  FROM public.staff_accounts sa
  WHERE sa.staff_user_id = v_caller_id
    AND sa.is_active = true
    AND 'conversations' = ANY (sa.permissions)
  LIMIT 1;

  -- If not staff, target is caller themselves
  IF v_target_user_id IS NULL THEN
    v_target_user_id := v_caller_id;
  END IF;

  v_clean_search := NULLIF(trim(_search), '');

  RETURN QUERY
  WITH latest_messages AS (
    SELECT DISTINCT ON (c.phone_number)
      c.phone_number,
      c.message,
      c.created_at,
      c.metadata
    FROM public.conversations c
    WHERE c.user_id = v_target_user_id
    ORDER BY c.phone_number, c.created_at DESC
  )
  SELECT 
    lm.phone_number,
    lm.message AS last_message,
    lm.created_at AS last_time,
    COALESCE(NULLIF(l.customer_name, ''), NULLIF(lm.metadata->>'senderName', ''), 'Unknown') AS sender_name,
    0::bigint AS unread_count
  FROM latest_messages lm
  LEFT JOIN public.leads l 
    ON l.user_id = v_target_user_id 
   AND l.phone_number = lm.phone_number
  WHERE v_clean_search IS NULL
     OR lm.phone_number ILIKE '%' || v_clean_search || '%'
     OR lm.message ILIKE '%' || v_clean_search || '%'
     OR COALESCE(l.customer_name, lm.metadata->>'senderName', '') ILIKE '%' || v_clean_search || '%'
  ORDER BY lm.created_at DESC
  LIMIT _limit
  OFFSET _offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_threads TO authenticated, service_role;


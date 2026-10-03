#!/bin/bash
docker exec -i supabase-db psql -U postgres -d postgres << 'SQL'
CREATE TABLE IF NOT EXISTS flexlearn_customization.scheduled_campaigns (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text NOT NULL,
    message_template text NOT NULL,
    target_filter jsonb DEFAULT '{}'::jsonb NOT NULL,
    total_recipients integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'scheduled' NOT NULL CHECK (status IN ('draft', 'scheduled', 'running', 'completed', 'cancelled', 'paused')),
    start_date date NOT NULL,
    end_date date NOT NULL,
    daily_start_time text NOT NULL DEFAULT '09:00',
    daily_end_time text NOT NULL DEFAULT '18:00',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS flexlearn_customization.scheduled_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id uuid NOT NULL REFERENCES flexlearn_customization.scheduled_campaigns(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_name text NOT NULL,
    phone_number text NOT NULL,
    message text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_queue ON flexlearn_customization.scheduled_messages (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_campaign ON flexlearn_customization.scheduled_messages (campaign_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user ON flexlearn_customization.scheduled_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_campaigns_user ON flexlearn_customization.scheduled_campaigns (user_id);

ALTER TABLE flexlearn_customization.scheduled_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE flexlearn_customization.scheduled_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can manage their own campaigns" ON flexlearn_customization.scheduled_campaigns;
    CREATE POLICY "Users can manage their own campaigns" ON flexlearn_customization.scheduled_campaigns
        FOR ALL USING (auth.uid() = user_id OR flexlearn_customization.has_role(auth.uid(), 'super_admin'::flexlearn_customization.app_role) OR flexlearn_customization.is_staff_of(auth.uid(), user_id))
        WITH CHECK (auth.uid() = user_id OR flexlearn_customization.has_role(auth.uid(), 'super_admin'::flexlearn_customization.app_role) OR flexlearn_customization.is_staff_of(auth.uid(), user_id));

    DROP POLICY IF EXISTS "Users can manage their own scheduled messages" ON flexlearn_customization.scheduled_messages;
    CREATE POLICY "Users can manage their own scheduled messages" ON flexlearn_customization.scheduled_messages
        FOR ALL USING (auth.uid() = user_id OR flexlearn_customization.has_role(auth.uid(), 'super_admin'::flexlearn_customization.app_role) OR flexlearn_customization.is_staff_of(auth.uid(), user_id))
        WITH CHECK (auth.uid() = user_id OR flexlearn_customization.has_role(auth.uid(), 'super_admin'::flexlearn_customization.app_role) OR flexlearn_customization.is_staff_of(auth.uid(), user_id));
END $$;
SQL

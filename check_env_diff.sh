#!/bin/bash
grep -E '^[A-Z_]+=' /root/supabase/supabase/docker/.env | cut -d '=' -f 1

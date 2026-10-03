#!/bin/bash
sed -i '/MINIO_REGION:/a \      WAHA_BASE_URL: ${WAHA_BASE_URL}\n      WAHA_API_KEY: ${WAHA_API_KEY}\n      WAHA_DEFAULT_SESSION: ${WAHA_DEFAULT_SESSION}' docker-compose.yml
docker compose up -d supabase-edge-functions

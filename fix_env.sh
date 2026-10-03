#!/bin/bash
sed -i '/VERIFY_JWT:/a \      MINIO_ENDPOINT: ${MINIO_ENDPOINT}\n      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}\n      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}\n      MINIO_REGION: ${MINIO_REGION}' docker-compose.yml
docker compose up -d supabase-edge-functions

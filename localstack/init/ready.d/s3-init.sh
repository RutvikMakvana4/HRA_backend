#!/bin/bash
set -e
awslocal s3 mb s3://hra-dev-bucket || true
awslocal s3api put-bucket-cors --bucket hra-dev-bucket --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": ["http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}'
echo "s3-init: hra-dev-bucket ready with CORS"

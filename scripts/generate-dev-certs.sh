#!/bin/sh
# Generate self-signed certs for development (requires openssl)
set -e
OUTDIR="$(dirname "$0")/../certs"
mkdir -p "$OUTDIR"
CN=${1:-"192.168.17.132"}

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$OUTDIR/key.pem" -out "$OUTDIR/cert.pem" \
  -subj "/C=TR/ST=Istanbul/L=Istanbul/O=Lojman/CN=$CN"

echo "Generated certs in $OUTDIR (CN=$CN)"

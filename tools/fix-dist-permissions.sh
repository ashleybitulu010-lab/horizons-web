#!/usr/bin/env bash
# Emergency fix for 403 - restores dist directory permissions and content

set -x
APP_DIR="${APP_DIR:-/opt/ashledger}"

echo "=== Emergency 403 Fix Starting ==="
date

echo "=== Current state ==="
ls -la "$APP_DIR/" 2>/dev/null || echo "Cannot list $APP_DIR"
ls -la "$APP_DIR/dist/" 2>/dev/null | head -10 || echo "Cannot list dist"

echo "=== Fixing permissions on existing dist ==="
if [ -d "$APP_DIR/dist" ]; then
    chmod -R u=rwX,go=rX "$APP_DIR/dist" 2>/dev/null || echo "WARN: chmod failed"
    ls -la "$APP_DIR/dist/" | head -5
fi

echo "=== Checking if dist has index.html ==="
if [ ! -f "$APP_DIR/dist/index.html" ]; then
    echo "ERROR: dist/index.html is missing!"
    
    echo "=== Looking for backups ==="
    ls -ld "$APP_DIR"/.dist-backup-* 2>/dev/null || echo "No backups found"
    
    LATEST=$(ls -td "$APP_DIR"/.dist-backup-* 2>/dev/null | head -1)
    if [ -n "$LATEST" ] && [ -f "$LATEST/index.html" ]; then
        echo "=== Restoring from backup: $LATEST ==="
        rm -rf "$APP_DIR/dist"
        cp -a "$LATEST" "$APP_DIR/dist"
        chmod -R u=rwX,go=rX "$APP_DIR/dist"
        echo "Backup restored!"
    else
        echo "ERROR: No valid backup found with index.html"
        exit 1
    fi
else
    echo "OK: dist/index.html exists"
fi

echo "=== Testing nginx config ==="
nginx -t 2>&1 || echo "WARN: nginx config test failed"

echo "=== Reloading nginx ==="
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || echo "WARN: nginx reload failed"

sleep 2

echo "=== Verifying HTTP responses ==="
curl -sS -o /dev/null -w "Local: %{http_code}\n" http://127.0.0.1/ || echo "WARN: local check failed"
curl -sS -o /dev/null -w "Public: %{http_code}\n" https://ashledger.tech/ || echo "WARN: public check failed"

echo "=== Final dist state ==="
ls -la "$APP_DIR/dist/" | head -10

echo "=== Emergency fix complete ==="
date

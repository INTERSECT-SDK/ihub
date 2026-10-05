#!/bin/sh
set -eu

raw_bytes="${PROJECT_FILE_UPLOAD_MAX_BYTES:-}"
server_name="${NGINX_SERVER_NAME:-}"
template_path="${1:-/etc/nginx/default.conf.template}"
output_path="${2:-/etc/nginx/conf.d/default.conf}"

if [ "$#" -gt 2 ]; then
  echo >&2 'Usage: render-upload-body-limit.sh [template-path [output-path]]'
  exit 1
fi

case "$server_name" in
  '' | .* | *. | *..* | -* | *- | *.-* | *-.* | *[!A-Za-z0-9.-]*)
    echo >&2 'NGINX_SERVER_NAME must be a valid DNS hostname.'
    exit 1
    ;;
esac

if [ "${#server_name}" -gt 253 ]; then
  echo >&2 'NGINX_SERVER_NAME must be a valid DNS hostname.'
  exit 1
fi

case "$raw_bytes" in
  '' | *[!0-9]*)
    echo >&2 'PROJECT_FILE_UPLOAD_MAX_BYTES must be a positive integer.'
    exit 1
    ;;
esac

raw_bytes=$(printf '%s' "$raw_bytes" | sed 's/^0*//')
if [ -z "$raw_bytes" ]; then
  echo >&2 'PROJECT_FILE_UPLOAD_MAX_BYTES must be a positive integer.'
  exit 1
fi

# Keep the calculation within the signed integer range used by /bin/sh.
max_raw_bytes=4611686018427387368
if [ "${#raw_bytes}" -gt "${#max_raw_bytes}" ] ||
  { [ "${#raw_bytes}" -eq "${#max_raw_bytes}" ] &&
    [ "$raw_bytes" \> "$max_raw_bytes" ]; }; then
  echo >&2 'PROJECT_FILE_UPLOAD_MAX_BYTES is too large to derive an Nginx body limit.'
  exit 1
fi

base64_chunks=$((raw_bytes / 3))
if [ $((raw_bytes % 3)) -ne 0 ]; then
  base64_chunks=$((base64_chunks + 1))
fi

# JSON.stringify({ type: 'file', format: 'base64', content: '' }) is 46 bytes.
upload_body_limit_bytes=$((4 * base64_chunks + 46 + 1024))

# A text file containing only quotes or backslashes doubles in size when its
# content is escaped inside the Jupyter Contents API request JSON.
editor_body_limit_bytes=$((2 * raw_bytes + 46 + 1024))

sed \
  -e "s/__NGINX_SERVER_NAME__/${server_name}/g" \
  -e "s/__PROJECT_FILE_UPLOAD_MAX_BODY_BYTES__/${upload_body_limit_bytes}/g" \
  -e "s/__PROJECT_FILE_EDITOR_MAX_BODY_BYTES__/${editor_body_limit_bytes}/g" \
  "$template_path" > "$output_path"

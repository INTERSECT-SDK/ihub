#!/bin/sh
set -eu

raw_bytes="${PROJECT_FILE_UPLOAD_MAX_BYTES:-}"
hub_upstream="${NGINX_HUB_UPSTREAM:-}"
marketplace_upstream="${NGINX_MARKETPLACE_UPSTREAM:-}"
server_upstream="${NGINX_SERVER_UPSTREAM:-}"
docs_upstream="${NGINX_DOCS_UPSTREAM:-}"
mcp_upstream="${NGINX_MCP_UPSTREAM:-}"
ollama_upstream="${NGINX_OLLAMA_UPSTREAM:-}"
template_path="${1:-/etc/nginx/default.conf.template}"
output_path="${2:-/etc/nginx/conf.d/default.conf}"

if [ "$#" -gt 2 ]; then
  echo >&2 'Usage: render-upload-body-limit.sh [template-path [output-path]]'
  exit 1
fi

validate_upstream() {
  variable_name="$1"
  upstream="$2"
  required="$3"

  if [ -z "$upstream" ]; then
    if [ "$required" = true ]; then
      echo >&2 "$variable_name must be set to a valid host:port authority."
      exit 1
    fi
    return
  fi

  host="${upstream%:*}"
  port="${upstream##*:}"
  case "$host" in
    '' | "$upstream" | *[!A-Za-z0-9.-]* | .* | *. | -* | *-)
      echo >&2 "$variable_name must be set to a valid host:port authority."
      exit 1
      ;;
  esac
  case "$port" in
    '' | *[!0-9]*)
      echo >&2 "$variable_name must be set to a valid host:port authority."
      exit 1
      ;;
  esac

  normalized_port=$(printf '%s' "$port" | sed 's/^0*//')
  if [ -z "$normalized_port" ] ||
    [ "${#normalized_port}" -gt 5 ] ||
    { [ "${#normalized_port}" -eq 5 ] && [ "$normalized_port" \> 65535 ]; }; then
    echo >&2 "$variable_name must be set to a valid host:port authority."
    exit 1
  fi
}

validate_upstream NGINX_HUB_UPSTREAM "$hub_upstream" true
validate_upstream NGINX_MARKETPLACE_UPSTREAM "$marketplace_upstream" true
validate_upstream NGINX_SERVER_UPSTREAM "$server_upstream" true
validate_upstream NGINX_DOCS_UPSTREAM "$docs_upstream" true
validate_upstream NGINX_MCP_UPSTREAM "$mcp_upstream" true
validate_upstream NGINX_OLLAMA_UPSTREAM "$ollama_upstream" false

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

if [ -n "$ollama_upstream" ]; then
  sed \
    -e "s/__PROJECT_FILE_UPLOAD_MAX_BODY_BYTES__/${upload_body_limit_bytes}/g" \
    -e "s/__PROJECT_FILE_EDITOR_MAX_BODY_BYTES__/${editor_body_limit_bytes}/g" \
    -e "s/__NGINX_HUB_UPSTREAM__/${hub_upstream}/g" \
    -e "s/__NGINX_MARKETPLACE_UPSTREAM__/${marketplace_upstream}/g" \
    -e "s/__NGINX_SERVER_UPSTREAM__/${server_upstream}/g" \
    -e "s/__NGINX_DOCS_UPSTREAM__/${docs_upstream}/g" \
    -e "s/__NGINX_MCP_UPSTREAM__/${mcp_upstream}/g" \
    -e "s/__NGINX_OLLAMA_UPSTREAM__/${ollama_upstream}/g" \
    -e '/__NGINX_OLLAMA_LOCATION_BEGIN__/d' \
    -e '/__NGINX_OLLAMA_LOCATION_END__/d' \
    "$template_path" > "$output_path"
else
  sed \
    -e "s/__PROJECT_FILE_UPLOAD_MAX_BODY_BYTES__/${upload_body_limit_bytes}/g" \
    -e "s/__PROJECT_FILE_EDITOR_MAX_BODY_BYTES__/${editor_body_limit_bytes}/g" \
    -e "s/__NGINX_HUB_UPSTREAM__/${hub_upstream}/g" \
    -e "s/__NGINX_MARKETPLACE_UPSTREAM__/${marketplace_upstream}/g" \
    -e "s/__NGINX_SERVER_UPSTREAM__/${server_upstream}/g" \
    -e "s/__NGINX_DOCS_UPSTREAM__/${docs_upstream}/g" \
    -e "s/__NGINX_MCP_UPSTREAM__/${mcp_upstream}/g" \
    -e '/__NGINX_OLLAMA_LOCATION_BEGIN__/,/__NGINX_OLLAMA_LOCATION_END__/d' \
    "$template_path" > "$output_path"
fi

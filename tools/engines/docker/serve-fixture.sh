#!/bin/sh
# Answers one HTTP request on stdin/stdout, for socat (RELAY step 8b). It serves the harness's
# catalog fixtures to the engine in this container, the way a provider serves a playlist.
# run-chrome.sh starts it on 127.0.0.1:8090 when /app/fixtures exists:
#
#   socat TCP-LISTEN:8090,bind=127.0.0.1,fork,reuseaddr EXEC:'/bin/sh serve-fixture.sh <dir>'
#
# - Plain files from <dir> (no subfolders), GET and OPTIONS only.
# - CORS headers on every answer: the page is file://, so the Blob worker's origin is "null".
#   (Packaged TV apps are expected to need no CORS at all: spike S7.)
# - No validators: the harness asks the app for force=1, so every run downloads and commits.
# - No Content-Encoding: a .gz file arrives as gzip bytes, and the ingest worker gunzips it
#   itself (fflate before Chromium 80), as it does a provider's .m3u.gz.
#
# POSIX sh plus socat, both already in the image, so adding this costs no package download.
set -u
root=$1
cr=$(printf '\r')

reply() {
  # $1 status, $2 content type, $3 content length
  printf 'HTTP/1.0 %s\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: If-None-Match, If-Modified-Since\r\nAccess-Control-Expose-Headers: Content-Length\r\nCache-Control: no-store\r\nContent-Type: %s\r\nContent-Length: %s\r\n\r\n' "$1" "$2" "$3"
}

IFS=' ' read -r method target _ || exit 0
# Read the request headers up to the empty line (a GET has no body).
while IFS= read -r line; do
  line=${line%"$cr"}
  [ -z "$line" ] && break
done

name=${target%%\?*}
name=${name#/}
echo "fixtures: $method /$name" >&2

case "$method" in
  OPTIONS) reply '204 No Content' text/plain 0; exit 0 ;;
  GET) ;;
  *) reply '405 Method Not Allowed' text/plain 0; exit 0 ;;
esac
case "$name" in
  '' | *..* | */*) reply '404 Not Found' text/plain 0; exit 0 ;;
esac
file="$root/$name"
if [ ! -f "$file" ]; then
  reply '404 Not Found' text/plain 0
  exit 0
fi
case "$name" in
  *.gz) type=application/gzip ;;
  *.m3u) type=audio/x-mpegurl ;;
  *) type=application/octet-stream ;;
esac
reply '200 OK' "$type" "$(wc -c < "$file" | tr -d ' ')"
cat "$file"

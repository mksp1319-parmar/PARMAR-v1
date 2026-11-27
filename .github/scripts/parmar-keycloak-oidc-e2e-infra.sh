#!/usr/bin/env bash
set -Eeuo pipefail

readonly MIN_FREE_DISK_KB=4194304
readonly MIN_AVAILABLE_MEMORY_KB=1572864
readonly KEYCLOAK_READINESS_TIMEOUT_SECONDS=180

fail() {
  printf '::error::PARMAR Keycloak E2E infrastructure: %s\n' "$*" >&2
  exit 1
}

log() {
  printf 'PARMAR Keycloak E2E infrastructure: %s\n' "$*"
}

load_run_context() {
  [[ "${PARMAR_E2E_RUN_ID:-}" =~ ^[0-9]+$ ]] ||
    fail "PARMAR_E2E_RUN_ID must be the numeric GitHub run ID."
  [[ "${PARMAR_E2E_RUN_ATTEMPT:-}" =~ ^[0-9]+$ ]] ||
    fail "PARMAR_E2E_RUN_ATTEMPT must be the numeric GitHub run attempt."
  [[ -n "${RUNNER_TEMP:-}" && -d "$RUNNER_TEMP" ]] ||
    fail "RUNNER_TEMP must name an existing runner temporary directory."

  RUN_TEMP_ROOT="$(realpath -e -- "$RUNNER_TEMP")"
  RUN_SLUG="parmar-keycloak-e2e-${PARMAR_E2E_RUN_ID}-${PARMAR_E2E_RUN_ATTEMPT}"
  RUN_OWNER="${PARMAR_E2E_RUN_ID}:${PARMAR_E2E_RUN_ATTEMPT}"
  RUN_TEMP_DIR="${RUN_TEMP_ROOT}/${RUN_SLUG}"
  RUN_NETWORK="${RUN_SLUG}-net"
  RUN_CONTAINER="${RUN_SLUG}-keycloak"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required runner tool '$1' is unavailable."
}

append_github_env() {
  local name="$1"
  local value="$2"
  [[ -n "${GITHUB_ENV:-}" ]] || return 0
  [[ "$value" != *$'\n'* ]] || fail "Refusing a multiline GITHUB_ENV value."
  printf '%s=%s\n' "$name" "$value" >>"$GITHUB_ENV"
}

ensure_owned_temp_dir() {
  [[ -d "$RUN_TEMP_DIR" && ! -L "$RUN_TEMP_DIR" ]] ||
    fail "The run temporary directory is missing or is not a real directory."
  [[ -f "$RUN_TEMP_DIR/.owner" && ! -L "$RUN_TEMP_DIR/.owner" ]] ||
    fail "The run temporary directory ownership marker is missing."
  [[ "$(cat -- "$RUN_TEMP_DIR/.owner")" == "$RUN_OWNER" ]] ||
    fail "The run temporary directory is not owned by this run."
}

preflight() {
  load_run_context
  for tool in docker python3 openssl curl df awk free realpath; do
    require_command "$tool"
  done

  python3 -c 'import ssl; assert ssl.OPENSSL_VERSION'
  openssl version >/dev/null
  curl --version >/dev/null

  local free_disk_kb available_memory_kb
  free_disk_kb="$(df -Pk -- "$RUN_TEMP_ROOT" | awk 'NR == 2 { print $4 }')"
  [[ "$free_disk_kb" =~ ^[0-9]+$ ]] ||
    fail "Could not determine free disk space on RUNNER_TEMP."
  (( free_disk_kb >= MIN_FREE_DISK_KB )) ||
    fail "Insufficient disk space: require at least 4 GiB free under RUNNER_TEMP."

  available_memory_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)"
  [[ "$available_memory_kb" =~ ^[0-9]+$ ]] ||
    fail "Could not determine available runner memory."
  (( available_memory_kb >= MIN_AVAILABLE_MEMORY_KB )) ||
    fail "Insufficient memory: require at least 1.5 GiB available."

  docker info --format '{{.ServerVersion}}' >/dev/null ||
    fail "Docker daemon is unavailable."

  python3 - <<'PY'
import socket

for port in (8080, 8443):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(("127.0.0.1", port))
            listener.listen(1)
        except OSError as error:
            raise SystemExit(
                f"Cannot bind required loopback port 127.0.0.1:{port}: {error}"
            ) from error
PY

  local probe_network probe_created=false
  probe_network="${RUN_SLUG}-probe"
  if docker network inspect "$probe_network" >/dev/null 2>&1; then
    fail "A network with this run's probe name already exists; refusing to alter it."
  fi

  cleanup_probe_network() {
    if [[ "$probe_created" == true ]]; then
      local probe_owner
      probe_owner="$(docker network inspect --format '{{ index .Labels "parmar.e2e.owner" }}' "$probe_network")" ||
        {
          printf '::error::Could not verify ownership of the temporary probe network.\n' >&2
          return 1
        }
      [[ "$probe_owner" == "$RUN_OWNER" ]] || {
        printf '::error::Refusing to remove a probe network not owned by this run.\n' >&2
        return 1
      }
      docker network rm "$probe_network" >/dev/null ||
        printf '::error::Could not remove this run temporary probe network.\n' >&2
    fi
  }
  trap cleanup_probe_network EXIT

  docker network create \
    --driver bridge \
    --internal \
    --label "parmar.e2e.owner=${RUN_OWNER}" \
    "$probe_network" >/dev/null ||
    fail "Docker could not create an isolated internal network."
  probe_created=true
  [[ "$(docker network inspect --format '{{ index .Labels "parmar.e2e.owner" }}' "$probe_network")" == "$RUN_OWNER" ]] ||
    fail "Docker probe network ownership could not be verified."
  [[ "$(docker network inspect --format '{{.Internal}}' "$probe_network")" == true ]] ||
    fail "Docker did not create an internally isolated probe network."
  docker network rm "$probe_network" >/dev/null ||
    fail "Docker could not remove the isolated network probe."
  probe_created=false
  trap - EXIT

  [[ ! -e "$RUN_TEMP_DIR" ]] ||
    fail "Run temporary directory already exists; refusing to overwrite it."
  mkdir -m 700 -- "$RUN_TEMP_DIR" ||
    fail "Could not create the run-specific temporary directory."
  printf '%s\n' "$RUN_OWNER" >"$RUN_TEMP_DIR/.owner"
  chmod 600 "$RUN_TEMP_DIR/.owner"

  append_github_env PARMAR_E2E_TMPDIR "$RUN_TEMP_DIR"
  append_github_env PARMAR_E2E_NETWORK "$RUN_NETWORK"
  append_github_env PARMAR_E2E_CONTAINER "$RUN_CONTAINER"
  append_github_env PARMAR_E2E_OWNER "$RUN_OWNER"

  log "Runner preflight passed; no Keycloak service has been started."
}

prepare_tls() {
  load_run_context
  ensure_owned_temp_dir

  local tls_dir
  tls_dir="${RUN_TEMP_DIR}/tls"
  [[ ! -e "$tls_dir" ]] ||
    fail "TLS directory already exists; refusing to overwrite it."
  mkdir -m 700 -- "$tls_dir"
  umask 077

  openssl genpkey \
    -algorithm RSA \
    -pkeyopt rsa_keygen_bits:3072 \
    -out "$tls_dir/ca.key"
  openssl req \
    -x509 \
    -new \
    -key "$tls_dir/ca.key" \
    -sha256 \
    -days 2 \
    -subj "/CN=PARMAR ephemeral E2E CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$tls_dir/ca.crt"

  local service
  for service in keycloak parmar; do
    openssl genpkey \
      -algorithm RSA \
      -pkeyopt rsa_keygen_bits:2048 \
      -out "$tls_dir/${service}.key"
    openssl req \
      -new \
      -key "$tls_dir/${service}.key" \
      -subj "/CN=127.0.0.1" \
      -out "$tls_dir/${service}.csr"
    cat >"$tls_dir/${service}.ext" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:127.0.0.1,DNS:localhost
EOF
    openssl x509 \
      -req \
      -in "$tls_dir/${service}.csr" \
      -CA "$tls_dir/ca.crt" \
      -CAkey "$tls_dir/ca.key" \
      -CAcreateserial \
      -days 2 \
      -sha256 \
      -extfile "$tls_dir/${service}.ext" \
      -out "$tls_dir/${service}.crt"
    openssl verify -CAfile "$tls_dir/ca.crt" "$tls_dir/${service}.crt" >/dev/null
    openssl x509 -in "$tls_dir/${service}.crt" -noout -checkip 127.0.0.1 ||
      fail "Generated ${service} certificate does not cover 127.0.0.1."
    openssl x509 -in "$tls_dir/${service}.crt" -noout -checkhost localhost ||
      fail "Generated ${service} certificate does not cover localhost."
  done

  chmod 600 "$tls_dir"/*.key "$tls_dir/ca.key"
  KEYCLOAK_TLS_DIR="${RUN_TEMP_DIR}/keycloak-tls"
  [[ ! -e "$KEYCLOAK_TLS_DIR" ]] ||
    fail "The minimal Keycloak TLS directory already exists; refusing to overwrite it."
  mkdir -m 750 -- "$KEYCLOAK_TLS_DIR"
  cp -- "$tls_dir/keycloak.crt" "$KEYCLOAK_TLS_DIR/keycloak.crt"
  cp -- "$tls_dir/keycloak.key" "$KEYCLOAK_TLS_DIR/keycloak.key"
  chgrp "$(id -g)" "$KEYCLOAK_TLS_DIR" \
    "$KEYCLOAK_TLS_DIR/keycloak.crt" "$KEYCLOAK_TLS_DIR/keycloak.key"
  chmod 750 "$KEYCLOAK_TLS_DIR"
  chmod 640 "$KEYCLOAK_TLS_DIR/keycloak.crt" "$KEYCLOAK_TLS_DIR/keycloak.key"
  append_github_env PARMAR_E2E_CA_CERT "$tls_dir/ca.crt"
  append_github_env PARMAR_E2E_KEYCLOAK_CERT "$tls_dir/keycloak.crt"
  append_github_env PARMAR_E2E_KEYCLOAK_KEY "$tls_dir/keycloak.key"
  append_github_env PARMAR_E2E_PARMAR_CERT "$tls_dir/parmar.crt"
  append_github_env PARMAR_E2E_PARMAR_KEY "$tls_dir/parmar.key"
  append_github_env SSL_CERT_FILE "$tls_dir/ca.crt"
  append_github_env CURL_CA_BUNDLE "$tls_dir/ca.crt"
  append_github_env NODE_EXTRA_CA_CERTS "$tls_dir/ca.crt"

  log "Ephemeral certificates cover 127.0.0.1 and localhost; private keys remain under RUNNER_TEMP."
}

pull_image() {
  load_run_context
  local image="${PARMAR_KEYCLOAK_IMAGE:-}"
  if [[ -z "$image" ]]; then
    fail "BLOCKED: no Keycloak image is selected. Set a reviewed quay.io/keycloak/keycloak@sha256:<64-hex-digest> only after verifying official image provenance; no image will be pulled."
  fi
  [[ "$image" =~ ^quay\.io/keycloak/keycloak@sha256:[0-9a-f]{64}$ ]] ||
    fail "Keycloak image must use the official quay.io repository and an immutable SHA-256 digest."

  docker pull "$image" ||
    fail "Could not pull the configured immutable Keycloak image."
  docker image inspect "$image" --format '{{.Id}}' >/dev/null ||
    fail "Pulled Keycloak digest could not be inspected."
  local image_platform
  image_platform="$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" ||
    fail "Pulled Keycloak image platform could not be verified."
  [[ "$image_platform" == "linux/amd64" ]] ||
    fail "The pinned Keycloak image is not linux/amd64 for ubuntu-24.04 x64."
  printf '::notice::Verified pinned Keycloak image architecture: %s\n' "$image_platform"
  log "No signature verification is performed."
}

start_keycloak() {
  load_run_context
  ensure_owned_temp_dir
  local tls_dir keycloak_tls_dir image admin_password runner_gid
  tls_dir="${RUN_TEMP_DIR}/tls"
  keycloak_tls_dir="${RUN_TEMP_DIR}/keycloak-tls"
  image="${PARMAR_KEYCLOAK_IMAGE:-}"
  runner_gid="$(id -g)"
  [[ -s "$keycloak_tls_dir/keycloak.crt" && -s "$keycloak_tls_dir/keycloak.key" ]] ||
    fail "Ephemeral Keycloak TLS certificate material is unavailable."
  [[ "$(stat -c '%g:%a' "$keycloak_tls_dir")" == "${runner_gid}:750" &&
     "$(stat -c '%g:%a' "$keycloak_tls_dir/keycloak.crt")" == "${runner_gid}:640" &&
     "$(stat -c '%g:%a' "$keycloak_tls_dir/keycloak.key")" == "${runner_gid}:640" ]] ||
    fail "The minimal Keycloak TLS directory permissions are unsafe."
  [[ -s "${RUN_TEMP_DIR}/bootstrap-secrets.json" ]] ||
    fail "Run-local bootstrap credentials are unavailable."
  [[ "$image" =~ ^quay\.io/keycloak/keycloak@sha256:[0-9a-f]{64}$ ]] ||
    fail "Cannot start Keycloak without a reviewed immutable image digest."
  if docker container inspect "$RUN_CONTAINER" >/dev/null 2>&1; then
    fail "A container with this run's name already exists; refusing to alter it."
  fi
  if docker network inspect "$RUN_NETWORK" >/dev/null 2>&1; then
    fail "A network with this run's name already exists; refusing to alter it."
  fi

  docker network create \
    --driver bridge \
    --internal \
    --label "parmar.e2e.owner=${RUN_OWNER}" \
    "$RUN_NETWORK" >/dev/null ||
    fail "Could not create the run-specific internal Docker network."

  admin_password="$(python3 -m PARMAR.tests.keycloak_e2e_bootstrap admin-password)" ||
    fail "Could not load the run-local Keycloak bootstrap credential."
  export KC_BOOTSTRAP_ADMIN_USERNAME=parmar-e2e-admin
  export KC_BOOTSTRAP_ADMIN_PASSWORD="$admin_password"
  if ! docker run \
    --detach \
    --name "$RUN_CONTAINER" \
    --network "$RUN_NETWORK" \
    --label "parmar.e2e.owner=${RUN_OWNER}" \
    --cap-drop=ALL \
    --security-opt=no-new-privileges \
    --pids-limit=512 \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=256m \
    --publish 127.0.0.1:8443:8443 \
    --group-add "$runner_gid" \
    --mount "type=bind,src=${keycloak_tls_dir},dst=/run/parmar-e2e/tls,readonly" \
    --env KC_HOSTNAME=https://127.0.0.1:8443 \
    --env KC_HOSTNAME_STRICT=true \
    --env KC_HTTP_ENABLED=false \
    --env KC_HEALTH_ENABLED=true \
    --env KC_HTTPS_CERTIFICATE_FILE=/run/parmar-e2e/tls/keycloak.crt \
    --env KC_HTTPS_CERTIFICATE_KEY_FILE=/run/parmar-e2e/tls/keycloak.key \
    --env KC_BOOTSTRAP_ADMIN_USERNAME \
    --env KC_BOOTSTRAP_ADMIN_PASSWORD \
    "$image" start-dev >/dev/null; then
    unset KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
    fail "Could not start the per-run Keycloak container."
  fi
  unset KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
  docker exec "$RUN_CONTAINER" sh -ec '
    test "$(id -u)" -ne 0
    test -r /run/parmar-e2e/tls/keycloak.crt
    test -r /run/parmar-e2e/tls/keycloak.key
  ' || fail "The Keycloak process user cannot read its TLS certificate and private key."
}

wait_keycloak() {
  load_run_context
  ensure_owned_temp_dir
  local deadline=$((SECONDS + KEYCLOAK_READINESS_TIMEOUT_SECONDS))
  local url="https://127.0.0.1:8443/realms/master/.well-known/openid-configuration"

  while (( SECONDS < deadline )); do
    if curl \
      --fail \
      --silent \
      --output /dev/null \
      --connect-timeout 2 \
      --max-time 5 \
      --cacert "$RUN_TEMP_DIR/tls/ca.crt" \
      "$url"; then
      log "Keycloak HTTPS discovery endpoint is ready on loopback."
      return
    fi
    sleep 3
  done

  fail "Keycloak did not become ready within ${KEYCLOAK_READINESS_TIMEOUT_SECONDS} seconds."
}

cleanup_docker_resource() {
  local kind="$1"
  local name="$2"
  local owner found

  if [[ "$kind" == container ]]; then
    found="$(docker container ls -a --filter "name=^/${name}$" --format '{{.Names}}')" ||
      return 1
    if [[ -z "$found" ]]; then
      return 0
    fi
    [[ "$found" == "$name" ]] || return 1
    owner="$(docker container inspect --format '{{ index .Config.Labels "parmar.e2e.owner" }}' "$name")" ||
      return 1
    [[ "$owner" == "$RUN_OWNER" ]] || {
      printf '::error::Refusing to remove container not owned by this run: %s\n' "$name" >&2
      return 1
    }
    docker stop --time 10 "$name" >/dev/null || return 1
    docker rm "$name" >/dev/null || return 1
    return 0
  fi

  found="$(docker network ls --filter "name=^${name}$" --format '{{.Name}}')" ||
    return 1
  if [[ -z "$found" ]]; then
    return 0
  fi
  [[ "$found" == "$name" ]] || return 1
  owner="$(docker network inspect --format '{{ index .Labels "parmar.e2e.owner" }}' "$name")" ||
    return 1
  [[ "$owner" == "$RUN_OWNER" ]] || {
    printf '::error::Refusing to remove network not owned by this run: %s\n' "$name" >&2
    return 1
  }
  docker network rm "$name" >/dev/null
}

verify_docker_resource_absent() {
  local kind="$1"
  local name="$2"
  local found

  if [[ "$kind" == container ]]; then
    found="$(docker container ls -a --filter "name=^/${name}$" --format '{{.Names}}')" ||
      return 1
  else
    found="$(docker network ls --filter "name=^${name}$" --format '{{.Name}}')" ||
      return 1
  fi
  [[ -z "$found" ]]
}

cleanup() {
  load_run_context
  local cleanup_failed=0

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    printf '::error::Docker is unavailable; resource cleanup cannot be verified.\n' >&2
    cleanup_failed=1
  else
    cleanup_docker_resource container "$RUN_CONTAINER" ||
      { printf '::error::Could not safely remove this run container.\n' >&2; cleanup_failed=1; }
    cleanup_docker_resource network "$RUN_NETWORK" ||
      { printf '::error::Could not safely remove this run network.\n' >&2; cleanup_failed=1; }
    verify_docker_resource_absent container "$RUN_CONTAINER" ||
      { printf '::error::Run-owned container remains after cleanup.\n' >&2; cleanup_failed=1; }
    verify_docker_resource_absent network "$RUN_NETWORK" ||
      { printf '::error::Run-owned network remains after cleanup.\n' >&2; cleanup_failed=1; }
  fi

  if [[ -e "$RUN_TEMP_DIR" ]]; then
    if [[ -d "$RUN_TEMP_DIR" && ! -L "$RUN_TEMP_DIR" &&
          -f "$RUN_TEMP_DIR/.owner" && ! -L "$RUN_TEMP_DIR/.owner" &&
          "$(cat -- "$RUN_TEMP_DIR/.owner")" == "$RUN_OWNER" &&
          "$(realpath -e -- "$RUN_TEMP_DIR")" == "$RUN_TEMP_ROOT/$RUN_SLUG" ]]; then
      rm -r -- "$RUN_TEMP_DIR" ||
        { printf '::error::Could not remove this run temporary directory.\n' >&2; cleanup_failed=1; }
    else
      printf '::error::Refusing to remove a temporary directory not owned by this run.\n' >&2
      cleanup_failed=1
    fi
  fi

  (( cleanup_failed == 0 )) ||
    fail "Cleanup did not complete successfully; inspect the errors above."
  printf '::notice::Verified run-owned Docker container and network are absent.\n'
  log "Run-owned temporary files are absent or removed."
}

load_run_context
case "${1:-}" in
  preflight) preflight ;;
  prepare-tls) prepare_tls ;;
  pull-image) pull_image ;;
  start-keycloak) start_keycloak ;;
  wait-keycloak) wait_keycloak ;;
  cleanup) cleanup ;;
  *) fail "Usage: $0 {preflight|prepare-tls|pull-image|start-keycloak|wait-keycloak|cleanup}" ;;
esac

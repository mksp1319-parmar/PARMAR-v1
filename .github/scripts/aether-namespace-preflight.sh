#!/usr/bin/env bash

set -e -o pipefail

if [[ $# -ne 1 || -z "${AETHER_EVIDENCE_DIR:-}" ]]; then
  echo "Usage: AETHER_EVIDENCE_DIR=<directory> $0 <log-file>" >&2
  exit 2
fi

log_file="$1"
mkdir -p "$(dirname "$log_file")" || exit 1

validate_parent_id_map() {
  local map_name="$1"
  local map_path="$2"
  local expected_id="$3"
  local mapping
  local status
  local mapped_id
  local namespace_id
  local range_size

  if mapping=$(cat "$map_path" 2>&1); then
    :
  else
    status=$?
    printf 'Namespace creation blocked: Parent %s could not be read (exit status %s): %s\n' \
      "$map_name" "$status" "$mapping"
    return "$status"
  fi

  if [[ "$mapping" == *$'\n'* ]] \
    || [[ ! "$mapping" =~ ^[[:blank:]]*([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]*$ ]]; then
    printf 'Namespace creation blocked: Parent %s must contain exactly one mapping line with three numeric fields.\n' \
      "$map_name"
    return 1
  fi

  mapped_id="${BASH_REMATCH[1]}"
  namespace_id="${BASH_REMATCH[2]}"
  range_size="${BASH_REMATCH[3]}"
  if [[ "$mapped_id" != "$expected_id" || "$namespace_id" != "$expected_id" || "$range_size" != 1 ]]; then
    printf 'Namespace creation blocked: Parent %s mapping must be %s %s 1; received %s.\n' \
      "$map_name" "$expected_id" "$expected_id" "$mapping"
    return 1
  fi

  printf 'Parent %s:\n%s\n' "$map_name" "$mapping"
}

{
  for tool in /usr/bin/unshare /usr/bin/setpriv /usr/sbin/ip; do
    if [[ ! -x "$tool" ]]; then
      echo "Namespace creation blocked: required tool is missing: $tool"
      exit 127
    fi
  done
  for setting in \
    /proc/sys/kernel/apparmor_restrict_unprivileged_userns \
    /proc/sys/kernel/unprivileged_userns_clone \
    /proc/sys/user/max_user_namespaces \
    /proc/self/attr/current; do
    if [[ -r "$setting" ]]; then
      printf '%s: ' "$setting"
      cat "$setting"
    else
      printf '%s: unavailable\n' "$setting"
    fi
  done
  host_uid="$(id -u)"
  host_gid="$(id -g)"
  parent_user_namespace="$(readlink /proc/self/ns/user)"
  parent_network_namespace="$(readlink /proc/self/ns/net)"
  if [[ -z "$parent_user_namespace" ]]; then
    echo "Namespace creation blocked: Parent user namespace ID is empty."
    exit 1
  fi
  if [[ -z "$parent_network_namespace" ]]; then
    echo "Namespace creation blocked: Parent network namespace ID is empty."
    exit 1
  fi
  printf 'Runner UID/GID: %s/%s\n' "$host_uid" "$host_gid"
  printf 'Parent user namespace: %s\n' "$parent_user_namespace"
  printf 'Parent network namespace: %s\n' "$parent_network_namespace"
  validate_parent_id_map uid_map /proc/self/uid_map "$host_uid" || exit $?
  validate_parent_id_map gid_map /proc/self/gid_map "$host_gid" || exit $?
  printf 'Namespace command: /usr/bin/unshare --user --map-current-user --net -- /bin/sh -eu -c <verify namespace maps>\n'
  if output=$(AETHER_HOST_UID="$host_uid" \
    AETHER_HOST_GID="$host_gid" \
    AETHER_PARENT_USER_NAMESPACE="$parent_user_namespace" \
    AETHER_PARENT_NETWORK_NAMESPACE="$parent_network_namespace" \
    /usr/bin/unshare --user --map-current-user --net -- /bin/sh -eu -c '
      printf "Child uid_map: "; cat /proc/self/uid_map
      set -- $(cat /proc/self/uid_map)
      test "$#" -eq 3 && test "$1" -eq "$AETHER_HOST_UID" \
        && test "$2" -eq "$AETHER_HOST_UID" && test "$3" -eq 1
      printf "Child gid_map: "; cat /proc/self/gid_map
      set -- $(cat /proc/self/gid_map)
      test "$#" -eq 3 && test "$1" -eq "$AETHER_HOST_GID" \
        && test "$2" -eq "$AETHER_HOST_GID" && test "$3" -eq 1
      test "$(id -u)" -eq "$AETHER_HOST_UID"
      test "$(id -g)" -eq "$AETHER_HOST_GID"
      user_namespace="$(readlink /proc/self/ns/user)"
      network_namespace="$(readlink /proc/self/ns/net)"
      printf "Child user namespace: %s\n" "$user_namespace"
      printf "Child network namespace: %s\n" "$network_namespace"
      if [ -z "$user_namespace" ]; then
        echo "Child user namespace ID is empty." >&2
        exit 1
      fi
      if [ -z "$network_namespace" ]; then
        echo "Child network namespace ID is empty." >&2
        exit 1
      fi
      test "$user_namespace" != "$AETHER_PARENT_USER_NAMESPACE"
      test "$network_namespace" != "$AETHER_PARENT_NETWORK_NAMESPACE"
    ' 2>&1); then
    echo "User/network namespace creation and UID/GID mapping succeeded."
    if [[ -n "$output" ]]; then
      printf '%s\n' "$output"
    fi
  else
    status=$?
    printf 'Namespace creation failed (exit status %s).\n' "$status"
    printf 'Failure reason: %s\n' "$output"
    collect_namespace_audit_diagnostics() {
      local source="$1"
      shift
      local diagnostic_output
      local relevant_records
      if ! command -v "$source" >/dev/null 2>&1; then
        printf '%s: unavailable\n' "$source"
        return 0
      fi
      if diagnostic_output=$("$source" "$@" 2>&1); then
        relevant_records="$(printf '%s\n' "$diagnostic_output" \
          | grep -Ei 'apparmor=.*(DENIED|userns|uid_map|gid_map)|apparmor.*(userns|uid_map|gid_map)|userns.*(DENIED|denied)|uid_map.*(DENIED|denied|Operation not permitted)|gid_map.*(DENIED|denied|Operation not permitted)' \
          | tail -n 40 || true)"
        if [[ -n "$relevant_records" ]]; then
          printf '%s relevant namespace/AppArmor records:\n%s\n' "$source" "$relevant_records"
        else
          printf '%s: readable; no matching namespace/AppArmor records\n' "$source"
        fi
      else
        diagnostic_status=$?
        printf '%s: unavailable or denied (diagnostic exit %s): %s\n' \
          "$source" "$diagnostic_status" "$diagnostic_output"
      fi
    }
    collect_namespace_audit_diagnostics dmesg --color=never
    collect_namespace_audit_diagnostics journalctl -k --no-pager -n 500
    if [[ "$output" == *"write failed /proc/self/uid_map"* \
      && "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true)" == "1" ]]; then
      echo "Likely cause: AppArmor unprivileged-userns restriction is enabled; this is not conclusive without runner kernel audit evidence."
      echo "No AppArmor or sysctl policy was changed. Use a runner that permits the required rootless UID/GID mapping."
    fi
    exit "$status"
  fi
} 2>&1 | tee "$log_file"

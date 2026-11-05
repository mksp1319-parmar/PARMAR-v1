#!/usr/bin/env bash

set +e
set -o pipefail

# Stage order: output sinks, diagnostic setup, required tools, parent identity,
# parent UID map, parent GID map, namespace command with child maps and identity,
# capture completion, optional audit, diagnostic formatting, and final replay.
# Child events are trusted private-file records; child stdout/stderr are never
# interpreted as status. A namespace failure outranks capture, formatting,
# cleanup, and sink failures; otherwise the first preflight/diagnostic error
# wins, then cleanup, then console/log delivery.

if [[ $# -ne 1 || -z "${AETHER_EVIDENCE_DIR:-}" ]]; then
  echo "Usage: AETHER_EVIDENCE_DIR=<directory> $0 <log-file>" >&2
  exit 2
fi

log_file="$1"
umask 077
if ! mkdir -p -- "$(dirname -- "$log_file")" 2>/dev/null; then
  printf 'Unable to create the namespace preflight log directory.\n' >&2
  exit 1
fi
if [[ -L "$log_file" ]]; then
  printf 'The namespace preflight log path must not be a symbolic link.\n' >&2
  exit 1
fi

# Captured payload accounting includes prefixes, escaped bytes, newlines, and
# the truncation record. Trusted stage/status lines and fixed audit headers are
# outside that budget.
MAX_CAPTURE_BYTES=4096
MAX_DIAGNOSTIC_LINES=40
MAX_DIAGNOSTIC_BYTES=4096
diagnostic_sink_status=0
stdout_sink_status=0
log_sink_status=0
cleanup_status=0
namespace_pid=
stdout_capture_pid=
stderr_capture_pid=
resources_active=0
output_stage_done=0
interrupted_status=0
namespace_status=
namespace_started=0
namespace_setup_status=0
stdout_capture_status=0
stderr_capture_status=0
formatter_status=0
audit_capture_status=0
log_writer_pid=
log_writer_input_fd=
log_writer_output_fd=
log_writer_ready=0

record_output_failure() {
  local status="$1"
  if (( status != 0 && diagnostic_sink_status == 0 )); then
    diagnostic_sink_status="$status"
  fi
}

emit() {
  local message="$1"
  local status
  trap '' PIPE
  printf '%s\n' "$message"
  status=$?
  trap - PIPE
  if (( status != 0 && stdout_sink_status == 0 )); then
    stdout_sink_status="$status"
  fi
  if (( log_writer_ready != 0 )); then
    trap '' PIPE
    printf '%s\n' "$message" >&3
    status=$?
    trap - PIPE
    if (( status != 0 && log_sink_status == 0 )); then
      log_sink_status="$status"
    fi
  fi
}

start_log_writer() {
  local open_result=
  local wait_status=0
  coproc AETHER_LOG_WRITER {
    perl -e '
      use strict;
      use warnings;
      use Fcntl qw(O_WRONLY O_CREAT O_NOFOLLOW O_NONBLOCK);

      $| = 1;
      my $path = shift @ARGV;
      sysopen(my $log, $path, O_WRONLY | O_CREAT | O_NOFOLLOW | O_NONBLOCK, 0600)
        or do { print STDOUT "OPEN_FAILED\n"; exit 1; };
      if (!-f $log || !binmode($log) || !binmode(STDIN) || !truncate($log, 0)) {
        close $log;
        print STDOUT "OPEN_FAILED\n";
        exit 1;
      }
      print STDOUT "READY\n" or exit 1;
      my $sink_failed = 0;
      while (1) {
        my $count = sysread(STDIN, my $buffer, 65536);
        if (!defined $count) {
          next if $!{EINTR};
          $sink_failed = 1;
          last;
        }
        last if $count == 0;
        next if $sink_failed;
        my $offset = 0;
        while ($offset < $count) {
          my $written = syswrite($log, $buffer, $count - $offset, $offset);
          if (!defined $written) {
            next if $!{EINTR};
            $sink_failed = 1;
            last;
          }
          if ($written == 0) {
            $sink_failed = 1;
            last;
          }
          $offset += $written;
        }
      }
      close $log or $sink_failed = 1;
      exit $sink_failed ? 74 : 0;
    ' -- "$log_file"
  }
  log_writer_pid="${AETHER_LOG_WRITER_PID:-}"
  log_writer_input_fd="${AETHER_LOG_WRITER[1]:-}"
  log_writer_output_fd="${AETHER_LOG_WRITER[0]:-}"
  if [[ -z "$log_writer_pid" || -z "$log_writer_input_fd" || -z "$log_writer_output_fd" ]]; then
    printf 'Unable to start the secure namespace preflight log writer.\n' >&2
    return 1
  fi
  if IFS= read -r -t 10 open_result <&"$log_writer_output_fd" \
    && [[ "$open_result" == READY ]] \
    && exec 3>&"$log_writer_input_fd"; then
    exec {log_writer_input_fd}>&-
    exec {log_writer_output_fd}<&-
    log_writer_ready=1
    return 0
  fi
  exec {log_writer_input_fd}>&- || :
  exec {log_writer_output_fd}<&- || :
  kill -KILL "$log_writer_pid" 2>/dev/null || :
  wait "$log_writer_pid" 2>/dev/null
  wait_status=$?
  log_writer_pid=
  log_writer_input_fd=
  log_writer_output_fd=
  if (( wait_status == 0 )); then
    wait_status=1
  fi
  return "$wait_status"
}

finish_log_writer() {
  local status=0
  if (( log_writer_ready != 0 )); then
    exec 3>&-
    log_writer_ready=0
    wait "$log_writer_pid"
    status=$?
    log_writer_pid=
  elif [[ -n "$log_writer_pid" ]]; then
    exec {log_writer_input_fd}>&- || :
    exec {log_writer_output_fd}<&- || :
    kill -KILL "$log_writer_pid" 2>/dev/null || :
    wait "$log_writer_pid" 2>/dev/null
    status=$?
    log_writer_pid=
    log_writer_input_fd=
    log_writer_output_fd=
  fi
  if (( status != 0 )); then
    if (( log_sink_status == 0 )); then
      log_sink_status="$status"
    fi
    printf 'Namespace preflight log writer failed (exit code %s).\n' "$status" >&2 || :
  fi
  return "$status"
}

cleanup_workspace() {
  local status=0
  local path
  if (( resources_active == 0 )); then
    return 0
  fi
  for path in \
    "$stdout_file" "$stderr_file" "$stdout_truncated_file" "$stderr_truncated_file" \
    "$stage_events_file" "$formatted_file" "$audit_dmesg_file" "$audit_journal_file" \
    "$audit_dmesg_truncated_file" "$audit_journal_truncated_file" "$audit_empty_file" \
    "$diagnostic_directory/dmesg.filtered" "$diagnostic_directory/journalctl.filtered"; do
    if [[ -n "$path" ]]; then
      rm -f -- "$path" 2>/dev/null
      local remove_status=$?
      if (( remove_status != 0 )); then
        if (( status == 0 )); then
          status="$remove_status"
        fi
      fi
    fi
  done
  if [[ -n "${diagnostic_directory:-}" ]]; then
    rmdir -- "$diagnostic_directory" 2>/dev/null
    local directory_status=$?
    if (( directory_status != 0 )); then
      if (( status == 0 )); then
        status="$directory_status"
      fi
    fi
  fi
  resources_active=0
  return "$status"
}

reap_background_processes() {
  local pid
  for pid in "$namespace_pid" "$stdout_capture_pid" "$stderr_capture_pid"; do
    if [[ -n "$pid" ]]; then
      kill -KILL "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
    fi
  done
  namespace_pid=
  stdout_capture_pid=
  stderr_capture_pid=
}

handle_signal() {
  local signal_status="$1"
  if (( interrupted_status == 0 )); then
    interrupted_status="$signal_status"
  fi
  if [[ -n "$namespace_pid" ]]; then
    kill -TERM "$namespace_pid" 2>/dev/null || :
    kill -KILL "$namespace_pid" 2>/dev/null || :
  fi
}

handle_exit() {
  local exit_status="$1"
  local status
  trap - EXIT
  if [[ -n "$namespace_pid" || -n "$stdout_capture_pid" || -n "$stderr_capture_pid" ]]; then
    reap_background_processes
  fi
  if (( resources_active != 0 )); then
    cleanup_workspace
    status=$?
    if (( exit_status == 0 && status != 0 )); then
      exit_status="$status"
    fi
  fi
  if (( output_stage_done == 0 )); then
    if (( stdout_sink_status == 0 && log_sink_status == 0 )); then
      emit 'STAGE COMPLETE: Diagnostic output sinks'
    else
      emit 'STAGE FAILURE: Diagnostic output sinks'
    fi
    output_stage_done=1
  fi
  finish_log_writer || :
  if (( exit_status == 0 && stdout_sink_status != 0 )); then
    exit_status="$stdout_sink_status"
  elif (( exit_status == 0 && log_sink_status != 0 )); then
    exit_status="$log_sink_status"
  fi
  exit "$exit_status"
}

trap 'handle_exit "$?"' EXIT
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap 'handle_signal 129' HUP

if ! start_log_writer; then
  printf 'Unable to securely open the namespace preflight log file.\n' >&2
  output_stage_done=1
  exit 1
fi

emit 'STAGE START: Diagnostic output sinks'
emit 'STAGE START: Namespace diagnostic setup'
if ! mkdir -p -- "$AETHER_EVIDENCE_DIR" 2>/dev/null; then
  emit 'STAGE FAILURE: Namespace diagnostic setup (exit code 1)'
  exit 1
fi
diagnostic_directory="$(mktemp -d "${AETHER_EVIDENCE_DIR%/}/.namespace-preflight.XXXXXX" 2>/dev/null)"
mktemp_status=$?
if [[ -n "$diagnostic_directory" ]]; then
  resources_active=1
  stdout_file="$diagnostic_directory/stdout"
  stderr_file="$diagnostic_directory/stderr"
  stdout_truncated_file="$diagnostic_directory/stdout.truncated"
  stderr_truncated_file="$diagnostic_directory/stderr.truncated"
  stage_events_file="$diagnostic_directory/stage-events"
  formatted_file="$diagnostic_directory/formatted"
  audit_dmesg_file="$diagnostic_directory/audit-dmesg"
  audit_journal_file="$diagnostic_directory/audit-journal"
  audit_dmesg_truncated_file="$diagnostic_directory/audit-dmesg.truncated"
  audit_journal_truncated_file="$diagnostic_directory/audit-journal.truncated"
  audit_empty_file="$diagnostic_directory/audit-empty"
  dmesg_include_file="$audit_dmesg_file"
  dmesg_include_truncated_file="$audit_dmesg_truncated_file"
  journalctl_include_file="$audit_journal_file"
  journalctl_include_truncated_file="$audit_journal_truncated_file"
fi
if (( mktemp_status != 0 )) || [[ -z "$diagnostic_directory" ]]; then
  emit 'STAGE FAILURE: Namespace diagnostic setup (exit code 1)'
  exit 1
fi
if ! : > "$stdout_file" || ! : > "$stderr_file" || ! : > "$stage_events_file" \
  || ! : > "$audit_dmesg_file" || ! : > "$audit_journal_file" || ! : > "$audit_empty_file"; then
  emit 'STAGE FAILURE: Namespace diagnostic setup (exit code 1)'
  exit 1
fi
emit 'STAGE COMPLETE: Namespace diagnostic setup'

capture_bounded_stream() {
  local capture_file="$1"
  local truncation_file="$2"
  local stream_name="$3"
  local capture_status=0
  local extra_bytes
  local drain_status=0
  AETHER_CAPTURE_STREAM="$stream_name" head -c "$MAX_CAPTURE_BYTES" \
    > "$capture_file" 2>/dev/null || capture_status=$?
  extra_bytes=$(/bin/cat | wc -c 2>/dev/null) || drain_status=$?
  if (( drain_status == 0 )) && [[ "$extra_bytes" =~ [1-9] ]]; then
    : > "$truncation_file" || {
      local flag_status=$?
      if (( capture_status == 0 )); then
        capture_status="$flag_status"
      fi
    }
  fi
  if (( capture_status != 0 )); then
    return "$capture_status"
  fi
  return "$drain_status"
}

format_captured_streams() {
  local source
  local file
  local truncated_file
  local format_status=0
  local od_status=0
  local awk_status=0
  : > "$formatted_file" || return $?
  {
    while (( $# > 0 )); do
      source="$1"
      file="$2"
      truncated_file="$3"
      shift 3
      printf 'S %s\n' "$source"
      if [[ -f "$truncated_file" ]]; then
        printf 'T\n'
      fi
      LC_ALL=C od -An -v -tu1 -w1 -- "$file" 2>/dev/null || exit $?
    done
  } | LC_ALL=C awk -v max_lines="$MAX_DIAGNOSTIC_LINES" \
    -v max_bytes="$MAX_DIAGNOSTIC_BYTES" '
      function save_line(    candidate) {
        candidate = "  | " stream ": " line
        count++
        records[count] = candidate
        total_bytes += length(candidate) + 1
        line = ""
      }
      /^S (stdout|stderr|dmesg|journalctl)$/ {
        if (stream != "" && have_bytes) {
          save_line()
          have_bytes = 0
        }
        stream = substr($0, 3)
        next
      }
      /^T$/ {
        raw_truncated = 1
        next
      }
      {
        value = $1 + 0
        if (value == 10) {
          save_line()
          have_bytes = 0
          saw_byte = 1
          next
        }
        if (value >= 32 && value <= 126) {
          line = line sprintf("%c", value)
        } else {
          line = line sprintf("\\x%02X", value)
        }
        have_bytes = 1
        saw_byte = 1
      }
      END {
        if (have_bytes) save_line()
        marker = "  | diagnostic: [truncated]"
        truncated = raw_truncated || count > max_lines || total_bytes > max_bytes
        if (!truncated) {
          for (i = 1; i <= count; i++) print records[i]
          exit
        }
        byte_budget = max_bytes - length(marker) - 1
        line_budget = max_lines - 1
        used_bytes = 0
        used_lines = 0
        for (i = 1; i <= count && used_lines < line_budget; i++) {
          record = records[i]
          record_bytes = length(record) + 1
          if (used_bytes + record_bytes <= byte_budget) {
            print record
            used_bytes += record_bytes
            used_lines++
            continue
          }
          available = byte_budget - used_bytes - 1
          if (available > 0) {
            print substr(record, 1, available)
            used_lines++
          }
          break
        }
        print marker
      }
    ' 2>/dev/null > "$formatted_file"
  local -a pipeline_status=("${PIPESTATUS[@]}")
  od_status=${pipeline_status[0]}
  awk_status=${pipeline_status[1]}
  if (( od_status != 0 )); then
    format_status="$od_status"
  elif (( awk_status != 0 )); then
    format_status="$awk_status"
  fi
  return "$format_status"
}

emit_formatted_diagnostics() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    emit "$line"
  done < "$formatted_file"
}

run_two_stream_command() {
  local command_status=0
  local close_status=0
  local stdout_fd
  local stderr_fd
  local command_name="$1"
  shift
  if ! exec {stdout_fd}> >(capture_bounded_stream "$stdout_file" "$stdout_truncated_file" stdout); then
    stdout_capture_status=125
    return 125
  fi
  stdout_capture_pid=$!
  if ! exec {stderr_fd}> >(capture_bounded_stream "$stderr_file" "$stderr_truncated_file" stderr); then
    exec {stdout_fd}>&- 2>/dev/null || :
    wait "$stdout_capture_pid" 2>/dev/null || :
    stdout_capture_pid=
    stderr_capture_status=125
    return 125
  fi
  stderr_capture_pid=$!
  if [[ -z "$stdout_capture_pid" || -z "$stderr_capture_pid" ]]; then
    exec {stdout_fd}>&- 2>/dev/null || :
    exec {stderr_fd}>&- 2>/dev/null || :
    return 125
  fi
  "$command_name" "$@" >&"$stdout_fd" 2>&"$stderr_fd" &
  namespace_started=1
  namespace_pid=$!
  wait "$namespace_pid"
  command_status=$?
  namespace_pid=
  exec {stdout_fd}>&- || close_status=$?
  exec {stderr_fd}>&-
  local stderr_close_status=$?
  if (( stderr_close_status != 0 )); then
    if (( close_status == 0 )); then
      close_status="$stderr_close_status"
    fi
  fi
  if [[ -n "$stdout_capture_pid" ]]; then
    wait "$stdout_capture_pid"
    stdout_capture_status=$?
  fi
  stdout_capture_pid=
  if [[ -n "$stderr_capture_pid" ]]; then
    wait "$stderr_capture_pid"
    stderr_capture_status=$?
  fi
  stderr_capture_pid=
  if (( interrupted_status != 0 )); then
    command_status="$interrupted_status"
  fi
  if (( close_status != 0 )); then
    record_output_failure "$close_status"
  fi
  return "$command_status"
}

run_single_stream_command() {
  local output_file="$1"
  local truncated_file="$2"
  local command_status=0
  local capture_status=0
  local capture_fd
  shift 2
  if ! exec {capture_fd}> >(capture_bounded_stream "$output_file" "$truncated_file" audit); then
    return 125
  fi
  local capture_pid=$!
  if [[ -z "$capture_pid" ]]; then
    exec {capture_fd}>&- 2>/dev/null || :
    return 125
  fi
  "$@" >&"$capture_fd" 2>&1 &
  local command_pid=$!
  wait "$command_pid"
  command_status=$?
  exec {capture_fd}>&-
  capture_status=$?
  wait "$capture_pid"
  local reader_status=$?
  if (( capture_status == 0 )); then
    capture_status="$reader_status"
  fi
  if (( capture_status != 0 && audit_capture_status == 0 )); then
    audit_capture_status="$capture_status"
  fi
  return "$command_status"
}

report_child_events() {
  local event
  local detail
  local status
  local saw_uid_start=0
  local saw_uid_complete=0
  local saw_identity_start=0
  local saw_identity_complete=0
  local saw_failure=0
  while IFS=' ' read -r event detail status || [[ -n "$event${detail}${status}" ]]; do
    case "$event $detail" in
      'START child-map')
        (( saw_uid_start == 0 )) || return 74
        emit 'STAGE START: Child UID/GID-map validation'
        saw_uid_start=1
        ;;
      'COMPLETE child-map')
        (( saw_uid_start == 1 && saw_uid_complete == 0 )) || return 74
        emit 'STAGE COMPLETE: Child UID/GID-map validation'
        saw_uid_complete=1
        ;;
      'START identity')
        (( saw_uid_complete == 1 && saw_identity_start == 0 )) || return 74
        emit 'STAGE START: Namespace identity validation'
        saw_identity_start=1
        ;;
      'COMPLETE identity')
        (( saw_identity_start == 1 && saw_identity_complete == 0 )) || return 74
        emit 'STAGE COMPLETE: Namespace identity validation'
        saw_identity_complete=1
        ;;
      'FAIL child-map'|'FAIL identity')
        if [[ ! "$status" =~ ^[0-9]+$ ]] || (( saw_failure != 0 )); then
          return 74
        fi
        if [[ "$detail" == child-map ]]; then
          emit "STAGE FAILURE: Child UID/GID-map validation (exit code $status)"
        else
          emit "STAGE FAILURE: Namespace identity validation (exit code $status)"
        fi
        saw_failure=1
        ;;
      *)
        return 74
        ;;
    esac
  done < "$stage_events_file"
  if (( namespace_status == 0 )); then
    if (( saw_uid_start != 1 || saw_uid_complete != 1 \
      || saw_identity_start != 1 || saw_identity_complete != 1 || saw_failure != 0 )); then
      return 74
    fi
  elif (( saw_failure == 0 )); then
    if (( saw_uid_start == 1 && saw_uid_complete == 0 )); then
      emit 'STAGE FAILURE: Child UID/GID-map validation (exit code 1)'
    elif (( saw_identity_start == 1 && saw_identity_complete == 0 )); then
      emit 'STAGE FAILURE: Namespace identity validation (exit code 1)'
    fi
  fi
  return 0
}

validate_parent_id_map() {
  local map_name="$1"
  local map_path="$2"
  local expected_id="$3"
  local mapping
  local status
  local mapped_id
  local namespace_id
  local range_size
  if mapping=$(cat "$map_path" 2>/dev/null); then
    :
  else
    status=$?
    emit "Namespace creation blocked: Parent ${map_name} could not be read (exit status ${status})."
    emit 'Parent ID-map diagnostic was suppressed to keep process output inert.'
    return "$status"
  fi
  if [[ "$mapping" == *$'\n'* ]] \
    || [[ ! "$mapping" =~ ^[[:blank:]]*([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]+([0-9]+)[[:blank:]]*$ ]]; then
    emit "Namespace creation blocked: Parent ${map_name} must contain exactly one mapping line with three numeric fields."
    return 1
  fi
  mapped_id="${BASH_REMATCH[1]}"
  namespace_id="${BASH_REMATCH[2]}"
  range_size="${BASH_REMATCH[3]}"
  if [[ "$mapped_id" != "$expected_id" || "$namespace_id" != "$expected_id" || "$range_size" != 1 ]]; then
    emit "Namespace creation blocked: Parent ${map_name} mapping must be ${expected_id} ${expected_id} 1."
    return 1
  fi
  emit "Parent ${map_name}: ${mapping}"
}

collect_namespace_audit_diagnostics() {
  local source="$1"
  local destination
  local truncation_file
  if [[ "$source" == dmesg ]]; then
    destination="$audit_dmesg_file"
    truncation_file="$audit_dmesg_truncated_file"
  else
    destination="$audit_journal_file"
    truncation_file="$audit_journal_truncated_file"
  fi
  shift
  local diagnostic_status
  local filtered_file="$diagnostic_directory/${source}.filtered"
  local include_variable="${source}_include_file"
  local truncation_variable="${source}_include_truncated_file"
  printf -v "$include_variable" '%s' "$destination"
  printf -v "$truncation_variable" '%s' "$truncation_file"
  if ! command -v "$source" >/dev/null 2>&1; then
    emit "$source: unavailable"
    return 0
  fi
  run_single_stream_command "$destination" "$truncation_file" "$source" "$@"
  diagnostic_status=$?
  if (( audit_capture_status != 0 )); then
    emit "$source: diagnostic capture failed (exit code $audit_capture_status)"
  fi
  if (( diagnostic_status == 0 )); then
    if grep -aEi \
      'apparmor=.*(DENIED|userns|uid_map|gid_map)|apparmor.*(userns|uid_map|gid_map)|userns.*(DENIED|denied)|uid_map.*(DENIED|denied|Operation not permitted)|gid_map.*(DENIED|denied|Operation not permitted)' \
      "$destination" > "$filtered_file"; then
      emit "$source relevant namespace/AppArmor records:"
      printf -v "$include_variable" '%s' "$filtered_file"
      printf -v "$truncation_variable" '%s' ''
    else
      local grep_status=$?
      if (( grep_status == 1 )); then
        emit "$source: readable; no matching namespace/AppArmor records"
        printf -v "$include_variable" '%s' "$audit_empty_file"
        printf -v "$truncation_variable" '%s' ''
      else
        emit "$source: diagnostic filtering failed (exit code $grep_status)"
        record_output_failure "$grep_status"
        printf -v "$include_variable" '%s' "$audit_empty_file"
        printf -v "$truncation_variable" '%s' ''
      fi
    fi
  else
    emit "$(printf '%s: unavailable or denied (diagnostic exit %s); raw output suppressed.' \
      "$source" "$diagnostic_status")"
    record_output_failure "$diagnostic_status"
    printf -v "$include_variable" '%s' "$audit_empty_file"
    printf -v "$truncation_variable" '%s' ''
  fi
}

run_preflight() {
  local status
  local tool
  local setting
  local host_uid
  local host_gid
  local parent_user_namespace
  local parent_network_namespace
  local child_events_status
  local diagnostic_format_status
  local tool_status=0

  emit 'STAGE START: Required-tool checks'
  for tool in /usr/bin/unshare /usr/bin/setpriv /usr/sbin/ip; do
    if [[ ! -x "$tool" ]]; then
      emit 'STAGE FAILURE: Required-tool checks (exit code 127)'
      emit "Namespace creation blocked: required tool is missing: $tool"
      return 127
    fi
  done
  emit 'STAGE COMPLETE: Required-tool checks'

  for setting in \
    /proc/sys/kernel/apparmor_restrict_unprivileged_userns \
    /proc/sys/kernel/unprivileged_userns_clone \
    /proc/sys/user/max_user_namespaces \
    /proc/self/attr/current; do
    if [[ -r "$setting" ]]; then
      emit "$setting: available"
    else
      emit "$setting: unavailable"
    fi
  done
  emit 'STAGE START: Parent namespace identity discovery'
  host_uid="$(id -u)" || {
    status=$?
    emit "STAGE FAILURE: Parent namespace identity discovery (exit code $status)"
    return "$status"
  }
  host_gid="$(id -g)" || {
    status=$?
    emit "STAGE FAILURE: Parent namespace identity discovery (exit code $status)"
    return "$status"
  }
  if parent_user_namespace="$(readlink /proc/self/ns/user 2>/dev/null)"; then
    :
  else
    status=$?
    emit "STAGE FAILURE: Parent namespace identity discovery (exit code $status)"
    emit 'Namespace creation blocked: Parent user namespace ID could not be read.'
    return "$status"
  fi
  if parent_network_namespace="$(readlink /proc/self/ns/net 2>/dev/null)"; then
    :
  else
    status=$?
    emit "STAGE FAILURE: Parent namespace identity discovery (exit code $status)"
    emit 'Namespace creation blocked: Parent network namespace ID could not be read.'
    return "$status"
  fi
  if [[ -z "$parent_user_namespace" ]]; then
    emit 'STAGE FAILURE: Parent namespace identity discovery (exit code 1)'
    emit 'Namespace creation blocked: Parent user namespace ID is empty.'
    return 1
  fi
  if [[ -z "$parent_network_namespace" ]]; then
    emit 'STAGE FAILURE: Parent namespace identity discovery (exit code 1)'
    emit 'Namespace creation blocked: Parent network namespace ID is empty.'
    return 1
  fi
  emit 'STAGE COMPLETE: Parent namespace identity discovery'
  emit "$(printf 'Runner UID/GID: %s/%s' "$host_uid" "$host_gid")"
  emit "Parent user namespace: $parent_user_namespace"
  emit "Parent network namespace: $parent_network_namespace"

  emit 'STAGE START: Parent UID-map validation'
  if validate_parent_id_map uid_map /proc/self/uid_map "$host_uid"; then
    emit 'STAGE COMPLETE: Parent UID-map validation'
  else
    status=$?
    emit "STAGE FAILURE: Parent UID-map validation (exit code $status)"
    return "$status"
  fi
  emit 'STAGE START: Parent GID-map validation'
  if validate_parent_id_map gid_map /proc/self/gid_map "$host_gid"; then
    emit 'STAGE COMPLETE: Parent GID-map validation'
  else
    status=$?
    emit "STAGE FAILURE: Parent GID-map validation (exit code $status)"
    return "$status"
  fi

  if (( interrupted_status != 0 )); then
    emit "STAGE FAILURE: Namespace command execution (exit code $interrupted_status)"
    return "$interrupted_status"
  fi
  emit 'Namespace command: /usr/bin/unshare --user --map-current-user --net -- /bin/sh -eu -c <verify namespace maps>'
  emit 'STAGE START: Namespace diagnostic capture'
  emit 'STAGE START: Namespace command execution'
  if AETHER_HOST_UID="$host_uid" \
    AETHER_HOST_GID="$host_gid" \
    AETHER_PARENT_USER_NAMESPACE="$parent_user_namespace" \
    AETHER_PARENT_NETWORK_NAMESPACE="$parent_network_namespace" \
    AETHER_STAGE_EVENTS_FILE="$stage_events_file" \
    AETHER_PREFLIGHT_PARENT_PID="$BASHPID" \
    run_two_stream_command /usr/bin/unshare --user --map-current-user --net -- /bin/sh -eu -c '
      record_stage_event() {
        printf "%s\n" "$1" >> "$AETHER_STAGE_EVENTS_FILE"
      }
      child_stage_failure() {
        event_name="$1"
        stage_name="$2"
        status="$3"
        message="$4"
        record_stage_event "FAIL $event_name $status" || :
        if [ -n "$message" ]; then
          printf "%s\n" "$message" >&2
        fi
        exit "$status"
      }

      record_stage_event "START child-map" || exit 74
      if uid_mapping="$(cat /proc/self/uid_map 2>/dev/null)"; then
        printf "Child uid_map: %s\n" "$uid_mapping"
      else
        status=$?
        child_stage_failure child-map "Child UID/GID-map validation" "$status" "Child uid_map could not be read."
      fi
      set -- $uid_mapping
      if test "$#" -eq 3 && test "$1" -eq "$AETHER_HOST_UID" \
        && test "$2" -eq "$AETHER_HOST_UID" && test "$3" -eq 1; then
        :
      else
        child_stage_failure child-map "Child UID/GID-map validation" 1 \
          "Child uid_map does not match $AETHER_HOST_UID $AETHER_HOST_UID 1."
      fi
      if gid_mapping="$(cat /proc/self/gid_map 2>/dev/null)"; then
        printf "Child gid_map: %s\n" "$gid_mapping"
      else
        status=$?
        child_stage_failure child-map "Child UID/GID-map validation" "$status" "Child gid_map could not be read."
      fi
      set -- $gid_mapping
      if test "$#" -eq 3 && test "$1" -eq "$AETHER_HOST_GID" \
        && test "$2" -eq "$AETHER_HOST_GID" && test "$3" -eq 1; then
        :
      else
        child_stage_failure child-map "Child UID/GID-map validation" 1 \
          "Child gid_map does not match $AETHER_HOST_GID $AETHER_HOST_GID 1."
      fi
      record_stage_event "COMPLETE child-map" || exit 74

      record_stage_event "START identity" || exit 74
      if child_uid="$(id -u 2>/dev/null)"; then
        :
      else
        status=$?
        child_stage_failure identity "Namespace identity validation" "$status" "Child UID could not be read."
      fi
      if child_gid="$(id -g 2>/dev/null)"; then
        :
      else
        status=$?
        child_stage_failure identity "Namespace identity validation" "$status" "Child GID could not be read."
      fi
      if [ "$child_uid" -eq "$AETHER_HOST_UID" ]; then
        :
      else
        child_stage_failure identity "Namespace identity validation" 1 \
          "Child UID $child_uid does not match runner UID $AETHER_HOST_UID."
      fi
      if [ "$child_gid" -eq "$AETHER_HOST_GID" ]; then
        :
      else
        child_stage_failure identity "Namespace identity validation" 1 \
          "Child GID $child_gid does not match runner GID $AETHER_HOST_GID."
      fi
      if user_namespace="$(readlink /proc/self/ns/user 2>/dev/null)"; then
        :
      else
        status=$?
        child_stage_failure identity "Namespace identity validation" "$status" "Child user namespace ID could not be read."
      fi
      if network_namespace="$(readlink /proc/self/ns/net 2>/dev/null)"; then
        :
      else
        status=$?
        child_stage_failure identity "Namespace identity validation" "$status" "Child network namespace ID could not be read."
      fi
      printf "Child user namespace: %s\n" "$user_namespace"
      printf "Child network namespace: %s\n" "$network_namespace"
      if [ -z "$user_namespace" ]; then
        child_stage_failure identity "Namespace identity validation" 1 "Child user namespace ID is empty."
      fi
      if [ -z "$network_namespace" ]; then
        child_stage_failure identity "Namespace identity validation" 1 "Child network namespace ID is empty."
      fi
      if test "$user_namespace" != "$AETHER_PARENT_USER_NAMESPACE"; then
        :
      else
        child_stage_failure identity "Namespace identity validation" 1 \
          "Child user namespace matches the parent namespace."
      fi
      if test "$network_namespace" != "$AETHER_PARENT_NETWORK_NAMESPACE"; then
        :
      else
        child_stage_failure identity "Namespace identity validation" 1 \
          "Child network namespace matches the parent namespace."
      fi
      record_stage_event "COMPLETE identity" || exit 74
    '; then
    namespace_status=0
  else
    status=$?
    if (( namespace_started != 0 )); then
      namespace_status="$status"
    else
      namespace_setup_status="$status"
    fi
  fi

  child_events_status=0
  if (( namespace_started != 0 )); then
    report_child_events || child_events_status=$?
  fi
  if (( child_events_status != 0 )); then
    record_output_failure "$child_events_status"
    emit "STAGE FAILURE: Child stage reporting (exit code $child_events_status)"
  fi
  if (( stdout_capture_status != 0 || stderr_capture_status != 0 )); then
    local capture_status="${stdout_capture_status:-0}"
    if (( capture_status == 0 )); then
      capture_status="$stderr_capture_status"
    fi
    emit "STAGE FAILURE: Namespace diagnostic capture (exit code $capture_status)"
    record_output_failure "$capture_status"
  else
    emit 'STAGE COMPLETE: Namespace diagnostic capture'
  fi
  if (( namespace_status != 0 )); then
    collect_namespace_audit_diagnostics dmesg --color=never
    collect_namespace_audit_diagnostics journalctl -k --no-pager -n 500
  fi
  if [[ -s "$stderr_file" ]]; then
    emit 'Captured stderr:'
  fi
  emit 'STAGE START: Namespace diagnostic formatting'
  format_captured_streams \
    stdout "$stdout_file" "$stdout_truncated_file" \
    stderr "$stderr_file" "$stderr_truncated_file" \
    dmesg "$dmesg_include_file" "$dmesg_include_truncated_file" \
    journalctl "$journalctl_include_file" "$journalctl_include_truncated_file"
  diagnostic_format_status=$?
  if (( diagnostic_format_status == 0 )); then
    emit_formatted_diagnostics
    emit 'STAGE COMPLETE: Namespace diagnostic formatting'
  else
    formatter_status="$diagnostic_format_status"
    emit "STAGE FAILURE: Namespace diagnostic formatting (exit code $formatter_status)"
    record_output_failure "$formatter_status"
  fi
  if (( namespace_setup_status != 0 )); then
    emit "Namespace command was not started because diagnostic capture setup failed (exit code $namespace_setup_status)."
    return "$namespace_setup_status"
  fi
  if (( namespace_status != 0 )); then
    if (( child_events_status == 0 )) && [[ ! -s "$stage_events_file" ]]; then
      emit "$(printf 'STAGE FAILURE: Namespace command execution (exit code %s)' "$namespace_status")"
    elif (( child_events_status == 0 )); then
      emit "STAGE COMPLETE: Namespace command execution (child validation rejected; exit code $namespace_status)"
    else
      emit "$(printf 'STAGE FAILURE: Namespace command execution (exit code %s)' "$namespace_status")"
    fi
    emit "$(printf 'Namespace creation failed (exit status %s).' "$namespace_status")"
    if grep -aFq 'write failed /proc/self/uid_map' "$stdout_file" "$stderr_file" \
      && [[ "$(/bin/cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || :)" == 1 ]]; then
      emit 'Likely cause: AppArmor unprivileged-userns restriction is enabled; this is not conclusive without runner kernel audit evidence.'
      emit 'No AppArmor or sysctl policy was changed. Use a runner that permits the required rootless UID/GID mapping.'
    fi
    return "$namespace_status"
  fi

  if (( child_events_status != 0 )); then
    emit 'Namespace command completed, but trusted child-stage reporting was incomplete.'
    return "$child_events_status"
  fi
  emit 'STAGE COMPLETE: Namespace command execution'
  if (( stdout_capture_status == 0 && stderr_capture_status == 0 \
    && formatter_status == 0 && stdout_sink_status == 0 && log_sink_status == 0 )); then
    emit 'User/network namespace creation and UID/GID mapping succeeded.'
    return 0
  fi
  emit 'Namespace command completed, but diagnostic capture or output delivery failed.'
  if (( diagnostic_sink_status != 0 )); then
    return "$diagnostic_sink_status"
  fi
  if (( audit_capture_status != 0 )); then
    return "$audit_capture_status"
  fi
  if (( stdout_capture_status != 0 )); then
    return "$stdout_capture_status"
  fi
  if (( stderr_capture_status != 0 )); then
    return "$stderr_capture_status"
  fi
  if (( formatter_status != 0 )); then
    return "$formatter_status"
  fi
  if (( stdout_sink_status != 0 )); then
    return "$stdout_sink_status"
  fi
  if (( log_sink_status != 0 )); then
    return "$log_sink_status"
  fi
  return 0
}

run_preflight
preflight_status=$?

cleanup_workspace
cleanup_status=$?
if (( cleanup_status != 0 )); then
  emit "STAGE FAILURE: Temporary resource cleanup (exit code $cleanup_status)"
  emit "Temporary resource cleanup failed (exit code $cleanup_status)."
fi

if (( stdout_sink_status == 0 && log_sink_status == 0 )); then
  emit 'STAGE COMPLETE: Diagnostic output sinks'
fi
if (( stdout_sink_status != 0 || log_sink_status != 0 )); then
  sink_status="$stdout_sink_status"
  if (( sink_status == 0 )); then
    sink_status="$log_sink_status"
  fi
  emit "STAGE FAILURE: Diagnostic output sinks (exit code $sink_status)"
fi
output_stage_done=1

if (( namespace_status != 0 )); then
  final_status="$namespace_status"
elif (( preflight_status != 0 )); then
  final_status="$preflight_status"
elif (( diagnostic_sink_status != 0 )); then
  final_status="$diagnostic_sink_status"
elif (( cleanup_status != 0 )); then
  final_status="$cleanup_status"
elif (( stdout_sink_status != 0 )); then
  final_status="$stdout_sink_status"
elif (( log_sink_status != 0 )); then
  final_status="$log_sink_status"
else
  final_status=0
fi
exit "$final_status"

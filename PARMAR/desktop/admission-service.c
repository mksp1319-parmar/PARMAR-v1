#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#define MAX_REQUEST_BYTES 4096
#define MAX_RESPONSE_BYTES 65536
#define IO_TIMEOUT_MS 5000
#define SOCKET_MODE 0660
#define SOCKET_PARENT_MODE 0750

typedef struct {
  const char *path;
  const char *state_dir;
  const char *node_path;
  const char *worker_path;
#ifdef AETHER_TESTING
  const char *test_anchor_state;
#endif
  uid_t service_uid;
  gid_t access_gid;
  uid_t admission_uid;
  uid_t browser_uid;
  uid_t lifecycle_uid;
  uid_t observer_uid;
  uid_t operator_uid;
  int has_service_uid;
  int has_access_gid;
  int has_lifecycle_uid;
  int has_observer_uid;
  int has_operator_uid;
  int has_admission_uid;
  int has_browser_uid;
  int listener_fd;
  int worker_in_fd;
  int worker_out_fd;
  int lock_fd;
  pid_t worker_pid;
  int worker_failed;
  dev_t socket_dev;
  ino_t socket_ino;
  char service_instance[33];
} service_config;

typedef struct {
  int version;
  char operation[32];
  char request_id[129];
  char generation_id[37];
  char instance_id[33];
  int has_generation_id;
  int has_instance_id;
} service_request;

static volatile sig_atomic_t stop_requested = 0;
static int write_all(int fd, const char *buffer, size_t length);

static void handle_signal(int signal_number) {
  (void)signal_number;
  stop_requested = 1;
}

static int parse_uid(const char *text, uid_t *uid) {
  if (text == NULL || *text == '\0') return -1;
  for (const char *cursor = text; *cursor != '\0'; ++cursor) {
    if (*cursor < '0' || *cursor > '9') return -1;
  }
  char *end = NULL;
  errno = 0;
  unsigned long value = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value > (unsigned long)((uid_t)-1)) {
    return -1;
  }
  *uid = (uid_t)value;
  return 0;
}

static int parse_gid(const char *text, gid_t *gid) {
  if (text == NULL || *text == '\0') return -1;
  for (const char *cursor = text; *cursor != '\0'; ++cursor) {
    if (*cursor < '0' || *cursor > '9') return -1;
  }
  char *end = NULL;
  errno = 0;
  unsigned long value = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value > (unsigned long)((gid_t)-1)) {
    return -1;
  }
  *gid = (gid_t)value;
  return 0;
}

static int parse_arguments(int argc, char **argv, service_config *config) {
  memset(config, 0, sizeof(*config));
  config->listener_fd = -1;
  config->worker_in_fd = -1;
  config->worker_out_fd = -1;
  config->lock_fd = -1;
  config->worker_pid = -1;

  for (int i = 1; i < argc; i += 2) {
    if (i + 1 >= argc) return -1;
    const char *name = argv[i];
    const char *value = argv[i + 1];
    if (strcmp(name, "--socket") == 0 && config->path == NULL) {
      config->path = value;
    } else if (strcmp(name, "--state-dir") == 0 && config->state_dir == NULL) {
      config->state_dir = value;
    } else if (strcmp(name, "--node") == 0 && config->node_path == NULL) {
      config->node_path = value;
    } else if (strcmp(name, "--worker") == 0 && config->worker_path == NULL) {
      config->worker_path = value;
#ifdef AETHER_TESTING
    } else if (strcmp(name, "--test-anchor-state") == 0
      && config->test_anchor_state == NULL && value[0] == '/') {
      config->test_anchor_state = value;
#endif
    } else if (strcmp(name, "--service-uid") == 0
      && !config->has_service_uid
      && parse_uid(value, &config->service_uid) == 0) {
      config->has_service_uid = 1;
    } else if (strcmp(name, "--access-gid") == 0
      && !config->has_access_gid
      && parse_gid(value, &config->access_gid) == 0) {
      config->has_access_gid = 1;
    } else if (strcmp(name, "--admission-uid") == 0
      && !config->has_admission_uid
      && parse_uid(value, &config->admission_uid) == 0) {
      config->has_admission_uid = 1;
    } else if (strcmp(name, "--browser-uid") == 0
      && !config->has_browser_uid
      && parse_uid(value, &config->browser_uid) == 0) {
      config->has_browser_uid = 1;
    } else if (strcmp(name, "--lifecycle-uid") == 0
      && !config->has_lifecycle_uid
      && parse_uid(value, &config->lifecycle_uid) == 0) {
      config->has_lifecycle_uid = 1;
    } else if (strcmp(name, "--observer-uid") == 0
      && !config->has_observer_uid
      && parse_uid(value, &config->observer_uid) == 0) {
      config->has_observer_uid = 1;
    } else if (strcmp(name, "--operator-uid") == 0
      && !config->has_operator_uid
      && parse_uid(value, &config->operator_uid) == 0) {
      config->has_operator_uid = 1;
    } else {
      return -1;
    }
  }

  if (config->path == NULL || config->state_dir == NULL
    || config->node_path == NULL || config->worker_path == NULL
    || config->path[0] != '/' || config->state_dir[0] != '/'
    || config->node_path[0] != '/'
    || config->worker_path[0] != '/' || !config->has_service_uid
    || !config->has_access_gid || !config->has_admission_uid
    || !config->has_browser_uid || !config->has_lifecycle_uid
    || !config->has_observer_uid || !config->has_operator_uid) {
    return -1;
  }
  if (config->admission_uid == config->browser_uid
    || config->admission_uid == config->lifecycle_uid
    || config->admission_uid == config->observer_uid
    || config->browser_uid == config->lifecycle_uid
    || config->browser_uid == config->observer_uid
    || config->lifecycle_uid == config->observer_uid
    || config->admission_uid == config->operator_uid
    || config->browser_uid == config->operator_uid
    || config->lifecycle_uid == config->operator_uid
    || config->observer_uid == config->operator_uid
    || config->service_uid == config->admission_uid
    || config->service_uid == config->browser_uid
    || config->service_uid == config->lifecycle_uid
    || config->service_uid == config->observer_uid
    || config->service_uid == config->operator_uid) {
    return -1;
  }
  return 0;
}

static int validate_executable(const char *path, int allow_root_owned) {
  char resolved[PATH_MAX];
  if (realpath(path, resolved) == NULL) return -1;
  struct stat st;
  if (stat(resolved, &st) != 0 || !S_ISREG(st.st_mode)) return -1;
  if (st.st_uid != geteuid() && !(allow_root_owned && st.st_uid == 0)) return -1;
  if ((st.st_mode & (S_IWGRP | S_IWOTH)) != 0 || access(resolved, X_OK) != 0) return -1;
  return 0;
}

static int validate_worker_file(const char *path) {
  char resolved[PATH_MAX];
  if (realpath(path, resolved) == NULL) return -1;
  struct stat st;
  if (stat(resolved, &st) != 0 || !S_ISREG(st.st_mode)) return -1;
  if ((st.st_uid != geteuid() && st.st_uid != 0)
    || (st.st_mode & (S_IWGRP | S_IWOTH)) != 0
    || access(resolved, R_OK) != 0) {
    return -1;
  }
  return 0;
}

static int validate_socket_parent(const char *socket_path) {
  char parent[PATH_MAX];
  size_t length = strlen(socket_path);
  if (length == 0 || length >= sizeof(parent)) return -1;
  memcpy(parent, socket_path, length + 1);
  char *slash = strrchr(parent, '/');
  if (slash == NULL) return -1;
  char *socket_name = slash + 1;
  if (*socket_name == '\0' || strcmp(socket_name, ".") == 0
    || strcmp(socket_name, "..") == 0) return -1;
  if (slash == parent) slash[1] = '\0';
  else *slash = '\0';

  char prefix[PATH_MAX];
  size_t prefix_length = 1;
  prefix[0] = '/';
  prefix[1] = '\0';
  const char *cursor = parent + 1;
  while (*cursor != '\0') {
    const char *component_start = cursor;
    while (*cursor != '\0' && *cursor != '/') ++cursor;
    size_t component_length = (size_t)(cursor - component_start);
    if (component_length == 0 || component_length > NAME_MAX
      || (component_length == 1 && component_start[0] == '.')
      || (component_length == 2 && component_start[0] == '.'
        && component_start[1] == '.')) return -1;
    if (prefix_length > 1) prefix[prefix_length++] = '/';
    if (prefix_length + component_length >= sizeof(prefix)) return -1;
    memcpy(prefix + prefix_length, component_start, component_length);
    prefix_length += component_length;
    prefix[prefix_length] = '\0';

    struct stat component_stat;
    if (lstat(prefix, &component_stat) != 0 || !S_ISDIR(component_stat.st_mode)) return -1;
    int is_parent = strcmp(prefix, parent) == 0;
    if (is_parent) {
      if (component_stat.st_uid != geteuid() || component_stat.st_gid != getegid()
        || (component_stat.st_mode & 07777) != SOCKET_PARENT_MODE) {
        return -1;
      }
    } else if ((component_stat.st_mode & (S_IWGRP | S_IWOTH)) != 0
      && !(component_stat.st_uid == 0
        && (component_stat.st_mode & S_ISVTX) != 0)) {
      return -1;
    }
    if (*cursor == '/') ++cursor;
  }

  struct stat parent_stat;
  if (lstat(parent, &parent_stat) != 0 || !S_ISDIR(parent_stat.st_mode)
    || parent_stat.st_uid != geteuid() || parent_stat.st_gid != getegid()
    || (parent_stat.st_mode & 0777) != SOCKET_PARENT_MODE) {
    return -1;
  }
  return 0;
}

static int validate_state_directory(const service_config *config) {
  char resolved[PATH_MAX];
  if (realpath(config->state_dir, resolved) == NULL
    || strcmp(resolved, config->state_dir) != 0) {
    errno = EACCES;
    return -1;
  }
  struct stat st;
  if (lstat(config->state_dir, &st) != 0 || !S_ISDIR(st.st_mode)
    || st.st_uid != config->service_uid || st.st_gid != config->access_gid
    || (st.st_mode & 07777) != 0700) {
    errno = EACCES;
    return -1;
  }
  return 0;
}

static int acquire_authority_lock(service_config *config) {
  char lock_path[PATH_MAX];
  const char *slash = strrchr(config->path, '/');
  if (slash == NULL) return -1;
  size_t parent_length = (size_t)(slash - config->path);
  if (parent_length == 0) parent_length = 1;
  const char *suffix = "/.aether-admission.lock";
  if (parent_length + strlen(suffix) >= sizeof(lock_path)) return -1;
  memcpy(lock_path, config->path, parent_length);
  lock_path[parent_length] = '\0';
  strncat(lock_path, suffix, sizeof(lock_path) - strlen(lock_path) - 1);

  mode_t previous_mask = umask(0177);
  int fd = open(lock_path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0600);
  int open_errno = errno;
  umask(previous_mask);
  if (fd < 0) {
    errno = open_errno;
    return -1;
  }
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode)
    || st.st_uid != config->service_uid || st.st_gid != config->access_gid
    || (st.st_mode & 07777) != 0600) {
    close(fd);
    errno = EACCES;
    return -1;
  }
  if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
    int saved_errno = errno;
    close(fd);
    errno = saved_errno;
    return -1;
  }
  config->lock_fd = fd;
  return 0;
}

static int fill_random_instance(char output[33]) {
  unsigned char bytes[16];
  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  size_t offset = 0;
  while (offset < sizeof(bytes)) {
    ssize_t count = read(fd, bytes + offset, sizeof(bytes) - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      close(fd);
      return -1;
    }
    offset += (size_t)count;
  }
  close(fd);
  for (size_t i = 0; i < sizeof(bytes); ++i) {
    snprintf(output + i * 2, 3, "%02x", bytes[i]);
  }
  output[32] = '\0';
  return 0;
}

static int write_all(int fd, const char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(fd, buffer + offset, length - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    offset += (size_t)count;
  }
  return 0;
}

static int wait_fd(int fd, short events) {
  struct pollfd descriptor = { .fd = fd, .events = events };
  int result;
  do {
    result = poll(&descriptor, 1, IO_TIMEOUT_MS);
  } while (result < 0 && errno == EINTR && !stop_requested);
  if (result <= 0 || (descriptor.revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) return -1;
  return (descriptor.revents & events) != 0 ? 0 : -1;
}

static int read_line(int fd, char *buffer, size_t capacity, size_t *length) {
  size_t used = 0;
  while (used + 1 < capacity) {
    if (wait_fd(fd, POLLIN) != 0) return -1;
    char ch;
    ssize_t count = read(fd, &ch, 1);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    if (ch == '\n') {
      buffer[used] = '\0';
      *length = used;
      return 0;
    }
    if (ch == '\0' || ch == '\r') return -1;
    buffer[used++] = ch;
  }
  return -1;
}

static void skip_space(const char **cursor) {
  while (**cursor == ' ' || **cursor == '\t' || **cursor == '\n') ++(*cursor);
}

static int parse_json_string(const char **cursor, char *output, size_t capacity) {
  if (**cursor != '"') return -1;
  ++(*cursor);
  size_t used = 0;
  while (**cursor != '\0' && **cursor != '"') {
    unsigned char ch = (unsigned char)**cursor;
    if (ch < 0x20 || ch > 0x7e || ch == '\\' || used + 1 >= capacity) return -1;
    output[used++] = (char)ch;
    ++(*cursor);
  }
  if (**cursor != '"') return -1;
  ++(*cursor);
  output[used] = '\0';
  return 0;
}

static int valid_request_id(const char *value) {
  size_t length = strlen(value);
  if (length == 0 || length > 128) return 0;
  for (size_t i = 0; i < length; ++i) {
    char ch = value[i];
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
      || (ch >= '0' && ch <= '9') || ch == '.' || ch == '_' || ch == ':'
      || ch == '-')) return 0;
  }
  return 1;
}

static int valid_generation_id(const char *value) {
  if (strlen(value) != 36) return 0;
  for (size_t i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (value[i] != '-') return 0;
    } else if (!((value[i] >= '0' && value[i] <= '9')
      || (value[i] >= 'a' && value[i] <= 'f')
      || (value[i] >= 'A' && value[i] <= 'F'))) {
      return 0;
    }
  }
  return 1;
}

static int valid_instance_id(const char *value) {
  if (strlen(value) != 32) return 0;
  for (size_t i = 0; i < 32; ++i) {
    if (!((value[i] >= '0' && value[i] <= '9')
      || (value[i] >= 'a' && value[i] <= 'f'))) return 0;
  }
  return 1;
}

static int valid_operation(const char *operation) {
  static const char *allowed[] = {
    "createGeneration", "startGeneration", "queryGeneration",
    "closeAdmission", "requestTermination", "verifyCleanup", "retrieveEvidence",
    "recoverGeneration", "serviceInfo",
  };
  for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); ++i) {
    if (strcmp(operation, allowed[i]) == 0) return 1;
  }
  return 0;
}

static int parse_request(const char *line, service_request *request) {
  memset(request, 0, sizeof(*request));
  const char *cursor = line;
  char keys[5][32];
  int key_count = 0;
  int version_seen = 0;
  int operation_seen = 0;
  int request_id_seen = 0;
  int generation_seen = 0;
  int instance_seen = 0;

  skip_space(&cursor);
  if (*cursor++ != '{') return -1;
  skip_space(&cursor);
  while (*cursor != '}') {
    if (key_count >= 5 || parse_json_string(&cursor, keys[key_count], sizeof(keys[key_count])) != 0) {
      return -1;
    }
    for (int i = 0; i < key_count; ++i) {
      if (strcmp(keys[i], keys[key_count]) == 0) return -1;
    }
    ++key_count;
    skip_space(&cursor);
    if (*cursor++ != ':') return -1;
    skip_space(&cursor);

    if (strcmp(keys[key_count - 1], "version") == 0) {
      if (version_seen || *cursor < '0' || *cursor > '9') return -1;
      char *end = NULL;
      long value = strtol(cursor, &end, 10);
      if (end == cursor || value != 1) return -2;
      request->version = (int)value;
      version_seen = 1;
      cursor = end;
    } else if (strcmp(keys[key_count - 1], "operation") == 0) {
      if (operation_seen || parse_json_string(&cursor, request->operation,
        sizeof(request->operation)) != 0) return -1;
      operation_seen = 1;
    } else if (strcmp(keys[key_count - 1], "requestId") == 0) {
      if (request_id_seen || parse_json_string(&cursor, request->request_id,
        sizeof(request->request_id)) != 0) return -1;
      request_id_seen = 1;
    } else if (strcmp(keys[key_count - 1], "generationId") == 0) {
      if (generation_seen || parse_json_string(&cursor, request->generation_id,
        sizeof(request->generation_id)) != 0) return -1;
      request->has_generation_id = 1;
      generation_seen = 1;
    } else if (strcmp(keys[key_count - 1], "serviceInstanceId") == 0) {
      if (instance_seen || parse_json_string(&cursor, request->instance_id,
        sizeof(request->instance_id)) != 0) return -1;
      request->has_instance_id = 1;
      instance_seen = 1;
    } else {
      return -1;
    }
    skip_space(&cursor);
    if (*cursor == ',') {
      ++cursor;
      skip_space(&cursor);
    } else if (*cursor != '}') {
      return -1;
    }
  }
  ++cursor;
  skip_space(&cursor);
  if (*cursor != '\0' || !version_seen || !operation_seen || !request_id_seen
    || !valid_request_id(request->request_id) || !valid_operation(request->operation)) {
    return -1;
  }
  if (strcmp(request->operation, "createGeneration") == 0) {
    if (request->has_generation_id || !request->has_instance_id || key_count != 4) return -1;
  } else if (strcmp(request->operation, "serviceInfo") == 0) {
    if (request->has_generation_id || request->has_instance_id || key_count != 3) return -1;
  } else if (!request->has_generation_id || !valid_generation_id(request->generation_id)
    || !request->has_instance_id || key_count != 5) {
    return -1;
  }
  if (request->has_instance_id && !valid_instance_id(request->instance_id)) return -1;
  if (!request->has_instance_id && strcmp(request->operation, "serviceInfo") != 0) return -1;
  return 0;
}

static const char *role_for_uid(const service_config *config, uid_t uid) {
  if (uid == config->admission_uid) return "admission";
  if (config->has_lifecycle_uid && uid == config->lifecycle_uid) return "lifecycle";
  if (config->has_observer_uid && uid == config->observer_uid) return "observer";
  if (config->has_operator_uid && uid == config->operator_uid) return "operator";
  return NULL;
}

static int role_allows(const char *role, const char *operation) {
  if (strcmp(operation, "createGeneration") == 0 || strcmp(operation, "startGeneration") == 0
    || strcmp(operation, "closeAdmission") == 0) {
    return strcmp(role, "admission") == 0;
  }
  if (strcmp(operation, "requestTermination") == 0) return strcmp(role, "lifecycle") == 0;
  if (strcmp(operation, "verifyCleanup") == 0) return strcmp(role, "observer") == 0;
  if (strcmp(operation, "recoverGeneration") == 0) return strcmp(role, "operator") == 0;
  if (strcmp(operation, "queryGeneration") == 0) {
    return strcmp(role, "admission") == 0 || strcmp(role, "lifecycle") == 0
      || strcmp(role, "observer") == 0;
  }
  if (strcmp(operation, "retrieveEvidence") == 0) {
    return strcmp(role, "lifecycle") == 0 || strcmp(role, "observer") == 0;
  }
  return 0;
}

static int send_error(int fd, const char *code, const char *message) {
  char response[512];
  int length = snprintf(response, sizeof(response),
    "{\"ok\":false,\"error\":{\"code\":\"%s\",\"message\":\"%s\"}}\n", code, message);
  if (length < 0 || (size_t)length >= sizeof(response)) return -1;
  return write_all(fd, response, (size_t)length);
}

static int start_worker(service_config *config) {
  int to_worker[2];
  int from_worker[2];
  if (pipe2(to_worker, O_CLOEXEC) != 0 || pipe2(from_worker, O_CLOEXEC) != 0) return -1;
  pid_t child = fork();
  if (child < 0) return -1;
  if (child == 0) {
    if (dup2(to_worker[0], STDIN_FILENO) < 0 || dup2(from_worker[1], STDOUT_FILENO) < 0) _exit(126);
    if (close_range(3, UINT_MAX, 0) != 0) {
      if (errno != ENOSYS && errno != EINVAL) _exit(126);
      struct rlimit descriptor_limit;
      if (getrlimit(RLIMIT_NOFILE, &descriptor_limit) != 0) _exit(126);
      rlim_t maximum_fd = descriptor_limit.rlim_cur;
      if (maximum_fd == RLIM_INFINITY) maximum_fd = 1048576;
      for (int fd = 3; (rlim_t)fd < maximum_fd; ++fd) close(fd);
    }
    char *child_argv[9];
    size_t child_argc = 0;
    child_argv[child_argc++] = (char *)config->node_path;
    child_argv[child_argc++] = (char *)config->worker_path;
    child_argv[child_argc++] = (char *)"--state-dir";
    child_argv[child_argc++] = (char *)config->state_dir;
    child_argv[child_argc++] = (char *)"--service-instance-id";
    child_argv[child_argc++] = (char *)config->service_instance;
#ifdef AETHER_TESTING
    if (config->test_anchor_state != NULL) {
      child_argv[child_argc++] = (char *)"--test-anchor-state";
      child_argv[child_argc++] = (char *)config->test_anchor_state;
    }
#endif
    child_argv[child_argc] = NULL;
#ifdef AETHER_TESTING
    char *const child_environment[] = {
      "PATH=/usr/bin:/bin",
      "HOME=/nonexistent",
      "AETHER_ADMISSION_TESTING=1",
      NULL,
    };
#else
    char *const child_environment[] = {
      "PATH=/usr/bin:/bin",
      "HOME=/nonexistent",
      NULL,
    };
#endif
    execve(config->node_path, child_argv, child_environment);
    _exit(127);
  }
  close(to_worker[0]);
  close(from_worker[1]);
  config->worker_pid = child;
  config->worker_in_fd = to_worker[1];
  config->worker_out_fd = from_worker[0];
  char ready[64];
  size_t ready_length = 0;
  if (read_line(config->worker_out_fd, ready, sizeof(ready), &ready_length) != 0
    || strcmp(ready, "{\"ready\":true}") != 0) {
    errno = EIO;
    return -1;
  }
  return 0;
}

static int relay_to_worker(service_config *config, const char *role,
  const service_request *request, const char *raw_request, int client_fd) {
  char envelope[MAX_REQUEST_BYTES + 256];
  char contract_request[MAX_REQUEST_BYTES];
  int contract_length;
  if (request->has_generation_id) {
    contract_length = snprintf(contract_request, sizeof(contract_request),
      "{\"version\":%d,\"operation\":\"%s\",\"requestId\":\"%s\",\"generationId\":\"%s\"}",
      request->version, request->operation, request->request_id, request->generation_id);
  } else {
    contract_length = snprintf(contract_request, sizeof(contract_request),
      "{\"version\":%d,\"operation\":\"%s\",\"requestId\":\"%s\"}",
      request->version, request->operation, request->request_id);
  }
  if (contract_length < 0 || (size_t)contract_length >= sizeof(contract_request)) {
    return send_error(client_fd, "INVALID_MESSAGE", "Request could not be normalized.");
  }
  int length = snprintf(envelope, sizeof(envelope),
    "{\"role\":\"%s\",\"request\":%s}\n", role, contract_request);
  if (length < 0 || (size_t)length >= sizeof(envelope)
    || write_all(config->worker_in_fd, envelope, (size_t)length) != 0) {
    config->worker_failed = 1;
    return send_error(client_fd, "WORKER_UNAVAILABLE", "Admission contract worker is unavailable.");
  }
  (void)raw_request;

  char response[MAX_RESPONSE_BYTES];
  size_t response_length = 0;
  if (read_line(config->worker_out_fd, response, sizeof(response), &response_length) != 0) {
    config->worker_failed = 1;
    return send_error(client_fd, "WORKER_UNAVAILABLE", "Admission contract worker did not respond.");
  }
  (void)request;
  if (response_length > 0 && response[0] == '{') {
    return write_all(client_fd, response, response_length)
      || write_all(client_fd, "\n", 1) ? -1 : 0;
  }
  config->worker_failed = 1;
  return send_error(client_fd, "WORKER_PROTOCOL_ERROR", "Admission contract worker returned an invalid response.");
}

static int handle_client(service_config *config, int client_fd) {
  struct ucred credentials;
  socklen_t credentials_length = sizeof(credentials);
  if (getsockopt(client_fd, SOL_SOCKET, SO_PEERCRED, &credentials, &credentials_length) != 0
    || credentials_length != sizeof(credentials)) {
    return send_error(client_fd, "PEER_CREDENTIALS_UNAVAILABLE", "Kernel peer credentials are unavailable.");
  }

  const char *role = role_for_uid(config, credentials.uid);
  if (role == NULL) return send_error(client_fd, "UNAUTHORIZED_PEER", "Peer UID is not authorized.");

  char line[MAX_REQUEST_BYTES + 1];
  size_t length = 0;
  if (read_line(client_fd, line, sizeof(line), &length) != 0) {
    return send_error(client_fd, "INVALID_MESSAGE", "Request was incomplete, malformed, or too large.");
  }
  if (length == 0) return send_error(client_fd, "INVALID_MESSAGE", "Request must not be empty.");

  service_request request;
  int parsed = parse_request(line, &request);
  if (parsed == -2) return send_error(client_fd, "UNSUPPORTED_VERSION", "Protocol version is unsupported.");
  if (parsed != 0) return send_error(client_fd, "INVALID_MESSAGE", "Request fields or values are invalid.");
  if (strcmp(request.operation, "serviceInfo") == 0) {
    char response[256];
    int response_length = snprintf(response, sizeof(response),
      "{\"ok\":true,\"version\":1,\"serviceInstanceId\":\"%s\"}\n",
      config->service_instance);
    if (response_length < 0 || (size_t)response_length >= sizeof(response)) return -1;
    return write_all(client_fd, response, (size_t)response_length);
  }
  if (!request.has_instance_id || strcmp(request.instance_id, config->service_instance) != 0) {
    return send_error(client_fd, "STALE_SERVICE_INSTANCE", "Request belongs to another service instance.");
  }
  if (!role_allows(role, request.operation)) {
    return send_error(client_fd, "UNAUTHORIZED_OPERATION", "Peer role is not authorized for this operation.");
  }

  return relay_to_worker(config, role, &request, line, client_fd);
}

static int create_listener(service_config *config) {
  if (strlen(config->path) >= sizeof(((struct sockaddr_un *)0)->sun_path)
    || validate_socket_parent(config->path) != 0) {
    errno = EACCES;
    return -1;
  }
  struct stat existing;
  if (lstat(config->path, &existing) == 0 || errno != ENOENT) {
    errno = EADDRINUSE;
    return -1;
  }

  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, config->path, strlen(config->path) + 1);
  mode_t previous_mask = umask(0117);
  int bind_result = bind(fd, (struct sockaddr *)&address, sizeof(address));
  int bind_errno = errno;
  umask(previous_mask);
  if (bind_result != 0) {
    close(fd);
    errno = bind_errno;
    return -1;
  }
  struct stat st;
  if (lstat(config->path, &st) != 0) {
    int saved_errno = errno;
    close(fd);
    errno = saved_errno;
    return -1;
  }
  if (!S_ISSOCK(st.st_mode) || st.st_uid != config->service_uid
    || st.st_gid != config->access_gid) {
    close(fd);
    errno = EACCES;
    return -1;
  }
  if ((st.st_mode & 07777) != SOCKET_MODE) {
    close(fd);
    errno = EACCES;
    return -1;
  }
  config->socket_dev = st.st_dev;
  config->socket_ino = st.st_ino;
  config->listener_fd = fd;
  int listen_result = listen(fd, 16);
  int listen_errno = errno;
  int stat_result = listen_result == 0 ? lstat(config->path, &st) : -1;
  if (listen_result != 0 || stat_result != 0 || !S_ISSOCK(st.st_mode)
    || st.st_uid != config->service_uid || st.st_gid != config->access_gid
    || st.st_dev != config->socket_dev || st.st_ino != config->socket_ino
    || (st.st_mode & 07777) != SOCKET_MODE) {
    int saved_errno = listen_result != 0 ? listen_errno
      : stat_result != 0 ? errno : EACCES;
    close(fd);
    config->listener_fd = -1;
    struct stat current;
    if (lstat(config->path, &current) == 0 && S_ISSOCK(current.st_mode)
      && current.st_uid == config->service_uid && current.st_gid == config->access_gid
      && current.st_dev == config->socket_dev && current.st_ino == config->socket_ino) {
      unlink(config->path);
    }
    errno = saved_errno;
    return -1;
  }
  return 0;
}

static void stop_worker(service_config *config) {
  if (config->worker_in_fd >= 0) {
    close(config->worker_in_fd);
    config->worker_in_fd = -1;
  }
  if (config->worker_pid > 0) {
    int status;
    while (waitpid(config->worker_pid, &status, 0) < 0 && errno == EINTR) {}
    config->worker_pid = -1;
  }
  if (config->worker_out_fd >= 0) {
    close(config->worker_out_fd);
    config->worker_out_fd = -1;
  }
}

static void cleanup(service_config *config) {
  if (config->listener_fd >= 0) close(config->listener_fd);
  stop_worker(config);
  struct stat st;
  if (lstat(config->path, &st) == 0 && S_ISSOCK(st.st_mode)
    && st.st_uid == config->service_uid && st.st_gid == config->access_gid
    && st.st_dev == config->socket_dev
    && st.st_ino == config->socket_ino) {
    unlink(config->path);
  }
  if (config->lock_fd >= 0) close(config->lock_fd);
}

int main(int argc, char **argv) {
  service_config config;
  if (parse_arguments(argc, argv, &config) != 0
    || validate_executable(config.node_path, 1) != 0
    || validate_worker_file(config.worker_path) != 0
    || fill_random_instance(config.service_instance) != 0) {
    fprintf(stderr, "AETHER admission service configuration is invalid.\n");
    return 2;
  }
  if (geteuid() != config.service_uid || getegid() != config.access_gid) {
    fprintf(stderr, "AETHER admission service identity does not match its configuration.\n");
    return 2;
  }

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = handle_signal;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  signal(SIGPIPE, SIG_IGN);

  if (validate_state_directory(&config) != 0
    || validate_socket_parent(config.path) != 0
    || acquire_authority_lock(&config) != 0
    || start_worker(&config) != 0 || create_listener(&config) != 0) {
    fprintf(stderr, "AETHER admission service could not start: %s\n", strerror(errno));
    cleanup(&config);
    return 1;
  }

  while (!stop_requested) {
    struct pollfd descriptor = { .fd = config.listener_fd, .events = POLLIN };
    int ready = poll(&descriptor, 1, 250);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) {
      fprintf(stderr, "AETHER admission service listener failed: %s\n", strerror(errno));
      cleanup(&config);
      return 1;
    }
    if (ready == 0) continue;
    int client = accept4(config.listener_fd, NULL, NULL, SOCK_CLOEXEC);
    if (client < 0) {
      if (errno == EINTR) continue;
      fprintf(stderr, "AETHER admission service accept failed: %s\n", strerror(errno));
      cleanup(&config);
      return 1;
    }
    if (handle_client(&config, client) != 0) {
      shutdown(client, SHUT_RDWR);
    }
    close(client);
    if (config.worker_failed) {
      fprintf(stderr, "AETHER admission service stopped after an ambiguous worker result.\n");
      cleanup(&config);
      return 1;
    }
  }

  cleanup(&config);
  return 0;
}

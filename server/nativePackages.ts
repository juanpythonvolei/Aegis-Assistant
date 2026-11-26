import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { getLinuxBundleFiles } from './linuxBundle.ts';
import { getLocalHoloUiHtml } from './localHoloUi.ts';

const BUILD_ROOT = '/tmp/aegis-native-build';
const APP_VERSION = '2.1.0';

export interface NativeArtifactMeta {
  id: string;
  os: 'linux' | 'windows' | 'android';
  filename: string;
  title: string;
  subtitle: string;
  format: string;
  architecture: string;
  downloadUrl: string;
  sizeBytes: number | null;
  sha256: string | null;
  compiledOnServer: boolean;
  source?: 'server_compiled' | 'github_release' | 'build_kit';
  releaseTag?: string | null;
  installSteps: string[];
  capabilities: string[];
}

export interface GithubReleaseSyncInfo {
  repo: string | null;
  status: 'unconfigured' | 'linked' | 'no_releases' | 'error';
  releaseTag: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  syncedAssetsCount: number;
  message: string;
}

interface LinuxNativeCache {
  elfBuffer: Buffer;
  elfSha256: string;
  debBuffer: Buffer;
  debSha256: string;
  appImageBuffer: Buffer;
  appImageSha256: string;
  tarGzBuffer: Buffer;
  tarGzSha256: string;
  builtAt: string;
}

let linuxCache: LinuxNativeCache | null = null;
const windowsCache = new Map<string, { buffer: Buffer; sha256: string }>();

export function sanitizeOrigin(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[a-zA-Z0-9._-]+(:\d{1,5})?$/.test(trimmed)) {
    return trimmed;
  }
  return 'http://localhost:3000';
}

export function sanitizePairingCode(raw?: string): string {
  return String(raw || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ============================================================================
// 1. LINUX NATIVE ELF C LAUNCHER + REAL .DEB PACKAGE + UNIVERSAL .TAR.GZ
// ============================================================================

const AEGIS_LINUX_SVG_ICON = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FEF3C7"/>
      <stop offset="35%" stop-color="#F59E0B"/>
      <stop offset="75%" stop-color="#B45309" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#070B12" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="#070B12"/>
  <circle cx="128" cy="128" r="102" fill="url(#coreGlow)"/>
  <circle cx="128" cy="128" r="82" fill="none" stroke="#F59E0B" stroke-opacity="0.55" stroke-width="3" stroke-dasharray="14 8"/>
  <circle cx="128" cy="128" r="58" fill="none" stroke="#38BDF8" stroke-opacity="0.5" stroke-width="2.5"/>
  <circle cx="128" cy="128" r="30" fill="#FBBF24"/>
  <circle cx="128" cy="128" r="14" fill="#FFFBEB"/>
</svg>
`;

const AEGIS_LINUX_NATIVE_C = `/*
 * Aegis Desktop Native Launcher & OS Service Controller (Linux x86_64 ELF)
 * Version ${APP_VERSION}
 *
 * Compilado em C nativo (POSIX) para integracao real ao sistema operacional Linux:
 * - Localiza Node.js automaticamente (sistema, NVM, FNM, Volta, asdf, snap, portable)
 * - Inicia o daemon local zero-dependencias (127.0.0.1:3847) com logs em ~/.local/share/aegis/daemon.log
 * - Verifica prontidao real via HTTP GET /health antes de abrir a janela nativa
 * - Caso o daemon nao suba, abre pagina de diagnostico amigavel em vez de ERR_CONNECTION_REFUSED
 */
#define _POSIX_C_SOURCE 200809L
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define AEGIS_VERSION "${APP_VERSION}"
#define AEGIS_PORT 3847
#define AEGIS_URL "http://127.0.0.1:3847"

static void sleep_ms(long ms) {
  struct timespec ts;
  ts.tv_sec = ms / 1000;
  ts.tv_nsec = (ms % 1000) * 1000000L;
  nanosleep(&ts, NULL);
}

static int file_exists(const char *path) {
  struct stat st;
  return path && path[0] != '\\0' && stat(path, &st) == 0;
}

static int is_executable(const char *path) {
  return path && path[0] != '\\0' && access(path, X_OK) == 0;
}

static void ensure_data_dir(char *out_dir, size_t out_size) {
  const char *home = getenv("HOME");
  if (!home || !home[0]) {
    snprintf(out_dir, out_size, "/tmp");
    return;
  }
  char p1[1024], p2[1024], p3[1024];
  snprintf(p1, sizeof(p1), "%s/.local", home);
  mkdir(p1, 0755);
  snprintf(p2, sizeof(p2), "%s/.local/share", home);
  mkdir(p2, 0755);
  snprintf(p3, sizeof(p3), "%s/.local/share/aegis", home);
  mkdir(p3, 0755);
  snprintf(out_dir, out_size, "%s", p3);
}

static void resolve_install_dir(char *out, size_t out_size) {
  const char *env_dir = getenv("AEGIS_HOME");
  if (env_dir && env_dir[0] != '\\0') {
    char probe[1024];
    snprintf(probe, sizeof(probe), "%s/aegis-daemon.mjs", env_dir);
    if (file_exists(probe)) {
      snprintf(out, out_size, "%s", env_dir);
      return;
    }
  }
  if (file_exists("/opt/aegis/aegis-daemon.mjs")) {
    snprintf(out, out_size, "/opt/aegis");
    return;
  }
  const char *home = getenv("HOME");
  if (home) {
    char candidate[1024];
    snprintf(candidate, sizeof(candidate), "%s/.local/share/aegis/aegis-daemon.mjs", home);
    if (file_exists(candidate)) {
      snprintf(out, out_size, "%s/.local/share/aegis", home);
      return;
    }
  }
  snprintf(out, out_size, "/opt/aegis");
}

static int find_in_path_full(const char *cmd, char *out, size_t out_size) {
  const char *path_env = getenv("PATH");
  if (!path_env) return 0;
  char *copy = strdup(path_env);
  if (!copy) return 0;
  int found = 0;
  char *saveptr = NULL;
  for (char *dir = strtok_r(copy, ":", &saveptr); dir; dir = strtok_r(NULL, ":", &saveptr)) {
    char full[1024];
    snprintf(full, sizeof(full), "%s/%s", dir, cmd);
    if (access(full, X_OK) == 0) {
      if (out && out_size > 0) snprintf(out, out_size, "%s", full);
      found = 1;
      break;
    }
  }
  free(copy);
  return found;
}

static int find_in_path(const char *cmd) {
  return find_in_path_full(cmd, NULL, 0);
}

static int resolve_node_binary(char *out, size_t out_size) {
  const char *env_node = getenv("AEGIS_NODE_BIN");
  if (is_executable(env_node)) {
    snprintf(out, out_size, "%s", env_node);
    return 1;
  }

  const char *home = getenv("HOME");
  char candidate[1024];

  if (home && home[0]) {
    const char *home_candidates[] = {
      "%s/.local/share/aegis/bin/node",
      "%s/.local/share/aegis/node-runtime/bin/node",
      "%s/.volta/bin/node",
      "%s/.fnm/current/bin/node",
      "%s/.asdf/shims/node",
      "%s/.local/bin/node",
      NULL
    };
    for (int i = 0; home_candidates[i] != NULL; i++) {
      snprintf(candidate, sizeof(candidate), home_candidates[i], home);
      if (is_executable(candidate)) {
        snprintf(out, out_size, "%s", candidate);
        return 1;
      }
    }
  }

  if (find_in_path_full("node", out, out_size)) {
    return 1;
  }

  const char *sys_candidates[] = {
    "/usr/bin/node",
    "/usr/local/bin/node",
    "/snap/bin/node",
    "/home/linuxbrew/.linuxbrew/bin/node",
    "/usr/bin/nodejs",
    NULL
  };
  for (int i = 0; sys_candidates[i] != NULL; i++) {
    if (is_executable(sys_candidates[i])) {
      snprintf(out, out_size, "%s", sys_candidates[i]);
      return 1;
    }
  }

  /* Scan ~/.nvm/versions/node/vX.Y.Z/bin/node picking the highest version */
  if (home && home[0]) {
    char nvm_dir[1024];
    snprintf(nvm_dir, sizeof(nvm_dir), "%s/.nvm/versions/node", home);
    DIR *d = opendir(nvm_dir);
    if (d) {
      char best_ver[256] = "";
      char best_path[1024] = "";
      struct dirent *ent;
      while ((ent = readdir(d)) != NULL) {
        if (ent->d_name[0] != 'v') continue;
        char probe[1024];
        snprintf(probe, sizeof(probe), "%s/%s/bin/node", nvm_dir, ent->d_name);
        if (is_executable(probe)) {
          if (best_ver[0] == '\\0' || strcmp(ent->d_name, best_ver) > 0) {
            snprintf(best_ver, sizeof(best_ver), "%s", ent->d_name);
            snprintf(best_path, sizeof(best_path), "%s", probe);
          }
        }
      }
      closedir(d);
      if (best_path[0] != '\\0') {
        snprintf(out, out_size, "%s", best_path);
        return 1;
      }
    }
  }

  return 0;
}

static int is_daemon_healthy(void) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return 0;

  struct timeval tv;
  tv.tv_sec = 0;
  tv.tv_usec = 450000;
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons(AEGIS_PORT);
  inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    close(fd);
    return 0;
  }

  const char *req = "GET /health HTTP/1.0\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n";
  ssize_t sent = send(fd, req, strlen(req), 0);
  int ok = 0;
  if (sent > 0) {
    char buf[512];
    ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);
    if (n > 0) {
      buf[n] = '\\0';
      if (strstr(buf, " 200 ") != NULL) {
        ok = 1;
      }
    }
  }
  close(fd);
  return ok;
}

static int run_wait_quiet(char *const argv[]) {
  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    int devnull = open("/dev/null", O_RDWR);
    if (devnull >= 0) {
      dup2(devnull, STDOUT_FILENO);
      dup2(devnull, STDERR_FILENO);
      if (devnull > 2) close(devnull);
    }
    execvp(argv[0], argv);
    _exit(127);
  }
  int status = 0;
  if (waitpid(pid, &status, 0) < 0) return -1;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}

static int run_wait(char *const argv[]) {
  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    execvp(argv[0], argv);
    _exit(127);
  }
  int status = 0;
  if (waitpid(pid, &status, 0) < 0) return -1;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}

static int run_detached(char *const argv[]) {
  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    setsid();
    int devnull = open("/dev/null", O_RDWR);
    if (devnull >= 0) {
      dup2(devnull, STDIN_FILENO);
      dup2(devnull, STDOUT_FILENO);
      dup2(devnull, STDERR_FILENO);
      if (devnull > 2) close(devnull);
    }
    execvp(argv[0], argv);
    _exit(127);
  }
  return 0;
}

static int run_daemon_logged(const char *node_bin, const char *daemon_script, const char *install_dir, const char *log_path) {
  pid_t pid = fork();
  if (pid < 0) return -1;
  if (pid == 0) {
    setsid();
    if (install_dir && install_dir[0]) {
      if (chdir(install_dir) != 0) {
        /* ignore chdir failure */
      }
    }
    int devnull = open("/dev/null", O_RDONLY);
    if (devnull >= 0) {
      dup2(devnull, STDIN_FILENO);
      if (devnull > 2) close(devnull);
    }
    int logfd = open(log_path, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (logfd >= 0) {
      dup2(logfd, STDOUT_FILENO);
      dup2(logfd, STDERR_FILENO);
      if (logfd > 2) close(logfd);
    }
    char *node_argv[] = {(char *)node_bin, (char *)daemon_script, NULL};
    execv(node_bin, node_argv);
    _exit(127);
  }
  return 0;
}

static int start_daemon(const char *install_dir) {
  if (is_daemon_healthy()) return 0;

  /* 1. Try systemd --user if present (skip when running portable AppImage so bundled runtime is used) */
  if (getenv("APPIMAGE") == NULL && find_in_path("systemctl")) {
    char *sc_argv[] = {"systemctl", "--user", "start", "aegis-desktop.service", NULL};
    if (run_wait_quiet(sc_argv) == 0) {
      for (int i = 0; i < 16; i++) {
        if (is_daemon_healthy()) return 0;
        sleep_ms(150);
      }
    }
  }

  /* 2. Direct spawn with resolved Node.js binary + daemon.log */
  char daemon_script[1024];
  snprintf(daemon_script, sizeof(daemon_script), "%s/aegis-daemon.mjs", install_dir);
  if (!file_exists(daemon_script)) {
    fprintf(stderr, "[aegis-desktop] Runtime nao encontrado em %s\\n", daemon_script);
    return 3;
  }

  char node_bin[1024];
  if (!resolve_node_binary(node_bin, sizeof(node_bin))) {
    fprintf(stderr, "[aegis-desktop] Node.js (>= 18) nao encontrado. Instale via: sudo apt install -y nodejs\\n");
    return 2;
  }

  char data_dir[1024];
  char log_path[1200];
  ensure_data_dir(data_dir, sizeof(data_dir));
  snprintf(log_path, sizeof(log_path), "%s/daemon.log", data_dir);

  if (run_daemon_logged(node_bin, daemon_script, install_dir, log_path) != 0) {
    fprintf(stderr, "[aegis-desktop] Falha ao iniciar %s %s\\n", node_bin, daemon_script);
    return 1;
  }

  for (int i = 0; i < 40; i++) {
    if (is_daemon_healthy()) return 0;
    sleep_ms(200);
  }
  return is_daemon_healthy() ? 0 : 1;
}

static int launch_native_window_url(const char *target_url) {
  const char *browsers[] = {
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
    NULL
  };

  char app_arg[1200];
  snprintf(app_arg, sizeof(app_arg), "--app=%s", target_url);

  for (int i = 0; browsers[i] != NULL; i++) {
    if (find_in_path(browsers[i])) {
      char *argv[] = {
        (char *)browsers[i],
        app_arg,
        "--class=AegisDesktop",
        "--window-size=1280,820",
        NULL
      };
      return run_detached(argv);
    }
  }

  if (find_in_path("xdg-open")) {
    char *argv[] = {"xdg-open", (char *)target_url, NULL};
    return run_detached(argv);
  }

  printf("Aegis Desktop disponivel em %s\\n", target_url);
  return 0;
}

static int launch_diagnostic_page(const char *install_dir, int start_rc) {
  char data_dir[1024];
  char log_path[1200];
  ensure_data_dir(data_dir, sizeof(data_dir));
  snprintf(log_path, sizeof(log_path), "%s/daemon.log", data_dir);

  char log_tail[2048] = "(nenhum log registrado ainda)";
  FILE *lf = fopen(log_path, "r");
  if (lf) {
    fseek(lf, 0, SEEK_END);
    long sz = ftell(lf);
    long start = sz > 1800 ? sz - 1800 : 0;
    fseek(lf, start, SEEK_SET);
    size_t n = fread(log_tail, 1, sizeof(log_tail) - 1, lf);
    log_tail[n] = '\\0';
    fclose(lf);
  }

  const char *cause = "O daemon local nao respondeu em 127.0.0.1:3847 dentro do tempo esperado.";
  const char *fix_cmd = "aegis-desktop --doctor && cat ~/.local/share/aegis/daemon.log";
  if (start_rc == 2) {
    cause = "Node.js (&gt;= 18) nao foi encontrado no sistema (verificamos PATH, /usr/bin, snap, NVM, FNM e Volta).";
    fix_cmd = "sudo apt update &amp;&amp; sudo apt install -y nodejs &amp;&amp; aegis-desktop";
  } else if (start_rc == 3) {
    cause = "O arquivo aegis-daemon.mjs nao foi encontrado no diretorio de instalacao.";
    fix_cmd = "sudo apt reinstall ./aegis-desktop_" AEGIS_VERSION "_amd64.deb";
  }

  const char *diag_file = "/tmp/aegis-desktop-diagnostic.html";
  FILE *f = fopen(diag_file, "w");
  if (f) {
    fprintf(f,
      "<!doctype html><html lang=\\"pt-BR\\"><head><meta charset=\\"utf-8\\"><title>Aegis Desktop — Diagnostico</title>"
      "<style>body{margin:0;background:#070B12;color:#E2E8F0;font-family:system-ui,sans-serif;padding:40px;line-height:1.5}"
      ".card{max-width:760px;margin:0 auto;background:#0F172A;border:1px solid #1E293B;border-radius:16px;padding:28px}"
      "h1{margin:0 0 8px;font-size:20px;color:#FBBF24}p{color:#94A3B8;font-size:14px}"
      "pre{background:#020617;border:1px solid #1E293B;padding:14px;border-radius:10px;overflow:auto;font-size:12px;color:#38BDF8;white-space:pre-wrap}"
      ".pill{display:inline-block;padding:3px 10px;border-radius:999px;background:#78350F;color:#FDE68A;font-size:11px;font-weight:600;margin-bottom:12px}"
      "</style></head><body><div class=\\"card\\">"
      "<div class=\\"pill\\">AEGIS DESKTOP v%s · DIAGNOSTICO LOCAL</div>"
      "<h1>Nao foi possivel conectar ao servico local (127.0.0.1:3847)</h1>"
      "<p><strong>Causa detectada:</strong> %s</p>"
      "<p><strong>Diretorio do runtime:</strong> <code>%s</code></p>"
      "<p><strong>Como resolver no terminal:</strong></p>"
      "<pre>%s</pre>"
      "<p><strong>Ultimas linhas de <code>%s</code>:</strong></p>"
      "<pre>%s</pre>"
      "</div></body></html>",
      AEGIS_VERSION, cause, install_dir, fix_cmd, log_path, log_tail
    );
    fclose(f);
    return launch_native_window_url("file:///tmp/aegis-desktop-diagnostic.html");
  }
  return 1;
}

static void print_doctor(const char *install_dir) {
  char node_bin[1024];
  int has_node = resolve_node_binary(node_bin, sizeof(node_bin));
  char data_dir[1024];
  char log_path[1200];
  ensure_data_dir(data_dir, sizeof(data_dir));
  snprintf(log_path, sizeof(log_path), "%s/daemon.log", data_dir);

  printf("Aegis Desktop Native v%s (Linux x86_64 ELF · Zero-Dep)\\n", AEGIS_VERSION);
  printf("------------------------------------------------------------\\n");
  printf("Runtime dir : %s (%s)\\n", install_dir, file_exists(install_dir) ? "OK" : "AUSENTE");
  printf("Node.js     : %s\\n", has_node ? node_bin : "NAO INSTALADO (rode: sudo apt install -y nodejs)");
  printf("ADB Android : %s\\n", find_in_path("adb") ? "OK (Ponte Android pronta)" : "Opcional (sudo apt install adb)");
  printf("Daemon 3847 : %s\\n", is_daemon_healthy() ? "ONLINE (" AEGIS_URL ")" : "OFFLINE");
  printf("Daemon log  : %s\\n", log_path);
  const char *home = getenv("HOME");
  if (home) {
    char env_path[1024];
    snprintf(env_path, sizeof(env_path), "%s/.config/aegis/env", home);
    printf("Config env  : %s (%s)\\n", env_path, file_exists(env_path) ? "ENCONTRADO" : "Crie com GEMINI_API_KEY=...");
  }
}

static void print_help(void) {
  printf("Aegis Desktop Native v%s (Aplicativo Nativo Linux)\\n\\n", AEGIS_VERSION);
  printf("Uso:\\n");
  printf("  aegis-desktop              Inicia o servico local e abre a janela nativa do Aegis\\n");
  printf("  aegis-desktop --status     Verifica se o agente local (porta 3847) esta online\\n");
  printf("  aegis-desktop --start      Inicia o servico de sistema Aegis\\n");
  printf("  aegis-desktop --stop       Encerra o servico systemd --user Aegis\\n");
  printf("  aegis-desktop --restart    Reinicia o servico local\\n");
  printf("  aegis-desktop --doctor     Diagnostico completo do ambiente Linux & ADB\\n");
  printf("  aegis-desktop --version    Exibe a versao do binario nativo\\n");
  printf("  aegis \\"<comando>\\"          Executa uma missao direta no agente local\\n");
}

int main(int argc, char **argv) {
  char install_dir[1024];
  resolve_install_dir(install_dir, sizeof(install_dir));

  if (argc == 1 || (argc == 2 && strcmp(argv[1], "--ui") == 0)) {
    int rc = start_daemon(install_dir);
    if (rc == 0) {
      return launch_native_window_url(AEGIS_URL);
    }
    return launch_diagnostic_page(install_dir, rc);
  }

  if (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-v") == 0) {
    printf("Aegis Desktop Native v%s (Linux x86_64 ELF)\\n", AEGIS_VERSION);
    return 0;
  }

  if (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0) {
    print_help();
    return 0;
  }

  if (strcmp(argv[1], "--doctor") == 0) {
    print_doctor(install_dir);
    return 0;
  }

  if (strcmp(argv[1], "--status") == 0) {
    if (is_daemon_healthy()) {
      printf("ONLINE: Aegis Desktop ativo em %s\\n", AEGIS_URL);
      return 0;
    }
    printf("OFFLINE: Aegis Desktop nao esta respondendo na porta %d\\n", AEGIS_PORT);
    return 1;
  }

  if (strcmp(argv[1], "--start") == 0) {
    int rc = start_daemon(install_dir);
    printf("%s\\n", rc == 0 ? "Aegis Desktop iniciado em " AEGIS_URL : "Falha ao iniciar o daemon Aegis. Rode: aegis-desktop --doctor");
    return rc;
  }

  if (strcmp(argv[1], "--stop") == 0) {
    char *sc_argv[] = {"systemctl", "--user", "stop", "aegis-desktop.service", NULL};
    return run_wait(sc_argv);
  }

  if (strcmp(argv[1], "--restart") == 0) {
    char *sc_argv[] = {"systemctl", "--user", "restart", "aegis-desktop.service", NULL};
    return run_wait(sc_argv);
  }

  /* Encaminha qualquer outro comando CLI para /opt/aegis/aegis-cli.mjs */
  char cli_script[1024];
  snprintf(cli_script, sizeof(cli_script), "%s/aegis-cli.mjs", install_dir);
  if (!file_exists(cli_script)) {
    fprintf(stderr, "[aegis-desktop] CLI nao encontrado em %s\\n", cli_script);
    return 1;
  }

  char node_bin[1024];
  if (!resolve_node_binary(node_bin, sizeof(node_bin))) {
    fprintf(stderr, "[aegis-desktop] Node.js nao encontrado. Instale com: sudo apt install -y nodejs\\n");
    return 1;
  }

  start_daemon(install_dir);
  char **node_args = calloc((size_t)argc + 2, sizeof(char *));
  if (!node_args) return 1;
  node_args[0] = node_bin;
  node_args[1] = cli_script;
  for (int i = 1; i < argc; i++) {
    node_args[i + 1] = argv[i];
  }
  node_args[argc + 1] = NULL;
  execv(node_bin, node_args);
  perror("execv(node)");
  free(node_args);
  return 127;
}
`;

const LINUX_DESKTOP_ENTRY = `[Desktop Entry]
Type=Application
Version=1.0
Name=Aegis Desktop
GenericName=Orquestrador Neural Autonomo
Comment=Aplicativo nativo Aegis com controle local, nuvem e ponte ADB Android
Exec=/usr/bin/aegis-desktop --ui
Icon=aegis-desktop
Terminal=false
Categories=System;Utility;Development;
StartupNotify=true
StartupWMClass=AegisDesktop
Keywords=aegis;ai;orchestrator;assistant;android;adb;
`;

const LINUX_SYSTEMD_USER_UNIT = `[Unit]
Description=Aegis Desktop Native Orchestrator Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/aegis/env
Environment=AEGIS_WATCH_DIR=%h
Environment=AEGIS_PORT=3847
WorkingDirectory=/opt/aegis
ExecStart=/usr/bin/env node /opt/aegis/aegis-daemon.mjs
Restart=on-failure
RestartSec=4

[Install]
WantedBy=default.target
`;

const DEBIAN_CONTROL = `Package: aegis-desktop
Version: ${APP_VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Aegis Autonomous Systems <aegis@local.system>
Depends: libc6 (>= 2.31)
Recommends: nodejs (>= 18.0.0), android-tools-adb
Description: Aegis Desktop — Orquestrador Neural Nativo para Linux
 Aplicativo nativo Linux x86_64 (binario ELF compilado + servico systemd --user
 + entrada nativa no menu de aplicativos + ponte ADB Android + CLI global).
`;

const DEBIAN_POSTINST = `#!/bin/sh
set -e
chmod 755 /usr/bin/aegis-desktop /opt/aegis/aegis-cli.mjs /opt/aegis/aegis-daemon.mjs 2>/dev/null || true

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

echo ""
echo "================================================================="
echo "  Aegis Desktop v${APP_VERSION} (Zero-Dep) instalado com sucesso!"
if ! command -v node >/dev/null 2>&1; then
  echo "  [AVISO] Instale Node.js (>= 18): sudo apt install -y nodejs"
fi
echo "  1) Crie ~/.config/aegis/env com GEMINI_API_KEY=sua_chave"
echo "  2) Abra 'Aegis Desktop' no menu do sistema ou rode: aegis-desktop"
echo "  3) Diagnostico rapido: aegis-desktop --doctor"
echo "================================================================="
exit 0
`;

const DEBIAN_PRERM = `#!/bin/sh
set -e
if [ "$1" = "remove" ]; then
  pkill -f "/opt/aegis/aegis-daemon.mjs" 2>/dev/null || true
fi
exit 0
`;

const DEBIAN_POSTRM = `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
exit 0
`;

const UNIVERSAL_LINUX_INSTALL_SH = `#!/usr/bin/env bash
set -euo pipefail

echo "================================================================"
echo "  Instalador Nativo Aegis Desktop v${APP_VERSION} (Linux x86_64)"
echo "================================================================"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_OPT="/opt/aegis"
TARGET_BIN="/usr/local/bin/aegis-desktop"
TARGET_LINK="/usr/local/bin/aegis"
TARGET_DESKTOP="/usr/share/applications/aegis-desktop.desktop"
TARGET_ICON="/usr/share/icons/hicolor/scalable/apps/aegis-desktop.svg"
TARGET_UNIT="/usr/lib/systemd/user/aegis-desktop.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "[1/5] Instalando no espaco do usuario (~/.local)..."
  TARGET_OPT="$HOME/.local/share/aegis"
  TARGET_BIN="$HOME/.local/bin/aegis-desktop"
  TARGET_LINK="$HOME/.local/bin/aegis"
  TARGET_DESKTOP="$HOME/.local/share/applications/aegis-desktop.desktop"
  TARGET_ICON="$HOME/.local/share/icons/hicolor/scalable/apps/aegis-desktop.svg"
  TARGET_UNIT="$HOME/.config/systemd/user/aegis-desktop.service"
fi

mkdir -p "$TARGET_OPT" "$(dirname "$TARGET_BIN")" "$(dirname "$TARGET_DESKTOP")" "$(dirname "$TARGET_ICON")" "$(dirname "$TARGET_UNIT")" "$HOME/.config/aegis"

echo "[2/5] Copiando binario ELF nativo e runtime..."
install -m 755 "$SCRIPT_DIR/bin/aegis-desktop" "$TARGET_BIN"
ln -sf "$TARGET_BIN" "$TARGET_LINK"
cp -f "$SCRIPT_DIR/opt/aegis/"* "$TARGET_OPT/"
chmod 755 "$TARGET_OPT/aegis-cli.mjs" "$TARGET_OPT/aegis-daemon.mjs"

echo "[3/5] Registrando aplicativo no Menu do Sistema e icone..."
sed "s|/usr/bin/aegis-desktop|$TARGET_BIN|g" "$SCRIPT_DIR/share/aegis-desktop.desktop" > "$TARGET_DESKTOP"
cp -f "$SCRIPT_DIR/share/aegis-desktop.svg" "$TARGET_ICON"
sed "s|/opt/aegis|$TARGET_OPT|g" "$SCRIPT_DIR/share/aegis-desktop.service" > "$TARGET_UNIT"

echo "[4/5] Verificando runtime Node.js (zero dependencias externas)..."
if command -v node >/dev/null 2>&1; then
  echo "  -> Node.js encontrado: $(command -v node) ($(node -v))"
else
  echo "  -> AVISO: Node.js nao encontrado no PATH. Instale nodejs >= 18 (ex: sudo apt install -y nodejs)."
fi

if [ ! -f "$HOME/.config/aegis/env" ]; then
  cat > "$HOME/.config/aegis/env" <<'ENVEOF'
# Configure sua chave Gemini para o modo offline/autonomo do daemon local:
GEMINI_API_KEY=
AEGIS_PORT=3847
ENVEOF
fi

echo "[5/5] Ativando servico systemd --user..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload 2>/dev/null || true
  systemctl --user enable --now aegis-desktop.service 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q "$(dirname "$TARGET_DESKTOP")" 2>/dev/null || true
fi

echo ""
echo "Instalacao concluida! Abra 'Aegis Desktop' no menu de aplicativos ou execute:"
echo "  $TARGET_BIN --ui"
`;

function getElectronAppFiles(serverOrigin: string): Record<string, string> {
  const safeOrigin = sanitizeOrigin(serverOrigin);
  return {
    'package.json': JSON.stringify(
      {
        name: 'aegis-desktop-native',
        productName: 'Aegis Desktop',
        version: APP_VERSION,
        description: 'Aplicativo Desktop Nativo Aegis (Electron + Daemon de Sistema)',
        main: 'main.cjs',
        scripts: {
          start: 'electron .',
          'build:linux': 'electron-builder --linux deb AppImage rpm',
          'build:win': 'electron-builder --win nsis msi',
        },
        dependencies: {},
        devDependencies: {
          electron: '^33.2.0',
          'electron-builder': '^25.1.8',
        },
        build: {
          appId: 'com.aegis.desktop',
          productName: 'Aegis Desktop',
          directories: { output: 'dist-installers' },
          files: ['main.cjs', 'preload.cjs', 'runtime/**/*'],
          linux: {
            category: 'Utility',
            target: ['deb', 'AppImage', 'rpm'],
          },
          win: {
            target: [
              { target: 'nsis', arch: ['x64'] },
              { target: 'msi', arch: ['x64'] },
            ],
          },
          nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
          },
        },
      },
      null,
      2
    ),
    'preload.cjs': `const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('aegisNativeHost', {
  platform: process.platform,
  arch: process.arch,
  version: '${APP_VERSION}',
});
`,
    'main.cjs': `const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;
let daemonProc = null;
let tray = null;

const LOCAL_HUD_URL = process.env.AEGIS_URL || 'http://127.0.0.1:3847';
const CLOUD_FALLBACK_URL = '${safeOrigin}';

function startLocalDaemon() {
  const runtimeDaemon = path.join(__dirname, 'runtime', 'aegis-daemon.mjs');
  if (!fs.existsSync(runtimeDaemon)) return;
  daemonProc = spawn(process.execPath, [runtimeDaemon], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AEGIS_PORT: '3847' },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForLocalDaemon() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(LOCAL_HUD_URL + '/health');
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function createWindow() {
  startLocalDaemon();
  const ready = await waitForLocalDaemon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: 'Aegis Desktop',
    backgroundColor: '#070B12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(ready ? LOCAL_HUD_URL : CLOUD_FALLBACK_URL);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  try {
    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('Aegis Desktop Native');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Aegis Desktop', click: () => mainWindow && mainWindow.show() },
        { label: 'Abrir Nuvem Aegis', click: () => mainWindow && mainWindow.loadURL(CLOUD_FALLBACK_URL) },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() },
      ])
    );
  } catch {}
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (daemonProc) {
    try { daemonProc.kill(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});
`,
  };
}

const AEGIS_APPIMAGE_RUNTIME_C = `/*
 * Aegis Desktop Self-Contained AppImage Runtime (Linux x86_64 ELF, Zero-FUSE)
 * Version ${APP_VERSION}
 *
 * - Funciona em qualquer distro Linux (Ubuntu 20-24, Debian, Pop!_OS, Fedora, Arch, Mint)
 *   sem depender de libfuse2 ou privilegios root.
 * - Layout do binario: [Runtime ELF] + [appdir.tar.gz] + [32B Trailer: "AEGIS_APPIMG_V01" + offset(LE64) + size(LE64)]
 * - Flags suportadas: --appimage-version, --appimage-help, --appimage-extract, --integrate, --ui, --doctor, --status, --start, --stop
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define APPIMG_VERSION "${APP_VERSION}"
#define TRAILER_MAGIC "AEGIS_APPIMG_V01"
#define TRAILER_SIZE 32

static uint64_t read_le64(const unsigned char *b) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) {
    v |= ((uint64_t)b[i]) << (8 * i);
  }
  return v;
}

static int file_exists(const char *p) {
  struct stat st;
  return p && p[0] != '\\0' && stat(p, &st) == 0;
}

static int mkdir_p(const char *dir) {
  char tmp[1024];
  snprintf(tmp, sizeof(tmp), "%s", dir);
  size_t len = strlen(tmp);
  if (len == 0) return -1;
  if (tmp[len - 1] == '/') tmp[len - 1] = '\\0';
  for (char *p = tmp + 1; *p; p++) {
    if (*p == '/') {
      *p = '\\0';
      mkdir(tmp, 0755);
      *p = '/';
    }
  }
  return (mkdir(tmp, 0755) == 0 || errno == EEXIST) ? 0 : -1;
}

static int read_trailer(const char *self_path, uint64_t *out_offset, uint64_t *out_size) {
  FILE *f = fopen(self_path, "rb");
  if (!f) return -1;
  if (fseeko(f, 0, SEEK_END) != 0) { fclose(f); return -1; }
  off_t total = ftello(f);
  if (total < TRAILER_SIZE) { fclose(f); return -1; }
  if (fseeko(f, total - TRAILER_SIZE, SEEK_SET) != 0) { fclose(f); return -1; }
  unsigned char trailer[TRAILER_SIZE];
  if (fread(trailer, 1, TRAILER_SIZE, f) != TRAILER_SIZE) { fclose(f); return -1; }
  fclose(f);

  if (memcmp(trailer, TRAILER_MAGIC, 16) != 0) return -1;
  uint64_t off = read_le64(trailer + 16);
  uint64_t sz = read_le64(trailer + 24);
  if (off == 0 || sz == 0 || (off_t)(off + sz + TRAILER_SIZE) > total) return -1;
  *out_offset = off;
  *out_size = sz;
  return 0;
}

static int extract_payload_to(const char *self_path, uint64_t offset, uint64_t size, const char *dest_dir) {
  if (mkdir_p(dest_dir) != 0) {
    fprintf(stderr, "[Aegis AppImage] Falha ao criar diretorio: %s\\n", dest_dir);
    return 1;
  }

  char tmp_tar[1200];
  snprintf(tmp_tar, sizeof(tmp_tar), "%s/.aegis-payload-%ld.tar.gz", dest_dir, (long)getpid());

  FILE *in = fopen(self_path, "rb");
  if (!in) { perror("fopen(self)"); return 1; }
  if (fseeko(in, (off_t)offset, SEEK_SET) != 0) { fclose(in); return 1; }

  FILE *out = fopen(tmp_tar, "wb");
  if (!out) { fclose(in); perror("fopen(tmp_tar)"); return 1; }

  unsigned char buf[65536];
  uint64_t rem = size;
  while (rem > 0) {
    size_t chunk = rem < sizeof(buf) ? (size_t)rem : sizeof(buf);
    size_t n = fread(buf, 1, chunk, in);
    if (n == 0) break;
    if (fwrite(buf, 1, n, out) != n) {
      fclose(in); fclose(out); unlink(tmp_tar);
      return 1;
    }
    rem -= n;
  }
  fclose(in);
  fclose(out);
  if (rem != 0) {
    unlink(tmp_tar);
    fprintf(stderr, "[Aegis AppImage] Payload incompleto ao extrair.\\n");
    return 1;
  }

  pid_t pid = fork();
  if (pid < 0) { unlink(tmp_tar); return 1; }
  if (pid == 0) {
    char *tar_argv[] = {"tar", "-xzf", tmp_tar, "--strip-components=1", "-C", (char *)dest_dir, NULL};
    execvp("tar", tar_argv);
    _exit(127);
  }
  int status = 0;
  waitpid(pid, &status, 0);
  unlink(tmp_tar);
  return (WIFEXITED(status) && WEXITSTATUS(status) == 0) ? 0 : 1;
}

static int ensure_cache_extracted(const char *self_path, uint64_t offset, uint64_t size, char *out_dir, size_t out_sz) {
  const char *home = getenv("HOME");
  if (home && home[0]) {
    snprintf(out_dir, out_sz, "%s/.cache/aegis-appimage/%s", home, APPIMG_VERSION);
  } else {
    snprintf(out_dir, out_sz, "/tmp/aegis-appimage-%s", APPIMG_VERSION);
  }

  char stamp_path[1200];
  char expected_stamp[128];
  char apprun_path[1200];
  char ui_path[1200];
  snprintf(stamp_path, sizeof(stamp_path), "%s/.stamp", out_dir);
  snprintf(apprun_path, sizeof(apprun_path), "%s/AppRun", out_dir);
  snprintf(ui_path, sizeof(ui_path), "%s/opt/aegis/ui.html", out_dir);
  snprintf(expected_stamp, sizeof(expected_stamp), "%llu:%llu", (unsigned long long)offset, (unsigned long long)size);

  if (file_exists(apprun_path) && file_exists(ui_path)) {
    FILE *sf = fopen(stamp_path, "r");
    if (sf) {
      char got[128] = "";
      if (fgets(got, sizeof(got), sf)) {
        got[strcspn(got, "\\r\\n")] = '\\0';
        if (strcmp(got, expected_stamp) == 0) {
          fclose(sf);
          return 0;
        }
      }
      fclose(sf);
    }
  }

  if (extract_payload_to(self_path, offset, size, out_dir) != 0) {
    return 1;
  }

  FILE *sf = fopen(stamp_path, "w");
  if (sf) {
    fprintf(sf, "%s\\n", expected_stamp);
    fclose(sf);
  }
  return 0;
}

static int integrate_desktop(const char *self_path, const char *cache_dir) {
  const char *home = getenv("HOME");
  if (!home || !home[0]) {
    fprintf(stderr, "[Aegis AppImage] HOME nao definido.\\n");
    return 1;
  }
  char apps_dir[1024], icons_dir[1024], desktop_file[1200], icon_dest[1200], icon_src[1200];
  snprintf(apps_dir, sizeof(apps_dir), "%s/.local/share/applications", home);
  snprintf(icons_dir, sizeof(icons_dir), "%s/.local/share/icons/hicolor/scalable/apps", home);
  mkdir_p(apps_dir);
  mkdir_p(icons_dir);

  snprintf(icon_src, sizeof(icon_src), "%s/aegis-desktop.svg", cache_dir);
  snprintf(icon_dest, sizeof(icon_dest), "%s/aegis-desktop.svg", icons_dir);
  FILE *fi = fopen(icon_src, "rb");
  if (fi) {
    FILE *fo = fopen(icon_dest, "wb");
    if (fo) {
      unsigned char b[8192];
      size_t n;
      while ((n = fread(b, 1, sizeof(b), fi)) > 0) fwrite(b, 1, n, fo);
      fclose(fo);
    }
    fclose(fi);
  }

  snprintf(desktop_file, sizeof(desktop_file), "%s/aegis-desktop-appimage.desktop", apps_dir);
  FILE *df = fopen(desktop_file, "w");
  if (!df) { perror("fopen(desktop)"); return 1; }
  fprintf(df,
    "[Desktop Entry]\\n"
    "Type=Application\\n"
    "Version=1.0\\n"
    "Name=Aegis Desktop (AppImage)\\n"
    "GenericName=Orquestrador Neural Autonomo\\n"
    "Comment=Aegis Desktop HUD Holografica 3D Portatil\\n"
    "Exec=\\"%s\\" --ui\\n"
    "Icon=%s\\n"
    "Terminal=false\\n"
    "Categories=System;Utility;Development;\\n"
    "StartupNotify=true\\n",
    self_path, icon_dest);
  fclose(df);
  chmod(desktop_file, 0644);
  printf("Atalho criado no menu do sistema: %s\\n", desktop_file);
  return 0;
}

int main(int argc, char *argv[]) {
  char self_path[1024];
  ssize_t n = readlink("/proc/self/exe", self_path, sizeof(self_path) - 1);
  if (n <= 0) {
    fprintf(stderr, "[Aegis AppImage] Nao foi possivel resolver /proc/self/exe\\n");
    return 1;
  }
  self_path[n] = '\\0';

  if (argc > 1 && (strcmp(argv[1], "--appimage-version") == 0)) {
    printf("AegisDesktop AppImage v%s (Linux x86_64 ELF, zero-FUSE self-contained runtime)\\n", APPIMG_VERSION);
    return 0;
  }

  if (argc > 1 && (strcmp(argv[1], "--appimage-help") == 0)) {
    printf("AegisDesktop-%s-x86_64.AppImage (Portatil, sem FUSE, sem root)\\n", APPIMG_VERSION);
    printf("  (sem argumentos)     Inicia o daemon local e abre a HUD Holografica 3D\\n");
    printf("  --appimage-version   Exibe versao da AppImage\\n");
    printf("  --appimage-extract   Extrai o AppDir interno em ./squashfs-root\\n");
    printf("  --integrate          Cria atalho no menu de aplicativos (~/.local/share/applications)\\n");
    printf("  --doctor             Executa diagnostico completo do sistema\\n");
    printf("  --status | --start | --stop\\n");
    return 0;
  }

  uint64_t offset = 0, size = 0;
  if (read_trailer(self_path, &offset, &size) != 0) {
    fprintf(stderr, "[Aegis AppImage] Arquivo AppImage corrompido (trailer nao encontrado).\\n");
    return 1;
  }

  if (argc > 1 && strcmp(argv[1], "--appimage-extract") == 0) {
    if (extract_payload_to(self_path, offset, size, "squashfs-root") != 0) {
      return 1;
    }
    printf("squashfs-root\\n");
    return 0;
  }

  char cache_dir[1024];
  if (ensure_cache_extracted(self_path, offset, size, cache_dir, sizeof(cache_dir)) != 0) {
    fprintf(stderr, "[Aegis AppImage] Falha ao preparar cache local em %s\\n", cache_dir);
    return 1;
  }

  if (argc > 1 && strcmp(argv[1], "--integrate") == 0) {
    return integrate_desktop(self_path, cache_dir);
  }

  char opt_dir[1200];
  char apprun[1200];
  snprintf(opt_dir, sizeof(opt_dir), "%s/opt/aegis", cache_dir);
  snprintf(apprun, sizeof(apprun), "%s/AppRun", cache_dir);

  setenv("APPDIR", cache_dir, 1);
  setenv("APPIMAGE", self_path, 1);
  setenv("AEGIS_HOME", opt_dir, 1);

  char **child_argv = calloc((size_t)argc + 1, sizeof(char *));
  if (!child_argv) return 1;
  child_argv[0] = apprun;
  for (int i = 1; i < argc; i++) {
    child_argv[i] = argv[i];
  }
  child_argv[argc] = NULL;
  execv(apprun, child_argv);
  perror("execv(AppRun)");
  free(child_argv);
  return 127;
}
`;

const APPIMAGE_APPRUN_SH = `#!/bin/sh
set -e
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export APPDIR="$HERE"
export AEGIS_HOME="$HERE/opt/aegis"
exec "$HERE/usr/bin/aegis-desktop" "$@"
`;

export function buildLinuxNativeArtifacts(): LinuxNativeCache {
  if (linuxCache) return linuxCache;

  const linuxDir = path.join(BUILD_ROOT, 'linux');
  const debRoot = path.join(linuxDir, 'deb-pkg');
  const appDirRoot = path.join(linuxDir, 'appimage-stage', 'AegisDesktop.AppDir');
  const tarRoot = path.join(linuxDir, 'tar-pkg', `aegis-desktop-${APP_VERSION}`);

  fs.rmSync(linuxDir, { recursive: true, force: true });
  fs.mkdirSync(linuxDir, { recursive: true });

  // 1. Compile genuine Linux x86_64 ELF binary with gcc
  const cSrcPath = path.join(linuxDir, 'aegis-desktop.c');
  const elfOutPath = path.join(linuxDir, 'aegis-desktop');
  fs.writeFileSync(cSrcPath, AEGIS_LINUX_NATIVE_C, 'utf8');
  execFileSync('gcc', ['-O2', '-s', '-Wall', '-Wextra', '-o', elfOutPath, cSrcPath], {
    stdio: 'pipe',
  });
  fs.chmodSync(elfOutPath, 0o755);
  const elfBuffer = fs.readFileSync(elfOutPath);

  // Runtime files from linuxBundle.ts (now powered by 3D Holographic HUD ui.html)
  const bundleFiles = getLinuxBundleFiles();
  const runtimeNames = new Set(['aegis-daemon.mjs', 'aegis-cli.mjs', 'ui.html', 'package.json']);
  const runtimeFiles = bundleFiles.filter((f) => runtimeNames.has(f.name));

  // 2. Assemble real Debian .deb structure
  const debDirs = [
    'DEBIAN',
    'usr/bin',
    'opt/aegis',
    'usr/share/applications',
    'usr/share/icons/hicolor/scalable/apps',
    'usr/lib/systemd/user',
  ];
  for (const d of debDirs) {
    fs.mkdirSync(path.join(debRoot, d), { recursive: true });
  }

  fs.writeFileSync(path.join(debRoot, 'DEBIAN/control'), DEBIAN_CONTROL, { mode: 0o644 });
  fs.writeFileSync(path.join(debRoot, 'DEBIAN/postinst'), DEBIAN_POSTINST, { mode: 0o755 });
  fs.writeFileSync(path.join(debRoot, 'DEBIAN/prerm'), DEBIAN_PRERM, { mode: 0o755 });
  fs.writeFileSync(path.join(debRoot, 'DEBIAN/postrm'), DEBIAN_POSTRM, { mode: 0o755 });

  fs.copyFileSync(elfOutPath, path.join(debRoot, 'usr/bin/aegis-desktop'));
  fs.chmodSync(path.join(debRoot, 'usr/bin/aegis-desktop'), 0o755);
  fs.symlinkSync('aegis-desktop', path.join(debRoot, 'usr/bin/aegis'));

  for (const rf of runtimeFiles) {
    const dest = path.join(debRoot, 'opt/aegis', rf.name);
    fs.writeFileSync(dest, rf.content, {
      mode: rf.name.endsWith('.mjs') ? 0o755 : 0o644,
    });
  }

  fs.writeFileSync(
    path.join(debRoot, 'usr/share/applications/aegis-desktop.desktop'),
    LINUX_DESKTOP_ENTRY,
    { mode: 0o644 }
  );
  fs.writeFileSync(
    path.join(debRoot, 'usr/share/icons/hicolor/scalable/apps/aegis-desktop.svg'),
    AEGIS_LINUX_SVG_ICON,
    { mode: 0o644 }
  );
  fs.writeFileSync(
    path.join(debRoot, 'usr/lib/systemd/user/aegis-desktop.service'),
    LINUX_SYSTEMD_USER_UNIT,
    { mode: 0o644 }
  );

  const debOutPath = path.join(linuxDir, `aegis-desktop_${APP_VERSION}_amd64.deb`);
  execFileSync('dpkg-deb', ['--build', '--root-owner-group', debRoot, debOutPath], {
    stdio: 'pipe',
  });
  const debBuffer = fs.readFileSync(debOutPath);

  // 3. Compile Self-Contained x86_64 .AppImage (Zero-FUSE ELF + embedded AppDir .tar.gz + 32B trailer)
  const appImgSrcPath = path.join(linuxDir, 'aegis-appimage-runtime.c');
  const appImgRuntimePath = path.join(linuxDir, 'aegis-appimage-runtime');
  fs.writeFileSync(appImgSrcPath, AEGIS_APPIMAGE_RUNTIME_C, 'utf8');
  execFileSync('gcc', ['-O2', '-s', '-Wall', '-Wextra', '-o', appImgRuntimePath, appImgSrcPath], {
    stdio: 'pipe',
  });
  const appImgRuntimeBuf = fs.readFileSync(appImgRuntimePath);

  for (const d of ['usr/bin', 'opt/aegis']) {
    fs.mkdirSync(path.join(appDirRoot, d), { recursive: true });
  }
  fs.writeFileSync(path.join(appDirRoot, 'AppRun'), APPIMAGE_APPRUN_SH, { mode: 0o755 });
  fs.writeFileSync(
    path.join(appDirRoot, 'aegis-desktop.desktop'),
    LINUX_DESKTOP_ENTRY.replace('/usr/bin/aegis-desktop', 'AppRun'),
    { mode: 0o644 }
  );
  fs.writeFileSync(path.join(appDirRoot, 'aegis-desktop.svg'), AEGIS_LINUX_SVG_ICON, { mode: 0o644 });
  fs.copyFileSync(elfOutPath, path.join(appDirRoot, 'usr/bin/aegis-desktop'));
  fs.chmodSync(path.join(appDirRoot, 'usr/bin/aegis-desktop'), 0o755);

  for (const rf of runtimeFiles) {
    fs.writeFileSync(path.join(appDirRoot, 'opt/aegis', rf.name), rf.content, {
      mode: rf.name.endsWith('.mjs') ? 0o755 : 0o644,
    });
  }

  const appDirPayloadPath = path.join(linuxDir, 'appdir-payload.tar.gz');
  execFileSync(
    'tar',
    ['-czf', appDirPayloadPath, '-C', path.join(linuxDir, 'appimage-stage'), 'AegisDesktop.AppDir'],
    { stdio: 'pipe' }
  );
  const appDirPayloadBuf = fs.readFileSync(appDirPayloadPath);

  const trailerBuf = Buffer.alloc(32);
  trailerBuf.write('AEGIS_APPIMG_V01', 0, 16, 'ascii');
  trailerBuf.writeBigUInt64LE(BigInt(appImgRuntimeBuf.length), 16);
  trailerBuf.writeBigUInt64LE(BigInt(appDirPayloadBuf.length), 24);

  const appImageBuffer = Buffer.concat([appImgRuntimeBuf, appDirPayloadBuf, trailerBuf]);
  const appImageOutPath = path.join(linuxDir, `AegisDesktop-${APP_VERSION}-x86_64.AppImage`);
  fs.writeFileSync(appImageOutPath, appImageBuffer, { mode: 0o755 });

  // 4. Assemble Universal Linux .tar.gz (ELF binary + runtime + Electron project)
  for (const d of ['bin', 'opt/aegis', 'share', 'electron-app/runtime']) {
    fs.mkdirSync(path.join(tarRoot, d), { recursive: true });
  }
  fs.copyFileSync(elfOutPath, path.join(tarRoot, 'bin/aegis-desktop'));
  fs.chmodSync(path.join(tarRoot, 'bin/aegis-desktop'), 0o755);

  for (const rf of runtimeFiles) {
    fs.writeFileSync(path.join(tarRoot, 'opt/aegis', rf.name), rf.content, {
      mode: rf.name.endsWith('.mjs') ? 0o755 : 0o644,
    });
    fs.writeFileSync(path.join(tarRoot, 'electron-app/runtime', rf.name), rf.content, {
      mode: rf.name.endsWith('.mjs') ? 0o755 : 0o644,
    });
  }

  fs.writeFileSync(path.join(tarRoot, 'share/aegis-desktop.desktop'), LINUX_DESKTOP_ENTRY, { mode: 0o644 });
  fs.writeFileSync(path.join(tarRoot, 'share/aegis-desktop.svg'), AEGIS_LINUX_SVG_ICON, { mode: 0o644 });
  fs.writeFileSync(path.join(tarRoot, 'share/aegis-desktop.service'), LINUX_SYSTEMD_USER_UNIT, { mode: 0o644 });
  fs.writeFileSync(path.join(tarRoot, 'install-native-linux.sh'), UNIVERSAL_LINUX_INSTALL_SH, { mode: 0o755 });

  const electronFiles = getElectronAppFiles('http://127.0.0.1:3847');
  for (const [fname, content] of Object.entries(electronFiles)) {
    fs.writeFileSync(path.join(tarRoot, 'electron-app', fname), content, { mode: 0o644 });
  }

  // Include ready-to-use GitHub Actions workflow to build Linux (.AppImage/.deb/.rpm) & Windows (.exe/.msi) installers automatically
  fs.mkdirSync(path.join(tarRoot, '.github/workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(tarRoot, '.github/workflows/build-aegis-native.yml'),
    `name: Build Aegis Desktop Native Installers
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - working-directory: electron-app
        run: |
          npm install
          npm run build:linux
      - uses: actions/upload-artifact@v4
        with:
          name: AegisDesktop-Linux-${APP_VERSION}
          path: electron-app/dist-installers/*

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - working-directory: electron-app
        run: |
          npm install
          npm run build:win
      - uses: actions/upload-artifact@v4
        with:
          name: AegisDesktop-Windows-${APP_VERSION}
          path: electron-app/dist-installers/*
`,
    { mode: 0o644 }
  );

  const tarOutPath = path.join(linuxDir, 'aegis-desktop-linux-x64.tar.gz');
  execFileSync('tar', ['-czf', tarOutPath, '-C', path.join(linuxDir, 'tar-pkg'), `aegis-desktop-${APP_VERSION}`], {
    stdio: 'pipe',
  });
  const tarGzBuffer = fs.readFileSync(tarOutPath);

  linuxCache = {
    elfBuffer,
    elfSha256: sha256Hex(elfBuffer),
    debBuffer,
    debSha256: sha256Hex(debBuffer),
    appImageBuffer,
    appImageSha256: sha256Hex(appImageBuffer),
    tarGzBuffer,
    tarGzSha256: sha256Hex(tarGzBuffer),
    builtAt: new Date().toISOString(),
  };
  return linuxCache;
}

// ============================================================================
// 2. WINDOWS 10/11 NATIVE DESKTOP APPLICATION (C# WinForms AegisDesktop.exe + NSIS)
// ============================================================================

function getWindowsCSharpAppSource(serverOrigin: string): string {
  const safeOrigin = sanitizeOrigin(serverOrigin);
  return `// AegisDesktop.cs — Aplicativo Nativo Windows (WinForms + System Tray + Daemon Manager)
// Compilado nativamente no Windows 10/11 via csc.exe (.NET Framework integrado ao SO)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace AegisDesktopNative
{
    public class AegisTrayApplication : ApplicationContext
    {
        private const string LocalUrl = "http://127.0.0.1:3847";
        private const string CloudUrl = "${safeOrigin}";
        private NotifyIcon trayIcon;
        private Process daemonProcess;
        private readonly string appDir;
        private readonly string runtimeDir;
        private readonly string envFile;

        public AegisTrayApplication(bool launchUiOnStart)
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            runtimeDir = Path.Combine(appDir, "runtime");
            string appDataAegis = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Aegis"
            );
            Directory.CreateDirectory(appDataAegis);
            envFile = Path.Combine(appDataAegis, "env");
            if (!File.Exists(envFile))
            {
                File.WriteAllText(envFile, "GEMINI_API_KEY=\\r\\nAEGIS_PORT=3847\\r\\n");
            }

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Aegis Desktop (Local HUD)", null, (s, e) => OpenNativeWindow(LocalUrl));
            menu.Items.Add("Abrir Aegis Nuvem", null, (s, e) => OpenNativeWindow(CloudUrl));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Reiniciar Servico Local", null, (s, e) => RestartDaemon());
            menu.Items.Add("Editar Configuracao (GEMINI_API_KEY)", null, (s, e) => Process.Start("notepad.exe", envFile));
            menu.Items.Add("Abrir Pasta do Aplicativo", null, (s, e) => Process.Start("explorer.exe", appDir));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair do Aegis Desktop", null, (s, e) => ExitApp());

            trayIcon = new NotifyIcon
            {
                Text = "Aegis Desktop v${APP_VERSION} (Agente Nativo Windows)",
                Icon = CreateOrbIcon(),
                ContextMenuStrip = menu,
                Visible = true
            };
            trayIcon.DoubleClick += (s, e) => OpenNativeWindow(LocalUrl);

            StartDaemon();

            if (launchUiOnStart)
            {
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    bool online = WaitForDaemon(15);
                    OpenNativeWindow(online ? LocalUrl : CloudUrl);
                });
            }
        }

        private Icon CreateOrbIcon()
        {
            Bitmap bmp = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.FromArgb(7, 11, 18));
                using (Brush outer = new SolidBrush(Color.FromArgb(245, 158, 11)))
                    g.FillEllipse(outer, 4, 4, 24, 24);
                using (Brush inner = new SolidBrush(Color.FromArgb(254, 243, 199)))
                    g.FillEllipse(inner, 10, 10, 12, 12);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        private bool IsPortOpen(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult res = client.BeginConnect("127.0.0.1", port, null, null);
                    bool ok = res.AsyncWaitHandle.WaitOne(250);
                    if (!ok) return false;
                    client.EndConnect(res);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private bool WaitForDaemon(int maxAttempts)
        {
            for (int i = 0; i < maxAttempts; i++)
            {
                if (IsPortOpen(3847)) return true;
                Thread.Sleep(250);
            }
            return IsPortOpen(3847);
        }

        private void StartDaemon()
        {
            if (IsPortOpen(3847)) return;
            string daemonPath = Path.Combine(runtimeDir, "aegis-daemon.mjs");
            if (!File.Exists(daemonPath)) return;

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\\"" + daemonPath + "\\"",
                WorkingDirectory = runtimeDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };

            if (File.Exists(envFile))
            {
                foreach (string rawLine in File.ReadAllLines(envFile))
                {
                    string line = rawLine.Trim();
                    if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                    int eq = line.IndexOf('=');
                    if (eq > 0)
                    {
                        string k = line.Substring(0, eq).Trim();
                        string v = line.Substring(eq + 1).Trim();
                        if (!string.IsNullOrEmpty(v)) psi.EnvironmentVariables[k] = v;
                    }
                }
            }

            try
            {
                daemonProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                trayIcon.ShowBalloonTip(4000, "Aegis Desktop", "Node.js nao encontrado: " + ex.Message, ToolTipIcon.Warning);
            }
        }

        private void RestartDaemon()
        {
            try
            {
                if (daemonProcess != null && !daemonProcess.HasExited) daemonProcess.Kill();
            }
            catch { }
            StartDaemon();
            trayIcon.ShowBalloonTip(2500, "Aegis Desktop", "Servico local reiniciado na porta 3847.", ToolTipIcon.Info);
        }

        private void OpenNativeWindow(string targetUrl)
        {
            string[] candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google", "Chrome", "Application", "chrome.exe")
            };

            foreach (string exe in candidates)
            {
                if (File.Exists(exe))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exe,
                        Arguments = "--app=" + targetUrl + " --window-size=1280,820",
                        UseShellExecute = false
                    });
                    return;
                }
            }

            Process.Start(new ProcessStartInfo { FileName = targetUrl, UseShellExecute = true });
        }

        private void ExitApp()
        {
            trayIcon.Visible = false;
            try
            {
                if (daemonProcess != null && !daemonProcess.HasExited) daemonProcess.Kill();
            }
            catch { }
            Application.Exit();
        }

        [STAThread]
        static void Main(string[] args)
        {
            bool backgroundOnly = false;
            foreach (string a in args)
            {
                if (a.Equals("--background", StringComparison.OrdinalIgnoreCase)) backgroundOnly = true;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new AegisTrayApplication(!backgroundOnly));
        }
    }
}
`;
}

const WINDOWS_UNINSTALLER_CS = `// AegisUninstall.cs — Desinstalador Nativo Windows (registrado em Aplicativos Instalados)
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AegisDesktopNative
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            DialogResult res = MessageBox.Show(
                "Deseja desinstalar o Aegis Desktop deste computador Windows?",
                "Desinstalar Aegis Desktop",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (res != DialogResult.Yes) return;

            foreach (Process p in Process.GetProcessesByName("AegisDesktop"))
            {
                try { p.Kill(); } catch { }
            }

            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AegisDesktop", false); } catch { }
            try
            {
                using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
                {
                    if (runKey != null) runKey.DeleteValue("AegisDesktop", false);
                }
            }
            catch { }

            string startMenuLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Aegis Desktop.lnk");
            string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Aegis Desktop.lnk");
            try { if (File.Exists(startMenuLnk)) File.Delete(startMenuLnk); } catch { }
            try { if (File.Exists(desktopLnk)) File.Delete(desktopLnk); } catch { }

            string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "AegisDesktop");
            MessageBox.Show(
                "Aegis Desktop removido do Menu Iniciar, inicializacao e registro do Windows.\\nPasta residual (pode apagar se desejar):\\n" + installDir,
                "Aegis Desktop Desinstalado",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }
    }
}
`;

const WINDOWS_NATIVE_INSTALLER_CMD = `@echo off
setlocal enabledelayedexpansion
title Instalador Nativo - Aegis Desktop v${APP_VERSION} (Windows 10/11)
color 0E

echo ====================================================================
echo   AEGIS DESKTOP v${APP_VERSION} — INSTALADOR NATIVO WINDOWS (.EXE)
echo ====================================================================
echo.

set "SRC_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\\Programs\\AegisDesktop"
set "RUNTIME_DIR=%INSTALL_DIR%\\runtime"
set "CSC=%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"

if not exist "%CSC%" (
  set "CSC=%WINDIR%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
)

if not exist "%CSC%" (
  echo [ERRO] Compilador .NET do Windows (csc.exe) nao encontrado.
  echo Use a pasta electron-installer com "npm install && npm run build:win".
  pause
  exit /b 1
)

echo [1/6] Criando diretorio nativo em %INSTALL_DIR%...
mkdir "%INSTALL_DIR%" 2>nul
mkdir "%RUNTIME_DIR%" 2>nul

echo [2/6] Compilando executaveis nativos Windows (AegisDesktop.exe e AegisUninstall.exe)...
"%CSC%" /nologo /optimize+ /target:winexe /out:"%INSTALL_DIR%\\AegisDesktop.exe" ^
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  "%SRC_DIR%native-src\\AegisDesktop.cs"
if errorlevel 1 (
  echo [ERRO] Falha ao compilar AegisDesktop.exe.
  pause
  exit /b 1
)

"%CSC%" /nologo /optimize+ /target:winexe /out:"%INSTALL_DIR%\\AegisUninstall.exe" ^
  /r:System.dll /r:System.Windows.Forms.dll ^
  "%SRC_DIR%native-src\\AegisUninstall.cs"

echo [3/6] Instalando runtime local e comando CLI global (aegis.cmd)...
xcopy /E /I /Y "%SRC_DIR%runtime\\*" "%RUNTIME_DIR%\\" >nul

(
  echo @echo off
  echo node "%%LOCALAPPDATA%%\\Programs\\AegisDesktop\\runtime\\aegis-cli.mjs" %%*
) > "%INSTALL_DIR%\\aegis.cmd"

echo [4/6] Verificando Node.js e instalando dependencias...
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao detectado. Tentando instalar via winget...
  where winget >nul 2>&1 && winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
)
where npm >nul 2>&1 && (
  pushd "%RUNTIME_DIR%"
  call npm install --omit=dev --no-audit --no-fund
  popd
)

echo [5/6] Registrando no Windows (Menu Iniciar, Area de Trabalho, Aplicativos Instalados e Logon)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$sm = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Aegis Desktop.lnk'; " ^
  "$s1 = $ws.CreateShortcut($sm); $s1.TargetPath = '%INSTALL_DIR%\\AegisDesktop.exe'; $s1.WorkingDirectory = '%INSTALL_DIR%'; $s1.Description = 'Aegis Desktop Native Orchestrator'; $s1.Save(); " ^
  "$dt = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aegis Desktop.lnk'; " ^
  "$s2 = $ws.CreateShortcut($dt); $s2.TargetPath = '%INSTALL_DIR%\\AegisDesktop.exe'; $s2.WorkingDirectory = '%INSTALL_DIR%'; $s2.Description = 'Aegis Desktop Native Orchestrator'; $s2.Save(); " ^
  "$uninst = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AegisDesktop'; " ^
  "New-Item -Path $uninst -Force | Out-Null; " ^
  "Set-ItemProperty -Path $uninst -Name 'DisplayName' -Value 'Aegis Desktop'; " ^
  "Set-ItemProperty -Path $uninst -Name 'DisplayVersion' -Value '${APP_VERSION}'; " ^
  "Set-ItemProperty -Path $uninst -Name 'Publisher' -Value 'Aegis Autonomous Systems'; " ^
  "Set-ItemProperty -Path $uninst -Name 'InstallLocation' -Value '%INSTALL_DIR%'; " ^
  "Set-ItemProperty -Path $uninst -Name 'UninstallString' -Value '\"%INSTALL_DIR%\\AegisUninstall.exe\"'; " ^
  "Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'AegisDesktop' -Value '\"%INSTALL_DIR%\\AegisDesktop.exe\" --background'; " ^
  "$p = [Environment]::GetEnvironmentVariable('Path', 'User'); " ^
  "if ($p -notlike '*AegisDesktop*') { [Environment]::SetEnvironmentVariable('Path', ($p + ';%INSTALL_DIR%'), 'User') }"

echo [6/6] Iniciando AegisDesktop.exe...
start "" "%INSTALL_DIR%\\AegisDesktop.exe"

echo.
echo ====================================================================
echo   SUCESSO! AegisDesktop.exe instalado e em execucao na bandeja!
echo   - Menu Iniciar: "Aegis Desktop"
echo   - Aplicativos Instalados do Windows: "Aegis Desktop v${APP_VERSION}"
echo   - Terminal: aegis --chat
echo ====================================================================
pause
`;

const INNO_SETUP_ISS = `; AegisSetup.iss — Script opcional para gerar Setup-AegisDesktop-${APP_VERSION}.exe via Inno Setup
[Setup]
AppName=Aegis Desktop
AppVersion=${APP_VERSION}
DefaultDirName={autopf}\\AegisDesktop
DefaultGroupName=Aegis Desktop
OutputBaseFilename=AegisDesktop-Setup-${APP_VERSION}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest

[Files]
Source: "dist\\AegisDesktop.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "runtime\\*"; DestDir: "{app}\\runtime"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\\Aegis Desktop"; Filename: "{app}\\AegisDesktop.exe"
Name: "{autodesktop}\\Aegis Desktop"; Filename: "{app}\\AegisDesktop.exe"

[Run]
Filename: "{app}\\AegisDesktop.exe"; Description: "Iniciar Aegis Desktop"; Flags: nowait postinstall skipifsilent
`;

const WINDOWS_README = `# Aegis Desktop v${APP_VERSION} — Aplicativo Nativo Windows 10 / 11

Este pacote instala um **aplicativo Windows real (\`AegisDesktop.exe\`)**, com icone na Bandeja do Sistema (System Tray), atalho no Menu Iniciar, entrada oficial em **Configuracoes -> Aplicativos Instalados** e inicializacao automatica no logon — **sem precisar baixar SDK externo**.

## Instalacao em 1 clique (Recomendado)
1. Extraia este arquivo \`.zip\`.
2. De um clique duplo em **\`Instalar-Aegis-Windows.cmd\`**.
3. O instalador usa o compilador .NET nativo do proprio Windows (\`csc.exe\`) para gerar \`AegisDesktop.exe\` e \`AegisUninstall.exe\` em \`%LOCALAPPDATA%\\Programs\\AegisDesktop\\\`, registra o aplicativo no sistema e abre o Aegis imediatamente.

## Opcional: Gerar instalador unico NSIS (.exe) / MSI (.msi) via Electron
Abra a pasta \`electron-installer/\` no PowerShell e execute:
\`\`\`powershell
npm install
npm run build:win
\`\`\`
Os instaladores binarios aparecerao em \`electron-installer/dist-installers/\`.
`;

export async function buildWindowsNativePackageZip(serverOrigin: string): Promise<{ buffer: Buffer; sha256: string }> {
  const safeOrigin = sanitizeOrigin(serverOrigin);
  const cached = windowsCache.get(safeOrigin);
  if (cached) return cached;

  const zip = new JSZip();
  const root = zip.folder(`AegisDesktop-Windows-${APP_VERSION}`)!;

  root.file('Instalar-Aegis-Windows.cmd', WINDOWS_NATIVE_INSTALLER_CMD.replace(/\n/g, '\r\n'));
  root.file('README-WINDOWS.md', WINDOWS_README);
  root.file('native-src/AegisDesktop.cs', getWindowsCSharpAppSource(safeOrigin));
  root.file('native-src/AegisUninstall.cs', WINDOWS_UNINSTALLER_CS);
  root.file('AegisSetup.iss', INNO_SETUP_ISS);

  const bundleFiles = getLinuxBundleFiles();
  const runtimeNames = new Set(['aegis-daemon.mjs', 'aegis-cli.mjs', 'ui.html', 'package.json']);
  for (const rf of bundleFiles) {
    if (runtimeNames.has(rf.name)) {
      root.file(`runtime/${rf.name}`, rf.content);
      root.file(`electron-installer/runtime/${rf.name}`, rf.content);
    }
  }

  const electronFiles = getElectronAppFiles(safeOrigin);
  for (const [fname, content] of Object.entries(electronFiles)) {
    root.file(`electron-installer/${fname}`, content);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const entry = { buffer, sha256: sha256Hex(buffer) };
  windowsCache.set(safeOrigin, entry);
  return entry;
}

// ============================================================================
// 3. ANDROID NATIVE STUDIO / GRADLE KOTLIN APP (com.aegis.agent -> APK)
// ============================================================================

export async function buildAndroidNativeProjectZip(
  serverOrigin: string,
  pairingCode?: string
): Promise<{ buffer: Buffer; sha256: string }> {
  const safeOrigin = sanitizeOrigin(serverOrigin);
  const safeCode = sanitizePairingCode(pairingCode);
  const wsUrl = safeOrigin.replace(/^http/i, 'ws') + '/api/devices/ws?role=device';

  const zip = new JSZip();
  const root = zip.folder(`AegisAndroid-Native-${APP_VERSION}`)!;

  root.file(
    'settings.gradle.kts',
    `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "AegisAndroid"
include(":app")
`
  );

  root.file(
    'build.gradle.kts',
    `plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
`
  );

  root.file(
    'gradle.properties',
    `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`
  );

  root.file(
    'gradle/wrapper/gradle-wrapper.properties',
    `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
  );

  root.file(
    'app/build.gradle.kts',
    `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aegis.agent"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aegis.agent"
        minSdk = 26
        targetSdk = 34
        versionCode = 210
        versionName = "${APP_VERSION}"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
`
  );

  root.file('app/proguard-rules.pro', `# Keep Aegis runtime classes\n-keep class com.aegis.agent.** { *; }\n`);

  root.file(
    'app/src/main/assets/aegis_hud.html',
    getLocalHoloUiHtml({ platformMode: 'android', appVersion: APP_VERSION })
  );

  root.file(
    'app/src/main/AndroidManifest.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />

    <application
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:enableOnBackInvokedCallback="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:theme="@style/Theme.AegisNative"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:hardwareAccelerated="true"
            android:windowSoftInputMode="adjustResize"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".AegisForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="dataSync" />

        <service
            android:name=".AegisAccessibilityService"
            android:exported="false"
            android:label="@string/accessibility_service_label"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/aegis_accessibility_config" />
        </service>

        <service
            android:name=".AegisNotificationListener"
            android:exported="false"
            android:label="@string/notification_listener_label"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>

        <receiver
            android:name=".BootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/AegisConfig.kt',
    `package com.aegis.agent

import android.content.Context
import android.net.Uri

object AegisConfig {
    const val DEFAULT_SERVER_ORIGIN = "${safeOrigin}"
    const val DEFAULT_WS_URL = "${wsUrl}"
    const val PREFILLED_PAIRING_CODE = "${safeCode}"

    private const val PREFS = "aegis_native_prefs"

    fun normalizeOrigin(raw: String?): String {
        val trimmed = (raw ?: "").trim().trimEnd('/')
        if (trimmed.isBlank()) return ""
        val withScheme = if (trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            trimmed
        } else {
            "https://" + trimmed
        }
        return try {
            val parsed = Uri.parse(withScheme)
            if (parsed.scheme.isNullOrBlank() || parsed.host.isNullOrBlank()) "" else withScheme
        } catch (_: Exception) {
            ""
        }
    }

    fun getServerOrigin(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val saved = prefs.getString("server_origin", DEFAULT_SERVER_ORIGIN) ?: DEFAULT_SERVER_ORIGIN
        val normalized = normalizeOrigin(saved)
        return if (normalized.isNotBlank()) normalized else normalizeOrigin(DEFAULT_SERVER_ORIGIN)
    }

    fun setServerOrigin(ctx: Context, origin: String) {
        val clean = normalizeOrigin(origin)
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("server_origin", clean)
            .apply()
    }

    fun getWsUrl(ctx: Context): String {
        val origin = getServerOrigin(ctx)
        if (origin.isBlank()) return ""
        val ws = if (origin.startsWith("https://", ignoreCase = true)) {
            "wss://" + origin.substring(8)
        } else if (origin.startsWith("http://", ignoreCase = true)) {
            "ws://" + origin.substring(7)
        } else {
            return ""
        }
        return ws + "/api/devices/ws?role=device"
    }

    fun getDeviceToken(ctx: Context): String {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("device_token", "") ?: ""
    }

    fun setDeviceToken(ctx: Context, token: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("device_token", token)
            .apply()
    }

    fun getPairingCode(ctx: Context): String {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("pairing_code", PREFILLED_PAIRING_CODE) ?: PREFILLED_PAIRING_CODE
    }

    fun setPairingCode(ctx: Context, code: String) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("pairing_code", code.trim().uppercase())
            .apply()
    }
}
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/MainActivity.kt',
    `package com.aegis.agent

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val localHudUrl = "file:///android_asset/aegis_hud.html"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestRuntimePermissions()

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#05070B"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#05070B"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true

            addJavascriptInterface(AegisAndroidBridge(), "AegisAndroid")

            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    runOnUiThread {
                        try {
                            request?.grant(request.resources)
                        } catch (_: Exception) {
                            request?.deny()
                        }
                    }
                }
            }

            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    val isMainFrame = request?.isForMainFrame ?: true
                    val failedUrl = request?.url?.toString() ?: ""
                    if (isMainFrame && !failedUrl.startsWith("file:///android_asset/")) {
                        runOnUiThread {
                            Toast.makeText(
                                this@MainActivity,
                                "Servidor remoto inacessivel. Abrindo HUD Holografica embarcada...",
                                Toast.LENGTH_LONG
                            ).show()
                            view?.loadUrl(localHudUrl)
                        }
                    }
                }
            }
        }

        root.addView(webView)
        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val current = webView.url ?: ""
                if (webView.canGoBack()) {
                    webView.goBack()
                } else if (!current.startsWith("file:///android_asset/")) {
                    webView.loadUrl(localHudUrl)
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        // Carrega imediatamente a HUD Holografica 3D embarcada (zero tela branca, zero erro de rede)
        webView.loadUrl(localHudUrl)

        // Apenas auto-inicia o ForegroundService se ja houver token pareado + servidor valido
        if (AegisConfig.getDeviceToken(this).isNotBlank() && AegisConfig.getWsUrl(this).isNotBlank()) {
            startAegisServiceSafely()
        }
    }

    private fun requestRuntimePermissions() {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            perms.add(Manifest.permission.RECORD_AUDIO)
        }
        if (perms.isNotEmpty()) {
            try {
                ActivityCompat.requestPermissions(this, perms.toTypedArray(), 201)
            } catch (_: Exception) {}
        }
    }

    private fun startAegisServiceSafely(): Boolean {
        return try {
            val intent = Intent(this, AegisForegroundService::class.java)
            ContextCompat.startForegroundService(this, intent)
            true
        } catch (e: Exception) {
            AegisForegroundService.lastError = e.message ?: "Falha ao iniciar servico"
            runOnUiThread {
                Toast.makeText(
                    this,
                    "Ative notificacoes ou bateria para rodar o servico em 2o plano.",
                    Toast.LENGTH_LONG
                ).show()
            }
            false
        }
    }

    inner class AegisAndroidBridge {

        @JavascriptInterface
        fun getStatusJson(): String {
            return try {
                val filesGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Environment.isExternalStorageManager()
                } else {
                    true
                }
                val battIntent = registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                val level = battIntent?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
                val scale = battIntent?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100) ?: 100
                val batteryPct = if (level >= 0 && scale > 0) (level * 100) / scale else -1

                JSONObject().apply {
                    put("serviceRunning", AegisForegroundService.isRunning)
                    put("connectionState", AegisForegroundService.connectionState)
                    put("lastError", AegisForegroundService.lastError)
                    put("serverOrigin", AegisConfig.getServerOrigin(this@MainActivity))
                    put("pairingCode", AegisConfig.getPairingCode(this@MainActivity))
                    put("paired", AegisConfig.getDeviceToken(this@MainActivity).isNotBlank())
                    put("accessibilityEnabled", AegisAccessibilityService.instance != null)
                    put("notificationEnabled", AegisNotificationListener.isActive)
                    put("notificationListenerEnabled", AegisNotificationListener.isActive)
                    put("storageGranted", filesGranted)
                    put("filesGranted", filesGranted)
                    put("batteryPercent", batteryPct)
                    put("manufacturer", Build.MANUFACTURER)
                    put("model", Build.MODEL)
                    put("androidVersion", Build.VERSION.RELEASE)
                    put("sdkInt", Build.VERSION.SDK_INT)
                }.toString()
            } catch (_: Exception) {
                "{}"
            }
        }

        @JavascriptInterface
        fun connectAndStart(origin: String?, pairingCode: String?): String {
            return try {
                if (!origin.isNullOrBlank()) {
                    AegisConfig.setServerOrigin(this@MainActivity, origin)
                }
                if (!pairingCode.isNullOrBlank()) {
                    AegisConfig.setPairingCode(this@MainActivity, pairingCode)
                }
                val resolvedOrigin = AegisConfig.getServerOrigin(this@MainActivity)
                if (resolvedOrigin.isBlank()) {
                    return JSONObject().apply {
                        put("ok", false)
                        put("message", "Informe uma URL de servidor valida (ex: https://seu-aegis.run.app).")
                    }.toString()
                }
                val ok = startAegisServiceSafely()
                if (ok) {
                    runOnUiThread {
                        Toast.makeText(
                            this@MainActivity,
                            "Aegis conectado em segundo plano!",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
                JSONObject().apply {
                    put("ok", ok)
                    put("message", if (ok) "Servico nativo ativo conectando em " + resolvedOrigin else (AegisForegroundService.lastError.ifBlank { "Verifique permissoes de notificacao/bateria." }))
                }.toString()
            } catch (e: Exception) {
                JSONObject().apply {
                    put("ok", false)
                    put("message", e.message ?: "Falha ao iniciar servico Android.")
                }.toString()
            }
        }

        @JavascriptInterface
        fun stopService(): Boolean {
            return try {
                stopService(Intent(this@MainActivity, AegisForegroundService::class.java))
                true
            } catch (_: Exception) {
                false
            }
        }

        @JavascriptInterface
        fun openRemoteHud(origin: String?) {
            runOnUiThread {
                val target = AegisConfig.normalizeOrigin(
                    if (!origin.isNullOrBlank()) origin else AegisConfig.getServerOrigin(this@MainActivity)
                )
                if (target.isBlank()) {
                    Toast.makeText(this@MainActivity, "Informe uma URL de servidor valida.", Toast.LENGTH_SHORT).show()
                } else {
                    AegisConfig.setServerOrigin(this@MainActivity, target)
                    webView.loadUrl(target)
                }
            }
        }

        @JavascriptInterface
        fun openLocalHud() {
            runOnUiThread {
                webView.loadUrl(localHudUrl)
            }
        }

        @JavascriptInterface
        fun openAccessibilitySettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun openNotificationSettings() {
            runOnUiThread {
                try {
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                } catch (_: Exception) {}
            }
        }

        @JavascriptInterface
        fun openFilesPermission() {
            runOnUiThread {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
                        val i = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
                            data = Uri.parse("package:" + packageName)
                        }
                        startActivity(i)
                    } else {
                        Toast.makeText(this@MainActivity, "Permissao de arquivos ja concedida!", Toast.LENGTH_SHORT).show()
                    }
                } catch (_: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                    } catch (_: Exception) {}
                }
            }
        }

        @JavascriptInterface
        fun openBatterySettings() {
            runOnUiThread {
                try {
                    val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:" + packageName)
                    }
                    startActivity(i)
                } catch (_: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (_: Exception) {}
                }
            }
        }
    }
}
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/AegisForegroundService.kt',
    `package com.aegis.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.StatFs
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class AegisForegroundService : Service() {

    companion object {
        @Volatile
        var isRunning: Boolean = false
        @Volatile
        var connectionState: String = "idle"
        @Volatile
        var lastError: String = ""
    }

    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .connectTimeout(12, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private val serviceJob = Job()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    private var telemetryLoopStarted = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true
        lastError = ""
        try {
            val notif = buildNotification("Conectando ao Orquestrador Aegis...")
            val fgType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            } else {
                0
            }
            ServiceCompat.startForeground(this, 101, notif, fgType)
        } catch (e: Exception) {
            lastError = e.message ?: "Erro ao ativar ForegroundService"
        }

        scope.launch {
            connectSocket()
        }
        if (!telemetryLoopStarted) {
            telemetryLoopStarted = true
            startTelemetryLoop()
        }
        return START_STICKY
    }

    private fun buildNotification(text: String): Notification {
        val channelId = "aegis_native_agent"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                channelId,
                "Aegis Android System Agent",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Aegis Android Ativo")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        try {
            val nm = getSystemService(NotificationManager::class.java)
            nm?.notify(101, buildNotification(text))
        } catch (_: Exception) {}
    }

    private fun connectSocket() {
        val wsUrl = AegisConfig.getWsUrl(this)
        if (wsUrl.isBlank()) {
            connectionState = "unconfigured"
            lastError = "Configure a URL do servidor Aegis."
            return
        }
        val req = try {
            Request.Builder().url(wsUrl).build()
        } catch (e: Exception) {
            connectionState = "error"
            lastError = "URL invalida: " + (e.message ?: wsUrl)
            return
        }

        connectionState = "connecting"
        webSocket?.close(1000, "reconnect")
        webSocket = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                connectionState = "online"
                lastError = ""
                updateNotification("Conectado a " + AegisConfig.getServerOrigin(this@AegisForegroundService))
                try {
                    val hello = JSONObject().apply {
                        put("type", "hello")
                        put("name", Build.MANUFACTURER + " " + Build.MODEL)
                        put("platform", "android")
                        put("transport", "android_app_ws")
                        put("serialOrUid", Build.BRAND + "_" + Build.MODEL)
                        val token = AegisConfig.getDeviceToken(this@AegisForegroundService)
                        if (token.isNotBlank()) put("token", token)
                        else put("pairingCode", AegisConfig.getPairingCode(this@AegisForegroundService))
                        put("capabilities", JSONArray(listOf(
                            "android_native_app",
                            "accessibility_gestures",
                            "notification_listener",
                            "file_system",
                            "apps_launcher",
                            "telemetry"
                        )))
                    }
                    ws.send(hello.toString())
                } catch (_: Exception) {}
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    when (msg.optString("type")) {
                        "paired" -> {
                            val token = msg.optString("token")
                            if (token.isNotBlank()) {
                                AegisConfig.setDeviceToken(this@AegisForegroundService, token)
                            }
                            sendSnapshot()
                        }
                        "command" -> handleRemoteCommand(msg)
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                connectionState = "reconnecting"
                lastError = t.message ?: "Falha na conexao WebSocket"
                scope.launch {
                    delay(8000)
                    if (isActive && isRunning) connectSocket()
                }
            }
        })
    }

    private fun startTelemetryLoop() {
        scope.launch {
            while (isActive) {
                delay(20_000)
                if (connectionState == "online") {
                    sendSnapshot()
                }
            }
        }
    }

    private fun collectTelemetry(): JSONObject {
        return try {
            val battIntent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = battIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = battIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
            val status = battIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            val pct = if (level >= 0 && scale > 0) (level * 100) / scale else -1

            JSONObject().apply {
                put("manufacturer", Build.MANUFACTURER)
                put("model", Build.MODEL)
                put("androidVersion", Build.VERSION.RELEASE)
                put("sdkInt", Build.VERSION.SDK_INT)
                if (pct >= 0) put("batteryPercent", pct)
                put("charging", charging)
                put("accessibilityEnabled", AegisAccessibilityService.instance != null)
                put("notificationListenerEnabled", AegisNotificationListener.isActive)
            }
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun collectStorage(): JSONObject {
        return try {
            val stat = StatFs(Environment.getDataDirectory().path)
            val totalMb = (stat.blockCountLong * stat.blockSizeLong) / (1024 * 1024)
            val availMb = (stat.availableBlocksLong * stat.blockSizeLong) / (1024 * 1024)
            JSONObject().apply {
                put("totalMb", totalMb)
                put("availableMb", availMb)
            }
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun collectInstalledApps(): JSONArray {
        val arr = JSONArray()
        try {
            val pm = packageManager
            val pkgs = pm.getInstalledApplications(0).take(120)
            for (app in pkgs) {
                arr.put(JSONObject().apply {
                    put("package", app.packageName)
                    put("label", pm.getApplicationLabel(app).toString())
                })
            }
        } catch (_: Exception) {}
        return arr
    }

    private fun collectTopFiles(): JSONArray {
        val arr = JSONArray()
        try {
            val dir = Environment.getExternalStorageDirectory()
            dir?.listFiles()?.take(60)?.forEach { f ->
                arr.put(JSONObject().apply {
                    put("name", f.name)
                    put("path", f.absolutePath)
                    put("type", if (f.isDirectory) "directory" else "file")
                    put("size", f.length())
                })
            }
        } catch (_: Exception) {}
        return arr
    }

    private fun sendSnapshot() {
        try {
            val payload = JSONObject().apply {
                put("type", "snapshot")
                put("telemetry", collectTelemetry())
                put("storage", collectStorage())
                put("apps", collectInstalledApps())
                put("files", collectTopFiles())
                put("notifications", AegisNotificationListener.getSnapshotJson())
            }
            webSocket?.send(payload.toString())
        } catch (_: Exception) {}
    }

    private fun handleRemoteCommand(msg: JSONObject) {
        val cmdId = msg.optString("commandId")
        val cmdType = msg.optString("commandType")
        val payload = msg.optJSONObject("payload") ?: JSONObject()

        var ok = true
        val output = JSONObject()

        try {
            when (cmdType) {
                "telemetry" -> {
                    output.put("telemetry", collectTelemetry())
                    output.put("storage", collectStorage())
                    sendSnapshot()
                }
                "list_files" -> {
                    val target = payload.optString("path", Environment.getExternalStorageDirectory().absolutePath)
                    val dir = File(target)
                    val entries = JSONArray()
                    dir.listFiles()?.sortedBy { it.name }?.take(150)?.forEach { f ->
                        entries.put(JSONObject().apply {
                            put("name", f.name)
                            put("path", f.absolutePath)
                            put("type", if (f.isDirectory) "directory" else "file")
                            put("size", f.length())
                        })
                    }
                    output.put("path", dir.absolutePath)
                    output.put("entries", entries)
                }
                "read_file" -> {
                    val fp = payload.optString("path", "")
                    val f = File(fp)
                    if (!f.exists() || !f.isFile) {
                        ok = false
                        output.put("error", "Arquivo nao encontrado: " + fp)
                    } else {
                        output.put("path", f.absolutePath)
                        output.put("content", f.readText().take(20_000))
                    }
                }
                "list_apps" -> {
                    output.put("apps", collectInstalledApps())
                }
                "open_app" -> {
                    val pkg = payload.optString("package", "")
                    val launch = packageManager.getLaunchIntentForPackage(pkg)
                    if (launch != null) {
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(launch)
                        output.put("launched", pkg)
                    } else {
                        ok = false
                        output.put("error", "Pacote nao encontrado: " + pkg)
                    }
                }
                "tap" -> {
                    val acc = AegisAccessibilityService.instance
                    if (acc == null) {
                        ok = false
                        output.put("error", "Ative AegisAccessibilityService nas configuracoes do Android.")
                    } else {
                        val x = payload.optDouble("x", 540.0).toFloat()
                        val y = payload.optDouble("y", 1200.0).toFloat()
                        acc.performTap(x, y)
                        output.put("tapped", x.toString() + "," + y.toString())
                    }
                }
                "swipe" -> {
                    val acc = AegisAccessibilityService.instance
                    if (acc == null) {
                        ok = false
                        output.put("error", "Ative AegisAccessibilityService nas configuracoes do Android.")
                    } else {
                        acc.performSwipe(
                            payload.optDouble("x1", 500.0).toFloat(),
                            payload.optDouble("y1", 1500.0).toFloat(),
                            payload.optDouble("x2", 500.0).toFloat(),
                            payload.optDouble("y2", 500.0).toFloat()
                        )
                        output.put("swiped", true)
                    }
                }
                "keyevent" -> {
                    val acc = AegisAccessibilityService.instance
                    val key = payload.optString("key", "HOME")
                    if (acc != null) {
                        acc.performGlobalKey(key)
                        output.put("key", key)
                    } else {
                        ok = false
                        output.put("error", "Ative AegisAccessibilityService nas configuracoes do Android.")
                    }
                }
                "ui_dump" -> {
                    val acc = AegisAccessibilityService.instance
                    if (acc != null) {
                        output.put("nodes", acc.dumpScreenNodes())
                    } else {
                        ok = false
                        output.put("error", "Ative AegisAccessibilityService nas configuracoes do Android.")
                    }
                }
                "notify" -> {
                    val title = payload.optString("title", "Aegis")
                    val text = payload.optString("text", "")
                    val nm = getSystemService(NotificationManager::class.java)
                    nm?.notify(
                        (System.currentTimeMillis() % 10000).toInt(),
                        NotificationCompat.Builder(this, "aegis_native_agent")
                            .setContentTitle(title)
                            .setContentText(text)
                            .setSmallIcon(android.R.drawable.ic_dialog_info)
                            .build()
                    )
                    output.put("notified", true)
                }
                else -> {
                    ok = false
                    output.put("error", "Comando nao suportado no app nativo: " + cmdType)
                }
            }
        } catch (e: Exception) {
            ok = false
            output.put("error", e.message ?: "Erro ao executar comando no Android")
        }

        val reply = JSONObject().apply {
            put("type", "command_result")
            put("commandId", cmdId)
            put("ok", ok)
            put("output", output)
        }
        webSocket?.send(reply.toString())
    }

    override fun onDestroy() {
        isRunning = false
        connectionState = "stopped"
        serviceJob.cancel()
        webSocket?.close(1000, "destroyed")
        super.onDestroy()
    }
}
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/AegisAccessibilityService.kt',
    `package com.aegis.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

class AegisAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: AegisAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Live event hook available for reactive screen monitoring
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun performTap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 60)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performSwipe(x1: Float, y1: Float, x2: Float, y2: Float) {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 280)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performGlobalKey(key: String) {
        when (key.uppercase()) {
            "HOME", "KEYCODE_HOME", "3" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "BACK", "KEYCODE_BACK", "4" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "RECENTS", "KEYCODE_APP_SWITCH" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "NOTIFICATIONS" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "QUICK_SETTINGS" -> performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
            else -> performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    fun dumpScreenNodes(): JSONArray {
        val result = JSONArray()
        val root = rootInActiveWindow ?: return result
        walkNode(root, result, 0)
        return result
    }

    private fun walkNode(node: AccessibilityNodeInfo, out: JSONArray, depth: Int) {
        if (out.length() >= 80 || depth > 12) return
        val txt = node.text?.toString()?.trim().orEmpty()
        val desc = node.contentDescription?.toString()?.trim().orEmpty()
        if (txt.isNotEmpty() || desc.isNotEmpty() || node.isClickable) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            out.put(JSONObject().apply {
                put("text", txt)
                put("desc", desc)
                put("clickable", node.isClickable)
                put("cx", rect.centerX())
                put("cy", rect.centerY())
            })
        }
        for (i in 0 until node.childCount) {
            node.getChild(i)?.let { walkNode(it, out, depth + 1) }
        }
    }
}
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/AegisNotificationListener.kt',
    `package com.aegis.agent

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedDeque

class AegisNotificationListener : NotificationListenerService() {

    companion object {
        @Volatile
        var isActive: Boolean = false
        private val buffer = ConcurrentLinkedDeque<JSONObject>()

        fun getSnapshotJson(): JSONArray {
            val arr = JSONArray()
            for (item in buffer) arr.put(item)
            return arr
        }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isActive = true
    }

    override fun onListenerDisconnected() {
        isActive = false
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val extras = sbn.notification?.extras ?: return
        val item = JSONObject().apply {
            put("package", sbn.packageName)
            put("title", extras.getCharSequence("android.title")?.toString() ?: "")
            put("text", extras.getCharSequence("android.text")?.toString() ?: "")
            put("postedAt", sbn.postTime)
        }
        buffer.addFirst(item)
        while (buffer.size > 40) buffer.pollLast()
    }
}
`
  );

  root.file(
    'app/src/main/java/com/aegis/agent/BootReceiver.kt',
    `package com.aegis.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            try {
                if (AegisConfig.getDeviceToken(context).isNotBlank() &&
                    AegisConfig.getWsUrl(context).isNotBlank()
                ) {
                    ContextCompat.startForegroundService(
                        context,
                        Intent(context, AegisForegroundService::class.java)
                    )
                }
            } catch (_: Exception) {}
        }
    }
}
`
  );

  root.file(
    'app/src/main/res/values/strings.xml',
    `<resources>
    <string name="app_name">Aegis Android</string>
    <string name="accessibility_service_label">Aegis Controle de Sistema</string>
    <string name="notification_listener_label">Aegis Leitor de Notificacoes</string>
</resources>
`
  );

  root.file(
    'app/src/main/res/values/themes.xml',
    `<resources>
    <style name="Theme.AegisNative" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="android:windowBackground">#05070B</item>
        <item name="android:statusBarColor">#05070B</item>
        <item name="android:navigationBarColor">#05070B</item>
    </style>
</resources>
`
  );

  root.file(
    'app/src/main/res/xml/aegis_accessibility_config.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeAllMask"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows"
    android:canPerformGestures="true"
    android:canRetrieveWindowContent="true"
    android:notificationTimeout="100" />
`
  );

  root.file(
    'app/src/main/res/drawable/ic_launcher_background.xml',
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:fillColor="#070B12" android:pathData="M0,0h108v108h-108z" />
</vector>
`
  );

  root.file(
    'app/src/main/res/drawable/ic_launcher_foreground.xml',
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#F59E0B"
        android:pathData="M54,24a30,30 0 1,0 0,60a30,30 0 1,0 0,-60z" />
    <path
        android:fillColor="#FEF3C7"
        android:pathData="M54,39a15,15 0 1,0 0,30a15,15 0 1,0 0,-30z" />
</vector>
`
  );

  root.file(
    'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`
  );

  root.file(
    'build-apk.sh',
    `#!/usr/bin/env bash
set -euo pipefail
echo "Compilando AegisAndroid-Native-${APP_VERSION}.apk..."
if ! command -v gradle >/dev/null 2>&1; then
  echo "Instale o Gradle ou abra esta pasta no Android Studio (Build -> Build APK)."
  exit 1
fi
gradle assembleDebug
echo "APK gerado em: app/build/outputs/apk/debug/app-debug.apk"
`,
    { unixPermissions: '755' }
  );

  root.file(
    'build-apk.bat',
    `@echo off\r\necho Compilando AegisAndroid-Native-${APP_VERSION}.apk...\r\ngradle assembleDebug\r\necho APK gerado em: app\\build\\outputs\\apk\\debug\\app-debug.apk\r\npause\r\n`
  );

  root.file(
    '.github/workflows/build-android-apk.yml',
    `name: Build Aegis Android APK
on:
  workflow_dispatch:
  push:
    branches: [ main ]

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 8.10.2
      - name: Compile Debug APK
        run: gradle assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: AegisAndroid-${APP_VERSION}-APK
          path: app/build/outputs/apk/debug/app-debug.apk
`
  );

  root.file(
    'README-ANDROID.md',
    `# Aegis Android v${APP_VERSION} — Aplicativo Nativo Kotlin (.apk)

Projeto Android nativo completo (\`com.aegis.agent\`) pre-configurado para o seu servidor:
- **Servidor**: \`${safeOrigin}\`
- **Codigo de Pareamento**: \`${safeCode || '(configure no app ao abrir)'}\`

## Recursos Nativos Integrados
- \`MainActivity.kt\`: Interface nativa Material + WebView HUD + botoes diretos para permissoes de sistema.
- \`AegisForegroundService.kt\`: Servico persistente em segundo plano via WebSocket seguro.
- \`AegisAccessibilityService.kt\`: Controle real de toques, gestos, teclas globais e leitura da arvore de UI.
- \`AegisNotificationListener.kt\`: Captura em tempo real das notificacoes do Android.
- \`BootReceiver.kt\`: Reconecta automaticamente ao ligar o aparelho.

## Como gerar o .APK (2 opcoes rapidas)
1. **Sem instalar nada no PC (GitHub Actions)**: Suba esta pasta para um repositorio GitHub privado -> aba *Actions* -> execute **Build Aegis Android APK** -> baixe \`app-debug.apk\` e instale no celular.
2. **Android Studio (Windows/Linux/macOS)**: Abra esta pasta no Android Studio e clique em **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** (ou rode \`./build-apk.sh\`).
`
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, sha256: sha256Hex(buffer) };
}

// ============================================================================
// 4. GITHUB RELEASES AUTO-LINKING (COMPILED .APK / .EXE / .APPIMAGE / .DEB)
// ============================================================================

const GITHUB_REPO_RE = /^[a-zA-Z0-9._-]{1,60}\/[a-zA-Z0-9._-]{1,100}$/;

export function normalizeGithubRepo(raw?: string | null): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  let candidate = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const parts = candidate.split('/').filter(Boolean);
  if (parts.length >= 2) {
    candidate = `${parts[0]}/${parts[1]}`;
  }
  if (!GITHUB_REPO_RE.test(candidate) || candidate.includes('..')) {
    return null;
  }
  return candidate;
}

interface GithubAssetRaw {
  name: string;
  browser_download_url: string;
  size: number;
  content_type?: string;
}

interface GithubReleaseRaw {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GithubAssetRaw[];
}

interface GithubReleaseCacheEntry {
  fetchedAt: number;
  sync: GithubReleaseSyncInfo;
  artifacts: NativeArtifactMeta[];
}

const githubReleaseCache = new Map<string, GithubReleaseCacheEntry>();
const GITHUB_CACHE_TTL_MS = 5 * 60 * 1000;

export function clearGithubReleaseCache(repo?: string): void {
  if (repo) {
    githubReleaseCache.delete(repo);
  } else {
    githubReleaseCache.clear();
  }
}

async function fetchGithubReleaseArtifacts(
  rawRepo?: string | null,
  forceRefresh = false
): Promise<{ sync: GithubReleaseSyncInfo; artifacts: NativeArtifactMeta[] }> {
  const repo = normalizeGithubRepo(rawRepo);
  if (!repo) {
    return {
      sync: {
        repo: null,
        status: 'unconfigured',
        releaseTag: null,
        releaseUrl: null,
        publishedAt: null,
        syncedAssetsCount: 0,
        message:
          'Vincule seu repositório GitHub (usuario/repositorio) para ligar automaticamente os binários finais (.apk, .exe e .AppImage) compilados via GitHub Actions aos botões de download.',
      },
      artifacts: [],
    };
  }

  const cached = githubReleaseCache.get(repo);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < GITHUB_CACHE_TTL_MS) {
    return { sync: cached.sync, artifacts: cached.artifacts };
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': `Aegis-Native-Catalog/${APP_VERSION}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) {
      const result = {
        sync: {
          repo,
          status: 'no_releases' as const,
          releaseTag: null,
          releaseUrl: `https://github.com/${repo}/actions`,
          publishedAt: null,
          syncedAssetsCount: 0,
          message: `Repositório ${repo} vinculado! Execute o workflow "Build & Release All Native Apps" na aba Actions do GitHub (ou crie a tag v${APP_VERSION}) para publicar o .apk e o .exe automaticamente.`,
        },
        artifacts: [],
      };
      githubReleaseCache.set(repo, { fetchedAt: Date.now(), ...result });
      return result;
    }

    if (!res.ok) {
      const result = {
        sync: {
          repo,
          status: 'error' as const,
          releaseTag: null,
          releaseUrl: `https://github.com/${repo}/releases`,
          publishedAt: null,
          syncedAssetsCount: 0,
          message: `Não foi possível consultar Releases de ${repo} (HTTP ${res.status}). Se o repositório for privado, configure GITHUB_TOKEN no servidor.`,
        },
        artifacts: [],
      };
      githubReleaseCache.set(repo, { fetchedAt: Date.now(), ...result });
      return result;
    }

    const release = (await res.json()) as GithubReleaseRaw;
    const tag = release.tag_name || `v${APP_VERSION}`;
    const releaseUrl = release.html_url || `https://github.com/${repo}/releases/latest`;
    const assets = Array.isArray(release.assets) ? release.assets : [];

    const mapped: NativeArtifactMeta[] = [];

    for (const asset of assets) {
      const name = String(asset.name || '');
      const url = String(asset.browser_download_url || '');
      if (!name || !/^https:\/\/github\.com\//i.test(url)) continue;
      const lower = name.toLowerCase();

      if (lower.endsWith('.apk')) {
        mapped.push({
          id: `gh-android-${name}`,
          os: 'android',
          filename: name,
          title: `Aegis Android — Instalador Compilado (${tag})`,
          subtitle: `APK nativo compilado via GitHub Actions (${repo}) pronto para instalar direto no celular Android`,
          format: '.apk (Android Compilado)',
          architecture: 'Android 8.0+ (arm64 / universal)',
          downloadUrl: url,
          sizeBytes: Number.isFinite(asset.size) ? asset.size : null,
          sha256: null,
          compiledOnServer: true,
          source: 'github_release',
          releaseTag: tag,
          installSteps: [
            `Baixe ${name} diretamente no celular Android`,
            'Toque no arquivo baixado e permita "Instalar apps desconhecidos" se solicitado',
            'Abra o Aegis Android, informe seu código de pareamento e ative Acessibilidade + Notificações',
          ],
          capabilities: [
            'Binário .APK final compilado automaticamente (pronto para instalar sem Android Studio)',
            'ForegroundService persistente + AccessibilityService + NotificationListener',
            `Publicação verificada na Release ${tag} de ${repo}`,
          ],
        });
      } else if (lower.endsWith('.exe') || lower.endsWith('.msi')) {
        const isSetup = lower.includes('setup') || lower.endsWith('.msi');
        mapped.push({
          id: `gh-windows-${name}`,
          os: 'windows',
          filename: name,
          title: isSetup
            ? `Aegis Desktop Windows — Instalador Compilado (${tag})`
            : `Aegis Desktop Windows — Executável Nativo (${tag})`,
          subtitle: `Binário Windows PE32+ compilado via GitHub Actions (${repo}) pronto para executar no Windows 10/11`,
          format: lower.endsWith('.msi') ? '.msi (Windows Installer)' : '.exe (Win64 Compilado)',
          architecture: 'x64 (Windows 10/11)',
          downloadUrl: url,
          sizeBytes: Number.isFinite(asset.size) ? asset.size : null,
          sha256: null,
          compiledOnServer: true,
          source: 'github_release',
          releaseTag: tag,
          installSteps: [
            `Baixe e execute ${name} no Windows 10 ou 11`,
            'Se o SmartScreen perguntar, clique em "Mais informações" -> "Executar assim mesmo"',
            'Use o ícone do Aegis na Bandeja do Sistema ou Menu Iniciar',
          ],
          capabilities: [
            'Executável Windows compilado pronto para instalar com 1 clique',
            'Bandeja do sistema + serviço local (127.0.0.1:3847) + ponte ADB Android',
            `Publicação verificada na Release ${tag} de ${repo}`,
          ],
        });
      } else if (lower.endsWith('.appimage') || lower.endsWith('.rpm')) {
        mapped.push({
          id: `gh-linux-${name}`,
          os: 'linux',
          filename: name,
          title: `Aegis Desktop Linux — ${lower.endsWith('.appimage') ? 'AppImage Portátil' : 'Pacote RPM'} (${tag})`,
          subtitle: `Binário Linux compilado via GitHub Actions (${repo})`,
          format: lower.endsWith('.appimage') ? '.AppImage (Portátil)' : '.rpm (Fedora/openSUSE)',
          architecture: 'x86_64',
          downloadUrl: url,
          sizeBytes: Number.isFinite(asset.size) ? asset.size : null,
          sha256: null,
          compiledOnServer: true,
          source: 'github_release',
          releaseTag: tag,
          installSteps: lower.endsWith('.appimage')
            ? [`chmod +x ${name}`, `./${name}`]
            : [`sudo dnf install ./${name}`, 'Abra "Aegis Desktop" no menu do sistema'],
          capabilities: [
            'Pacote desktop compilado com interface nativa Electron + daemon local embutido',
            `Publicação verificada na Release ${tag} de ${repo}`,
          ],
        });
      }
    }

    const result = {
      sync: {
        repo,
        status: 'linked' as const,
        releaseTag: tag,
        releaseUrl,
        publishedAt: release.published_at || null,
        syncedAssetsCount: mapped.length,
        message:
          mapped.length > 0
            ? `Release ${tag} sincronizada (${mapped.length} binário(s) final(is) vinculados diretamente aos botões de download).`
            : `Release ${tag} encontrada em ${repo}, mas sem anexos .apk/.exe/.AppImage ainda. Rode o workflow release-all-apps.yml.`,
      },
      artifacts: mapped,
    };
    githubReleaseCache.set(repo, { fetchedAt: Date.now(), ...result });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erro de rede ao consultar GitHub Releases.';
    return {
      sync: {
        repo,
        status: 'error',
        releaseTag: null,
        releaseUrl: `https://github.com/${repo}/releases`,
        publishedAt: null,
        syncedAssetsCount: 0,
        message: `Falha ao consultar ${repo}: ${msg}`,
      },
      artifacts: [],
    };
  }
}

// ============================================================================
// 5. UNIFIED NATIVE INSTALLERS CATALOG
// ============================================================================

export async function getNativeInstallersCatalog(
  serverOrigin: string,
  options?: { githubRepo?: string | null; forceRefresh?: boolean }
): Promise<{
  version: string;
  builtAt: string;
  githubSync: GithubReleaseSyncInfo;
  artifacts: NativeArtifactMeta[];
}> {
  const safeOrigin = sanitizeOrigin(serverOrigin);
  const linux = buildLinuxNativeArtifacts();
  const win = await buildWindowsNativePackageZip(safeOrigin);
  const android = await buildAndroidNativeProjectZip(safeOrigin);
  const gh = await fetchGithubReleaseArtifacts(options?.githubRepo, options?.forceRefresh);

  const ghLinux = gh.artifacts.filter((a) => a.os === 'linux');
  const ghWindows = gh.artifacts.filter((a) => a.os === 'windows');
  const ghAndroid = gh.artifacts.filter((a) => a.os === 'android');

  const artifacts: NativeArtifactMeta[] = [
    {
      id: 'linux-deb',
      os: 'linux',
      filename: `aegis-desktop_${APP_VERSION}_amd64.deb`,
      title: 'Aegis Desktop para Ubuntu / Debian / Pop!_OS (.deb)',
      subtitle: 'Pacote instalável real com HUD Holográfica 3D embarcada + binário ELF x86_64 compilado em C',
      format: '.deb (x86_64 ELF)',
      architecture: 'amd64 / x86_64',
      downloadUrl: `/api/installers/linux/aegis-desktop_${APP_VERSION}_amd64.deb`,
      sizeBytes: linux.debBuffer.length,
      sha256: linux.debSha256,
      compiledOnServer: true,
      source: 'server_compiled',
      installSteps: [
        `sudo apt install ./aegis-desktop_${APP_VERSION}_amd64.deb`,
        'Abra "Aegis Desktop" no menu de aplicativos do sistema ou execute: aegis-desktop',
        'Opcional (segundo plano): systemctl --user enable --now aegis-desktop',
      ],
      capabilities: [
        'HUD Holográfica 3D completa (núcleo neural 60fps, comandos de voz, terminal e cofre AES-256)',
        'Binário nativo ELF /usr/bin/aegis-desktop + entrada oficial no Menu de Aplicativos',
        'Serviço de usuário systemd (--user) + ponte ADB Android',
      ],
    },
    {
      id: 'linux-appimage',
      os: 'linux',
      filename: `AegisDesktop-${APP_VERSION}-x86_64.AppImage`,
      title: 'Aegis Desktop Linux Portátil (.AppImage — Zero FUSE / Zero Root)',
      subtitle: 'Executável único autocontido (ELF x86_64 + HUD Holográfica 3D) compatível com todas as distros Linux',
      format: '.AppImage (x86_64 Portátil)',
      architecture: 'x86_64',
      downloadUrl: `/api/installers/linux/AegisDesktop-${APP_VERSION}-x86_64.AppImage`,
      sizeBytes: linux.appImageBuffer.length,
      sha256: linux.appImageSha256,
      compiledOnServer: true,
      source: 'server_compiled',
      installSteps: [
        `chmod +x AegisDesktop-${APP_VERSION}-x86_64.AppImage`,
        `./AegisDesktop-${APP_VERSION}-x86_64.AppImage  (ou clique duplo no gerenciador de arquivos)`,
        `Opcional (criar ícone no menu): ./AegisDesktop-${APP_VERSION}-x86_64.AppImage --integrate`,
      ],
      capabilities: [
        'Arquivo único portátil sem depender de libfuse2, apt ou sudo (funciona em Ubuntu 24.04, Fedora, Arch, Mint)',
        'HUD Holográfica 3D embarcada + daemon local automático + suporte a --appimage-extract e --doctor',
        'Integrável ao menu de aplicativos com --integrate',
      ],
    },
    ...ghLinux,
    {
      id: 'linux-tar',
      os: 'linux',
      filename: 'aegis-desktop-linux-x64.tar.gz',
      title: 'Aegis Desktop Linux Universal (.tar.gz + Binario ELF + Electron)',
      subtitle: 'Para Arch, Fedora, openSUSE, Mint e compilação opcional de Electron / RPM',
      format: '.tar.gz (ELF + Electron)',
      architecture: 'x86_64',
      downloadUrl: '/api/installers/linux/aegis-desktop-linux-x64.tar.gz',
      sizeBytes: linux.tarGzBuffer.length,
      sha256: linux.tarGzSha256,
      compiledOnServer: true,
      source: 'server_compiled',
      installSteps: [
        'tar -xzf aegis-desktop-linux-x64.tar.gz',
        `cd aegis-desktop-${APP_VERSION} && ./install-native-linux.sh`,
        'Execute aegis-desktop ou abra pelo menu de aplicativos',
      ],
      capabilities: [
        'Inclui binário ELF x86_64 pré-compilado + HUD Holográfica 3D',
        'Inclui projeto Electron + electron-builder (.AppImage / .rpm / .deb)',
        'Funciona sem root (~/.local) ou globalmente (sudo)',
      ],
    },
    {
      id: 'linux-elf',
      os: 'linux',
      filename: 'aegis-desktop',
      title: 'Binario Nativo Linux avulso (ELF x86_64)',
      subtitle: 'Executavel C compilado com gcc -O2 -s para inspecao ou uso direto',
      format: 'ELF 64-bit',
      architecture: 'x86_64',
      downloadUrl: '/api/installers/linux/aegis-desktop',
      sizeBytes: linux.elfBuffer.length,
      sha256: linux.elfSha256,
      compiledOnServer: true,
      source: 'server_compiled',
      installSteps: [
        'chmod +x aegis-desktop',
        './aegis-desktop --doctor',
      ],
      capabilities: [
        'Zero dependencias externas alem de libc',
        'Suporta --ui, --status, --start, --stop, --doctor e CLI',
      ],
    },
    ...ghWindows,
    {
      id: 'windows-native',
      os: 'windows',
      filename: `AegisDesktop-Windows-Native-${APP_VERSION}.zip`,
      title: 'Aegis Desktop Nativo para Windows 10 / 11 (Kit Compilação Local -> AegisDesktop.exe)',
      subtitle: 'Aplicativo C# WinForms com bandeja do sistema + HUD Holográfica 3D + compilação zero-SDK (csc.exe)',
      format: 'AegisDesktop.exe (C# WinForms + NSIS)',
      architecture: 'x64 (Windows 10/11)',
      downloadUrl: `/api/installers/windows/AegisDesktop-Windows-Native-${APP_VERSION}.zip`,
      sizeBytes: win.buffer.length,
      sha256: win.sha256,
      compiledOnServer: false,
      source: 'build_kit',
      installSteps: [
        `Extraia AegisDesktop-Windows-Native-${APP_VERSION}.zip`,
        'De clique duplo em Instalar-Aegis-Windows.cmd (compila AegisDesktop.exe nativamente com o .NET do Windows)',
        'Ou rode o GitHub Actions (.github/workflows/release-all-apps.yml) e vincule o repositorio acima para baixar o .exe pronto',
      ],
      capabilities: [
        'Gera AegisDesktop.exe real (PE32+ WinForms) + HUD Holográfica 3D local',
        'Registra em Aplicativos Instalados do Windows, Menu Iniciar e Logon',
        'Inclui Electron + electron-builder (NSIS .exe / .msi) e Inno Setup (.iss)',
      ],
    },
    ...ghAndroid,
    {
      id: 'android-native',
      os: 'android',
      filename: `AegisAndroid-Native-${APP_VERSION}.zip`,
      title: 'Aegis Android Nativo (Projeto Kotlin/Gradle -> .APK · Android 8–15 Corrigido)',
      subtitle: 'App Android real (com.aegis.agent) com HUD Holográfica 3D embarcada, ForegroundService dataSync e ponte nativa',
      format: 'Android Studio / Gradle Kotlin (.apk)',
      architecture: 'Android 8.0–15 (API 26–35)',
      downloadUrl: `/api/installers/android/AegisAndroid-Native-${APP_VERSION}.zip`,
      sizeBytes: android.buffer.length,
      sha256: android.sha256,
      compiledOnServer: false,
      source: 'build_kit',
      installSteps: [
        'Para baixar o .APK ja compilado direto aqui: suba o repositorio para o GitHub, execute o workflow release-all-apps.yml e vincule usuario/repositorio no topo',
        `Ou extraia AegisAndroid-Native-${APP_VERSION}.zip (com codigo de pareamento opcional ja embutido)`,
        'Compile no Android Studio (Build -> Build APK) ou rodando ./build-apk.sh',
      ],
      capabilities: [
        'Abre direto na HUD Holográfica 3D embarcada (zero crash offline / Android 14–15 dataSync corrigido)',
        'Ponte nativa @JavascriptInterface para AccessibilityService, Notificações, Arquivos (/sdcard) e Bateria',
        'Fallback automático para HUD local caso o servidor remoto esteja inacessível + permissão de microfone',
      ],
    },
  ];

  return {
    version: APP_VERSION,
    builtAt: linux.builtAt,
    githubSync: gh.sync,
    artifacts,
  };
}

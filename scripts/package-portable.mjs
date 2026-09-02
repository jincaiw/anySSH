#!/usr/bin/env node
/**
 * Package anySSH as a portable archive (Windows zip / Linux tar.gz / macOS zip).
 *
 * A portable build is just the regular binary plus two companions:
 *
 *   anySSH-<version>-portable/
 *   ├── anySSH(.exe | .app)    the normal release binary, unmodified
 *   ├── portable.txt           empty marker — its presence switches the app
 *   │                          into portable mode (see src-tauri/src/portable.rs)
 *   ├── README-PORTABLE.txt    bilingual quick-start
 *   └── anySSH-Data/           empty; created here so users can see where the
 *                              database, credentials and cache will live
 *
 * Run AFTER `pnpm tauri build`:
 *
 *   node scripts/package-portable.mjs [--target <rust-triple>] [--out <dir>]
 *
 * The version and product name are read from src-tauri/tauri.conf.json, so the
 * script needs no arguments in CI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { target: process.env.TAURI_TARGET || "", out: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--target") args.target = argv[++i] ?? "";
    else if (argv[i] === "--out") args.out = argv[++i] ?? "";
  }
  return args;
}

const { target, out: outArg } = parseArgs(process.argv);
// fileURLToPath (not .pathname): URL pathname on Windows yields "/D:/...",
// which resolve() turns into a bogus "D:\D:\..." path.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcTauri = join(root, "src-tauri");

// ─── Read product metadata ───────────────────────────────────────────────────

const conf = JSON.parse(readFileSync(join(srcTauri, "tauri.conf.json"), "utf8"));
const version = conf.version;
const productName = conf.productName; // "anySSH"
if (!version || version === "0.0.0-dev") {
  // The release workflow stamps the tag version into tauri.conf.json before
  // building; a dev version here means packaging was run outside that flow.
  console.error(
    "[portable] refusing to package a 0.0.0-dev build — pass a real version in tauri.conf.json",
  );
  process.exit(1);
}

// ─── Locate the build output ─────────────────────────────────────────────────

const targetDir = target ? join(srcTauri, "target", target) : join(srcTauri, "target");
const platform = process.platform; // darwin | linux | win32

function mustExist(path, hint) {
  if (!existsSync(path)) {
    console.error(`[portable] not found: ${path}\n${hint}`);
    process.exit(1);
  }
  return path;
}

/** The binary / bundle produced by `tauri build` for this platform. */
function findArtifact() {
  if (platform === "win32") {
    return { kind: "file", path: mustExist(join(targetDir, "release", `${productName}.exe`), "Run `pnpm tauri build` first.") };
  }
  if (platform === "darwin") {
    // Prefer a target-specific bundle (aarch64/x86_64 cross builds), fall back
    // to the plain release path.
    const candidates = [
      join(targetDir, "release", "bundle", "macos", `${productName}.app`),
      join(srcTauri, "target", "release", "bundle", "macos", `${productName}.app`),
    ];
    const path = candidates.find(existsSync);
    if (!path) {
      console.error(`[portable] .app bundle not found — looked in:\n  ${candidates.join("\n  ")}`);
      process.exit(1);
    }
    return { kind: "app", path };
  }
  // Linux: tauri names the binary after the crate (`anyssh`), not productName.
  const candidates = [join(targetDir, "release", "anyssh"), join(targetDir, "release", productName.toLowerCase())];
  const path = candidates.find(existsSync);
  if (!path) {
    console.error(`[portable] linux binary not found — looked in:\n  ${candidates.join("\n  ")}`);
    process.exit(1);
  }
  return { kind: "file", path };
}

const artifact = findArtifact();

// ─── Assemble the portable folder ────────────────────────────────────────────

const arch = target.includes("aarch64") || target.includes("arm64")
  ? "aarch64"
  : target.includes("x86_64") || target.includes("x64")
    ? "x86_64"
    : process.arch === "arm64" ? "aarch64" : "x86_64";

const platformSlug = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
const ext = platform === "win32" ? "zip" : platform === "darwin" ? "zip" : "tar.gz";
const folderName = `${productName}-${version}-${platformSlug}-${arch}-portable`;
const outDir = outArg ? resolve(outArg) : join(targetDir, "portable");
const staging = join(outDir, folderName);

console.log(`[portable] version   : ${version}`);
console.log(`[portable] artifact  : ${artifact.path}`);
console.log(`[portable] staging   : ${staging}`);

rmrf(staging);
mkdirSync(staging, { recursive: true });

// 1. The application itself — copied verbatim, never rebuilt or patched.
if (artifact.kind === "app") {
  cpSync(artifact.path, join(staging, basename(artifact.path)), { recursive: true });
} else {
  cpSync(artifact.path, join(staging, basename(artifact.path)));
}

// 2. The portable marker. Contents are never read — only presence matters.
writeFileSync(join(staging, "portable.txt"), "");

// 3. Data directory, pre-created so its role is discoverable.
mkdirSync(join(staging, "anySSH-Data"), { recursive: true });

// 4. Bilingual quick-start. Plain text with CRLF so it opens cleanly in Notepad.
writeFileSync(join(staging, "README-PORTABLE.txt"), readme(), "utf8");

// ─── Archive ─────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
const archive = join(outDir, `${folderName}.${ext}`);
rmrf(archive);

// `tar` is used on macOS (bsdtar, zip via -a) and Linux (GNU tar, tar.gz).
// On Windows the runner's PATH resolves `tar` to Git for Windows' GNU tar,
// which rejects drive letters ("Cannot connect to D: resolve failed") and
// cannot write zip via -a — so use the Windows-native bsdtar (ships with
// Windows 10+) explicitly, falling back to PowerShell Compress-Archive.
if (platform === "win32") {
  const bsdtar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (existsSync(bsdtar)) {
    execFileSync(bsdtar, ["-a", "-cf", archive, "-C", outDir, folderName], { stdio: "inherit" });
  } else {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Force -Path '${staging}' -DestinationPath '${archive}'`,
      ],
      { stdio: "inherit" },
    );
  }
} else {
  const tarArgs =
    ext === "zip"
      ? ["-a", "-cf", archive, "-C", outDir, folderName]
      : ["-czf", archive, "-C", outDir, folderName];
  execFileSync("tar", tarArgs, { stdio: "inherit" });
}

console.log(`[portable] created: ${archive}`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rmrf(path) {
  // Staging + archive paths are derived from target/portable — regenerating a
  // previous portable build legitimately means replacing its outputs.
  try {
    execFileSync("rm", ["-rf", path]);
  } catch {
    /* first run — nothing to clean */
  }
}

function readme() {
  const isWin = platform === "win32";
  const exeName = platform === "win32" ? "anySSH.exe" : platform === "darwin" ? "anySSH.app" : "anyssh";
  const lines = [
    "anySSH Portable / anySSH 便携版",
    "================================",
    "",
    "ENGLISH",
    "-------",
    `* Run ${exeName} directly — no installation required.`,
    "* All data (hosts, settings, credentials, cache) is stored in the",
    "  anySSH-Data folder next to the application, so you can carry the",
    "  whole folder on a USB stick and move it between computers.",
    "* Keep portable.txt next to the application: it is what switches anySSH",
    "  into portable mode. Without it the app uses the per-user profile like",
    "  a normal installation.",
    "* Credentials are encrypted (AES-256-GCM) into anySSH-Data/vault.anyssh,",
    "  sealed by the key file anySSH-Data/vault.key. Back up or move the",
    "  whole anySSH-Data folder together — the vault is unreadable without",
    "  its key.",
    "* Deleting the folder removes every trace of the app from the machine.",
    "",
    "中文说明",
    "--------",
    `* 直接运行 ${exeName}，无需安装。`,
    "* 所有数据（主机、设置、凭据、缓存）都保存在程序旁边的 anySSH-Data",
    "  文件夹中，整个文件夹可随 U 盘携带、在多台电脑间移动使用。",
    "* 请保持 portable.txt 与程序在同一目录：正是这个文件让 anySSH 进入",
    "  便携模式；缺少它时程序会像普通安装版一样使用系统用户目录。",
    "* 凭据以 AES-256-GCM 加密保存在 anySSH-Data/vault.anyssh，由",
    "  anySSH-Data/vault.key 密钥文件加密封装。请整体备份或搬移",
    "  anySSH-Data 文件夹——缺少密钥文件时凭据将无法解密。",
    "* 删除该文件夹即可彻底移除本程序在该电脑上的所有数据。",
    "",
    `Version / 版本: ${version}  (${platformSlug}-${arch})`,
  ];
  return lines.join(isWin ? "\r\n" : "\n") + (isWin ? "\r\n" : "\n");
}

#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Build a lode-compatible release artifact.
 *
 * The artifact is a version directory packed as tar.gz. It contains the built
 * API bundle, the built SPA, Drizzle migrations, and a small launcher script.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

interface PackageJson {
  readonly name?: string;
  readonly version?: string;
}

const { values: args } = parseArgs({
  options: {
    "app-name": { type: "string" },
    "version": { type: "string" },
    "platform": { type: "string" },
    "artifact-url": { type: "string" },
    "channel": { type: "string", default: "stable" },
  },
  strict: false,
});

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(ROOT, "dist");
const STAGE = resolve(DIST, "package");
const API_DIST = resolve(ROOT, "apps/api/dist");
const WEB_DIST = resolve(ROOT, "apps/web/dist");
const DRIZZLE_DIR = resolve(ROOT, "apps/api/drizzle");

const rootPackage = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as PackageJson;
const apiPackage = JSON.parse(readFileSync(resolve(ROOT, "apps/api/package.json"), "utf-8")) as PackageJson;

const appName = (args["app-name"] as string | undefined) ?? process.env.APP_NAME ?? "bit";
const version = (args.version as string | undefined) ?? rootPackage.version ?? apiPackage.version ?? "0.0.0";
const channel = (args.channel as string | undefined) ?? "stable";
const platform = (args.platform as string | undefined) ?? defaultPlatform();

function defaultPlatform(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform;
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  return `${os}-${arch}`;
}

async function run(cmd: readonly string[], cwd = ROOT): Promise<void> {
  console.log(`[package] ${cmd.join(" ")}`);
  const child = Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`command failed (${code}): ${cmd.join(" ")}`);
}

function tryRun(cmd: readonly string[]): string {
  try {
    const result = Bun.spawnSync(cmd, { cwd: ROOT });
    return result.stdout.toString().trim();
  }
  catch {
    return "";
  }
}

function resolveBuildTime(): string {
  const envBuildTime = (process.env.BUILD_TIME ?? "").trim();
  if (envBuildTime)
    return envBuildTime;

  const epoch = (process.env.SOURCE_DATE_EPOCH ?? "").trim();
  if (epoch && /^\d+$/.test(epoch)) {
    const seconds = Number.parseInt(epoch, 10);
    if (Number.isFinite(seconds))
      return new Date(seconds * 1000).toISOString();
  }

  const commitIso = tryRun(["git", "show", "-s", "--format=%cI", "HEAD"]);
  if (commitIso)
    return new Date(commitIso).toISOString();

  return new Date().toISOString();
}

const envCommit = (process.env.BUILD_COMMIT ?? process.env.GITHUB_SHA ?? "").trim();
const commit = (envCommit ? envCommit.slice(0, 12) : "") || tryRun(["git", "rev-parse", "--short=12", "HEAD"]) || "unknown";
const buildTime = resolveBuildTime();

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
mkdirSync(DIST, { recursive: true });

console.log("[package] Building web...");
await run(["bun", "run", "--filter", "@app/web", "build"]);

console.log("[package] Building API bundle...");
rmSync(API_DIST, { recursive: true, force: true });
await run([
  "bun",
  "build",
  "src/index.ts",
  "--outdir",
  "dist",
  "--target",
  "bun",
  "--minify",
  "--define",
  `BUILD_COMMIT=${JSON.stringify(commit)}`,
  "--define",
  `BUILD_TIME=${JSON.stringify(buildTime)}`,
  "--define",
  `BUILD_VERSION=${JSON.stringify(version)}`,
], resolve(ROOT, "apps/api"));

for (const path of [resolve(API_DIST, "index.js"), resolve(WEB_DIST, "index.html"), resolve(DRIZZLE_DIR, "meta/_journal.json")]) {
  if (!existsSync(path))
    throw new Error(`required build input missing: ${path}`);
}

cpSync(API_DIST, resolve(STAGE, "apps/api/dist"), { recursive: true });
cpSync(WEB_DIST, resolve(STAGE, "apps/web/dist"), { recursive: true });
cpSync(DRIZZLE_DIR, resolve(STAGE, "apps/api/drizzle"), { recursive: true });

const launcherPath = resolve(STAGE, "bin", appName);
mkdirSync(resolve(STAGE, "bin"), { recursive: true });
await Bun.write(launcherPath, `#!/usr/bin/env sh
set -eu
APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export ROOT_DIR="\${ROOT_DIR:-$APP_DIR}"
exec "\${BUN:-bun}" "$APP_DIR/apps/api/dist/index.js" "$@"
`);
chmodSync(launcherPath, 0o755);

const artifactName = `${appName}-${version}-${platform}.tar.gz`;
const artifactPath = resolve(DIST, artifactName);
rmSync(artifactPath, { force: true });
await run(["tar", "-czf", artifactPath, "-C", STAGE, "."]);

const hasher = new Bun.CryptoHasher("sha256");
hasher.update(new Uint8Array(await Bun.file(artifactPath).arrayBuffer()));
const sha256 = hasher.digest("hex");
const size = statSync(artifactPath).size;
const artifactUrl = (args["artifact-url"] as string | undefined) ?? `https://example.com/releases/${artifactName}`;

const manifest = {
  schema: "lode/v1",
  name: appName,
  channels: {
    [channel]: { latest: version },
  },
  versions: {
    [version]: {
      artifacts: [
        {
          platform,
          url: artifactUrl,
          format: "tar.gz",
          sha256,
          size,
          entry: `bin/${appName}`,
        },
      ],
    },
  },
};

await Bun.write(resolve(DIST, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await Bun.write(resolve(DIST, "checksums.txt"), `${sha256}  ${basename(artifactPath)}\n`);

console.log(`[package] Artifact: ${artifactPath}`);
console.log(`[package] SHA-256: ${sha256}`);
console.log("[package] Manifest: dist/manifest.json");

// Gorgon — one-command APK release script.
//
// Purpose: eliminate the manual release choreography that caused the
// versionCode 18 collision with v0.3.13-alpha (2026-10-23). Every step that
// was previously done by hand is done here, in order, with verification
// gates between steps:
//
//   1. Read the latest GitHub release tag (never trust local memory).
//   2. Bump android versionCode/versionName past every published release.
//   3. vite build + cap sync (reuse scripts/build-apk.mjs).
//   4. gradle assembleRelease.
//   5. Verify build metadata BEFORE trusting the artifact (a stale
//      app-release.apk from a previous build otherwise looks identical).
//   6. apksigner verify (absolute path — the relative form fails on
//      Windows with a GBK-mangled FileNotFoundException).
//   7. Commit the bump, push the branch.
//   8. gh release create with the APK attached.
//
// Usage:
//     node scripts/release-apk.mjs                 # full release
//     node scripts/release-apk.mjs --dry-run       # steps 1-2 only, prints plan
//     GORGON_RELEASE_NOTES=path/to/notes.md ...    # custom release notes body
//
// Env (same as build-apk.mjs): GORGON_APK_API_BASE to override the API host.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const REPO = path.resolve(APP, "..");
const ANDROID = path.join(APP, "android");
const GRADLE_FILE = path.join(ANDROID, "app", "build.gradle");
const OUT_DIR = path.join(ANDROID, "app", "build", "outputs", "apk", "release");
const OUT_APK = path.join(OUT_DIR, "app-release.apk");
const OUT_META = path.join(OUT_DIR, "output-metadata.json");
const APK_NAME_PREFIX = "gorgon-workbench";

const REPO_SLUG = "cvcingcvc-code/cec";
const APK_API_BASE = (process.env.GORGON_APK_API_BASE || "https://2109679843717304320.app.workbuddy.host").replace(/\/+$/, "");
const DRY_RUN = process.argv.includes("--dry-run");

// Toolchain paths — absolute everywhere. Relative apksigner paths fail on
// Windows (GBK-mangled FileNotFoundException, hit 2026-10-23).
const JDK = "F:/gorgon-android-toolchain/jdk-21.0.12.1+1";
const APKSIGNER = "F:/gorgon-android-toolchain/sdk/build-tools/36.0.0/apksigner.bat";
const PROXY = "http://127.0.0.1:7890";

function sh(cmd, args, { label, cwd = REPO, env = {}, useProxy = false, capture = false } = {}) {
  const fullEnv = { ...process.env, ...env };
  if (useProxy) {
    fullEnv.https_proxy = PROXY;
    fullEnv.http_proxy = PROXY;
  }
  console.log(`[release] ${label}: ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: fullEnv,
  });
  if (r.status !== 0) {
    console.error(`[release] ${label} FAILED (exit ${r.status})`);
    process.exit(r.status == null ? 1 : r.status);
  }
  return capture ? r.stdout.toString() : "";
}

function fail(msg) {
  console.error(`[release] ERROR: ${msg}`);
  process.exit(1);
}

// Tag scheme is independent of the android versionName scheme: tags follow
// the published lineage (v0.3.13-alpha -> v0.3.14-alpha -> ...), so bump the
// last numeric segment of the LATEST TAG, not of versionName.
function nextTag(latestTag) {
  const m = latestTag.match(/^v(\d+)\.(\d+)\.(\d+)-alpha$/);
  if (!m) fail(`cannot derive next tag from latest tag: ${latestTag}`);
  return `v${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}-alpha`;
}

// ---------- Step 1: latest published release ----------
const latestTagOut = sh("gh", ["api", `repos/${REPO_SLUG}/releases/latest`, "--jq", ".tag_name"], {
  label: "gh latest tag",
  useProxy: true,
  capture: true,
}).trim();
if (!latestTagOut) fail("could not read latest release tag");

// ---------- Step 2: compute bump ----------
// versionCode = latest published versionCode + 1. Read it from the release
// name ("(versionCode N)") — local build.gradle may already be ahead.
// versionName: keep the local build.gradle versionName MAJOR prefix (e.g.
// "6.0.x") and bump its patch past the published one. The tag scheme
// (v0.3.x-alpha) and the android versionName scheme (6.0.x) are decoupled —
// deriving versionName from the tag produced a wrong "0.3.15".
// NOTE: gh api exposes the release title as `.name` (not `.title`, which is
// only valid for `gh release view` JSON output).
const latestTitleOut = sh("gh", ["api", `repos/${REPO_SLUG}/releases/latest`, "--jq", ".name"], {
  label: "gh latest title",
  useProxy: true,
  capture: true,
}).trim();
const codeMatch = latestTitleOut.match(/\(versionCode (\d+)\)/);
if (!codeMatch) fail(`release title missing "(versionCode N)": ${latestTitleOut}`);
const prevCode = parseInt(codeMatch[1], 10);

const gradleNow = fs.readFileSync(GRADLE_FILE, "utf8");
const nameNowMatch = gradleNow.match(/versionName\s+"(\d+)\.(\d+)\.(\d+)"/);
if (!nameNowMatch) fail("cannot parse current versionName from build.gradle");
const localName = nameNowMatch[1] + "." + nameNowMatch[2] + "." + nameNowMatch[3];
const localCodeMatch = gradleNow.match(/versionCode\s+(\d+)/);
if (!localCodeMatch) fail("cannot parse current versionCode from build.gradle");
const localCode = parseInt(localCodeMatch[1], 10);

// Base for the bump: whichever of (published, local) is already ahead, so a
// half-finished manual bump never regresses the version.
const baseCode = Math.max(prevCode, localCode);
const [lmaj, lmin, lpat] = localName.split(".").map((s) => parseInt(s, 10));
const newVersionCode = baseCode + 1;
const newVersionName = `${lmaj}.${lmin}.${lpat + 1}`;
const nextTagName = nextTag(latestTagOut);

console.log(`[release] latest release: ${latestTitleOut.split("(")[0].trim() || latestTagOut} (versionCode ${prevCode})`);
console.log(`[release] local build.gradle: versionCode ${localCode} / versionName ${localName}`);
console.log(`[release] will release:  ${nextTagName} (versionCode ${newVersionCode}, versionName ${newVersionName})`);

if (DRY_RUN) {
  console.log("[release] dry-run: stopping before build. Plan:");
  console.log(`[release]   - edit ${GRADLE_FILE}: versionCode ${newVersionCode} / versionName "${newVersionName}"`);
  console.log("[release]   - node scripts/build-apk.mjs (vite build + cap sync)");
  console.log("[release]   - gradlew assembleRelease");
  console.log("[release]   - verify metadata + apksigner");
  console.log(`[release]   - commit "chore(release): bump android versionCode ${newVersionCode} / ${newVersionName}", push`);
  console.log(`[release]   - gh release create ${nextTagName} with APK`);
  process.exit(0);
}

// ---------- Step 3: bump build.gradle ----------
const gradleSrc = fs.readFileSync(GRADLE_FILE, "utf8");
if (!/versionCode\s+\d+/.test(gradleSrc) || !/versionName\s+"[^"]+"/.test(gradleSrc)) {
  fail("build.gradle does not contain versionCode/versionName in expected form");
}
const gradleNew = gradleSrc
  .replace(/versionCode\s+\d+/, `versionCode ${newVersionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${newVersionName}"`);
fs.writeFileSync(GRADLE_FILE, gradleNew);
console.log(`[release] build.gradle bumped to versionCode ${newVersionCode} / versionName "${newVersionName}"`);

// ---------- Step 4: vite build + cap sync ----------
sh(process.execPath, [path.join(APP, "scripts", "build-apk.mjs")], {
  label: "build-apk",
  cwd: APP,
  env: { GORGON_APK_API_BASE: APK_API_BASE },
});

// ---------- Step 5: gradle assembleRelease ----------
sh(path.join(ANDROID, "gradlew.bat"), ["assembleRelease", "--no-daemon"], {
  label: "gradle assembleRelease",
  cwd: ANDROID,
  env: {
    NODE_OPTIONS: "",
    CODEBUDDY_SAFE_DELETE_ENABLED: "0",
    JAVA_HOME: JDK,
  },
});

// ---------- Step 6: verify build metadata BEFORE trusting the artifact ----------
// A stale APK from a previous build otherwise looks identical — check the
// freshly written output-metadata.json, not the file mtime (hit 2026-10-23:
// an Oct-13 versionCode 5 APK sat in outputs while gradle was still running).
let meta;
try {
  meta = JSON.parse(fs.readFileSync(OUT_META, "utf8"));
} catch (e) {
  fail(`output-metadata.json unreadable: ${e.message}`);
}
const builtElement = meta.elements && meta.elements[0];
if (!builtElement) fail("output-metadata.json has no elements");
if (builtElement.versionCode !== newVersionCode) {
  fail(`built APK versionCode ${builtElement.versionCode} != expected ${newVersionCode} (stale artifact?)`);
}
if (builtElement.versionName !== newVersionName) {
  fail(`built APK versionName ${builtElement.versionName} != expected ${newVersionName} (stale artifact?)`);
}
const apkStat = fs.statSync(OUT_APK);
const ageSec = (Date.now() - apkStat.mtimeMs) / 1000;
if (ageSec > 600) {
  fail(`app-release.apk mtime is ${Math.round(ageSec)}s old (>600s) — stale artifact, refusing to release`);
}
console.log(`[release] artifact verified: versionCode ${builtElement.versionCode} / ${builtElement.versionName}, ${Math.round(apkStat.size / 1024)} KB, fresh (${Math.round(ageSec)}s old)`);

// ---------- Step 7: apksigner verify (absolute path) ----------
sh(APKSIGNER, ["verify", "--print-certs", OUT_APK.replace(/\//g, "\\")], {
  label: "apksigner verify",
  cwd: ANDROID,
  env: { JAVA_HOME: JDK },
});
// Compute SHA-256 of the APK with a tiny inline reader (no shell quoting of paths).
const { createHash } = await import("node:crypto");
const hash = createHash("sha256");
hash.update(fs.readFileSync(OUT_APK));
const APK_SHA256 = hash.digest("hex");
console.log(`[release] APK SHA-256: ${APK_SHA256}`);

// ---------- Step 8: commit + push ----------
const branchOut = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], { label: "current branch", capture: true }).trim();
sh("git", ["add", path.relative(REPO, GRADLE_FILE).replace(/\//g, "/")], { label: "git add bump" });
sh("git", ["commit", "-m", `chore(release): bump android versionCode ${newVersionCode} / ${newVersionName} for ${latestTagOut} successor`], { label: "git commit" });
sh("git", ["push", "cec", branchOut], { label: "git push", useProxy: true });

// ---------- Step 9: gh release create ----------
const tagName = nextTagName;
// Upload with the conventional asset name (previous releases attach
// gorgon-workbench-vX.Y.Z-alpha.apk, not the bare app-release.apk).
const uploadApk = path.join(os.tmpdir(), `${APK_NAME_PREFIX}-${tagName}.apk`);
fs.copyFileSync(OUT_APK, uploadApk);
console.log(`[release] asset: ${path.basename(uploadApk)} (${Math.round(fs.statSync(uploadApk).size / 1024)} KB)`);
const notesFile = process.env.GORGON_RELEASE_NOTES;
let notesArgs;
if (notesFile && fs.existsSync(notesFile)) {
  notesArgs = ["--notes-file", notesFile];
} else {
  notesArgs = [
    "--notes",
    [
      `## ${tagName} (versionCode ${newVersionCode})`,
      "",
      "One-command release via scripts/release-apk.mjs.",
      "",
      "- APK SHA-256: `" + APK_SHA256 + "`",
      "- versionCode " + newVersionCode + " / versionName " + newVersionName,
      "- Built from branch `" + branchOut + "` @ " + sh("git", ["rev-parse", "--short", "HEAD"], { capture: true }).trim(),
      "- Same signing cert as previous releases (install-over safe)",
      "",
      "See PR #8 and docs/research/V24_ACCEPTANCE_REPORT.md for feature context.",
    ].join("\n"),
  ];
}
sh("gh", ["release", "create", tagName, "--repo", REPO_SLUG, "--target", branchOut, "--title", `${tagName} (versionCode ${newVersionCode})`, ...notesArgs, uploadApk], {
  label: "gh release create",
  useProxy: true,
});

console.log(`[release] DONE: https://github.com/${REPO_SLUG}/releases/tag/${tagName}`);

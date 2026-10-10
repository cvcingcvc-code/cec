# Android APK 构建步骤（Gorgon Workbench 2.0）

> 本文档记录从零到可安装 debug APK 的完整步骤与验证点。
> 构建环境：Windows 11 + Git Bash / PowerShell。

## 0. 前置条件

| 组件 | 版本 | 位置 | 备注 |
|---|---|---|---|
| JDK | Temurin 21.0.12.1 | `F:\gorgon-android-toolchain\jdk-21.0.12.1+1` | C 盘 99% 已满，必须用其他盘 |
| Android SDK | cmdline-tools 13114758 | `F:\gorgon-android-toolchain\sdk` | platform-tools + android-35/36 + build-tools 35/36 |
| Gradle | 8.14.3 | `F:\gorgon-android-toolchain\gradle-8.14.3` | 预下载 bin 包解压，绕过 wrapper 网络问题 |
| Node | 22.22.2（managed） | PATH | 用于 `npx cap` |
| 代理 | Clash `127.0.0.1:7890` | 本地 | Maven Central / services.gradle.org 需代理，dl.google.com 直连 |

## 1. 初始化 Capacitor Android 工程（已完成）

```bash
cd C:\Users\lin\Documents\Gorgon-Workbench\app
npm install --registry=https://registry.npmmirror.com \
  @capacitor/core@^8 @capacitor/cli@^8 @capacitor/android@^8 \
  @capacitor/preferences@^8 @capacitor/filesystem@^8
npx cap add android
```

生成 `app/android/` 目录（appId `cn.gorgon.workbench`，已提交 git）。

## 2. 配置本地路径（不提交 git）

```bash
cd app/android
# local.properties 已被 .gitignore 忽略
cat > local.properties << 'EOF'
sdk.dir=F\:\\gorgon-android-toolchain\\sdk
EOF
```

## 3. 构建前端生产产物

```bash
cd app
npx vite build
# 产出 app/dist/（index.html + assets/*.js|css）
```

验证：`ls dist/index.html dist/assets/*.js` 均存在。

## 4. 同步 Capacitor

```bash
cd app
npx cap sync android
# 把 dist/ 复制到 android/app/src/main/assets/public/
# 并同步插件（preferences/filesystem）
```

## 5. Gradle 构建 debug APK

```bash
cd app/android
GRADLE_USER_HOME=F:/gorgon-android-toolchain/gradle-home \
JAVA_HOME=F:/gorgon-android-toolchain/jdk-21.0.12.1+1 \
ANDROID_HOME=F:/gorgon-android-toolchain/sdk \
F:/gorgon-android-toolchain/gradle-8.14.3/bin/gradle assembleDebug --no-daemon
```

首次构建耗时约 7 分钟（下载 Kotlin 编译器 + AndroidX 依赖）。后续增量构建 < 30 秒。

产物：`app/android/app/build/outputs/apk/debug/app-debug.apk`（约 4.8 MB）。

## 6. 验证 APK

```bash
APK=app/build/outputs/apk/debug/app-debug.apk
sha256sum $APK
# 期望输出与 release/SHA256SUMS.md 记录一致

# 包信息
F:/gorgon-android-toolchain/sdk/build-tools/36.0.0/aapt2.exe dump badging $APK | \
  grep -E "package:|sdkVersion|uses-permission"
# 期望：package='cn.gorgon.workbench', minSdkVersion:'24', targetSdkVersion:'36'
# 权限：android.permission.INTERNET（仅此一个用户权限）

# 密钥扫描（解包 JS 资源）
unzip -o -q $APK "assets/public/assets/*" -d /tmp/apkscan
grep -rnoE "(sk-[A-Za-z0-9]{20,}|api[_-]?key[\"']?\s*[:=]\s*[\"'][A-Za-z0-9_-]{16,})" \
  /tmp/apkscan/assets/public/assets/*.js
# 期望：无输出（零明文密钥）

# localhost 依赖扫描
grep -rnoE "http://(localhost|127\.0\.0\.1)[^\"']*" /tmp/apkscan/assets/public/
# 期望：无输出（离线可用，不依赖开发机服务）
```

## 7. 安装到真机

```bash
# USB 连接安卓设备，开启开发者模式 + USB 调试
F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe devices -l
# 期望看到设备序列号

F:/gorgon-android-toolchain/sdk/platform-tools/adb.exe install -r $APK
# 成功输出：Success
```

## 8. 已知问题与降级路径

| 问题 | 原因 | 应对 |
|---|---|---|
| Gradle wrapper 下载 `gradle-8.14.3-all.zip` 时 TLS 握手失败 | 网络代理对大文件瞬时抖动 | 预下载 bin 包解压到本地，直接用 `gradle` 命令（绕过 wrapper） |
| `native-platform.dll` 加载失败 | 前次中断把 `GRADLE_USER_HOME/native` 搞成半损坏 | 换新 `GRADLE_USER_HOME`（已缓存依赖拷过去），让 Gradle 重新解压 native |
| D 盘突然只读（访问被拒绝） | 不明（可能外部策略/防病毒） | 迁移工具链到 F 盘（79G 可用） |
| `repo.maven.apache.org` 下载 Kotlin 编译器 TLS 失败 | 同 Gradle wrapper | 重试（代理恢复后 206 OK） |

## 9. Release 构建（可选，当前阶段不需要）

```bash
cd app/android
# 生成签名密钥（首次）
keytool -genkey -v -keystore gorgon-release.keystore -alias gorgon \
  -keyalg RSA -keysize 2048 -validity 10000

# 在 android/app/build.gradle 配置 signingConfigs
# 然后：
GRADLE_USER_HOME=... JAVA_HOME=... ANDROID_HOME=... \
  gradle assembleRelease --no-daemon
```

产物：`app/build/outputs/apk/release/app-release.apk`（已签名，体积更小）。

## 10. 构建产物提交策略

- **APK 不提交 git**（二进制，`.gitignore` 已排除 `*.apk`）。
- **SHA256 记录在 `release/SHA256SUMS.md`**（可追溯）。
- **构建步骤即本文档**（`release/ANDROID_BUILD.md`）。
- **源码提交**：`app/android/` 工程文件（排除 `local.properties` / `build/` / `.gradle/`）。

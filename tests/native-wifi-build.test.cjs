const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process"),
  plist = require("plist");
test("generated native bridges register once, put iOS permissions at the root and preserve HTTPS policy", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "family-money-native-wifi-"),
  );
  const write = (name, text) => {
    const full = path.join(temp, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  };
  try {
    write(
      "capacitor.config.json",
      JSON.stringify({ appId: "com.familycashbook.preview" }),
    );
    for (const name of ["LocalWifiPlugin.java", "LocalWifiPlugin.swift"])
      write(
        "native/local-wifi/" + name,
        fs.readFileSync(path.join(__dirname, "../native/local-wifi", name)),
      );
    write(
      "android/app/src/main/AndroidManifest.xml",
      '<manifest><application android:usesCleartextTraffic="false"/></manifest>',
    );
    write(
      "android/variables.gradle",
      "ext { minSdkVersion = 24; targetSdkVersion = 36; }",
    );
    write(
      "android/app/src/main/java/com/familycashbook/preview/MainActivity.java",
      "package com.familycashbook.preview;\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onActivityResult() {}\n}",
    );
    write(
      "ios/App/App/Info.plist",
      plist.build({
        CFBundleName: "Preview",
        UIApplicationSceneManifest: {
          UISceneConfigurations: {
            UIWindowSceneSessionRoleApplication: [
              { UISceneStoryboardFile: "Main" },
            ],
          },
        },
      }),
    );
    write(
      "ios/App/App/AppDelegate.swift",
      "import UIKit\nclass AppDelegate {}\n",
    );
    write(
      "ios/App/App/Base.lproj/Main.storyboard",
      '<viewController customClass="CAPBridgeViewController" customModule="Capacitor"/>',
    );
    const script = path.resolve(__dirname, "../scripts/patch-local-wifi.mjs");
    for (let i = 0; i < 2; i++)
      execFileSync(process.execPath, [script], { cwd: temp, stdio: "pipe" });
    const config = plist.parse(
      fs.readFileSync(path.join(temp, "ios/App/App/Info.plist"), "utf8"),
    );
    assert.match(config.NSCameraUsageDescription, /pairing/);
    assert.match(config.NSLocalNetworkUsageDescription, /encrypted/);
    assert.equal(
      config.UIApplicationSceneManifest.UISceneConfigurations
        .UIWindowSceneSessionRoleApplication[0].NSCameraUsageDescription,
      undefined,
    );
    assert.equal(config.NSAppTransportSecurity, undefined);
    const activity = fs.readFileSync(
      path.join(
        temp,
        "android/app/src/main/java/com/familycashbook/preview/MainActivity.java",
      ),
      "utf8",
    );
    assert.equal(
      (activity.match(/registerPlugin\(LocalWifiPlugin.class\)/g) || []).length,
      1,
    );
    assert.match(
      fs.readFileSync(path.join(temp, "android/variables.gradle"), "utf8"),
      /minSdkVersion = 26/,
    );
    assert.match(
      fs.readFileSync(
        path.join(temp, "android/app/src/main/AndroidManifest.xml"),
        "utf8",
      ),
      /usesCleartextTraffic="false"/,
    );
    const swift = fs.readFileSync(
      path.join(temp, "ios/App/App/AppDelegate.swift"),
      "utf8",
    );
    assert.equal(
      (swift.match(/class WifiBridgeViewController/g) || []).length,
      1,
    );
    assert.match(swift, /registerPluginInstance\(LocalWifiPlugin\(\)\)/);
  } finally {
    const resolved = path.resolve(temp),
      root = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(root + path.sep));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

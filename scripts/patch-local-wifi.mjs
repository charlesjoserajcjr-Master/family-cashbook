// Reproducibly install the narrow local-Wi-Fi bridge into generated Capacitor projects.
import fs from "node:fs";
const cap = JSON.parse(fs.readFileSync("capacitor.config.json", "utf8"));
if (fs.existsSync("android/app/src/main/AndroidManifest.xml")) {
  const dir = "android/app/src/main/java/" + cap.appId.replaceAll(".", "/");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dir + "/LocalWifiPlugin.java",
    fs
      .readFileSync("native/local-wifi/LocalWifiPlugin.java", "utf8")
      .replace("__APP_ID__", cap.appId),
  );
  const main = dir + "/MainActivity.java";
  let s = fs.readFileSync(main, "utf8");
  if (!s.includes("registerPlugin(LocalWifiPlugin.class)")) {
    s = s.replace(
      "    @Override",
      "    @Override\n    public void onCreate(android.os.Bundle state) { registerPlugin(LocalWifiPlugin.class); super.onCreate(state); }\n\n    @Override",
    );
    fs.writeFileSync(main, s);
  }
  const vars = "android/variables.gradle";
  s = fs
    .readFileSync(vars, "utf8")
    .replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 26");
  fs.writeFileSync(vars, s);
}
if (fs.existsSync("ios/App/App/Info.plist")) {
  const plist = "ios/App/App/Info.plist";
  let s = fs.readFileSync(plist, "utf8");
  const entries = {
    NSCameraUsageDescription:
      "Scan the pairing QR code displayed by your Family Money laptop app.",
    NSLocalNetworkUsageDescription:
      "Sync your encrypted financial records directly with your paired laptop on the same Wi-Fi.",
  };
  for (const [key, value] of Object.entries(entries))
    if (!s.includes("<key>" + key + "</key>"))
      s = s.replace(
        /<\/dict>\s*<\/plist>\s*$/,
        "\t<key>" +
          key +
          "</key>\n\t<string>" +
          value +
          "</string>\n</dict>\n</plist>\n",
      );
  fs.writeFileSync(plist, s);
  const app = "ios/App/App/AppDelegate.swift";
  s = fs.readFileSync(app, "utf8");
  const marker = "// BEGIN READYTROVE LOCAL WIFI";
  s =
    s.split(marker)[0].trimEnd() +
    "\n\n" +
    marker +
    "\n" +
    fs.readFileSync("native/local-wifi/LocalWifiPlugin.swift", "utf8");
  fs.writeFileSync(app, s);
  const storyboard = "ios/App/App/Base.lproj/Main.storyboard";
  s = fs.readFileSync(storyboard, "utf8");
  s = s.replace(
    /customClass="CAPBridgeViewController" customModule="Capacitor"/,
    'customClass="WifiBridgeViewController" customModule="App" customModuleProvider="target"',
  );
  if (!s.includes('customClass="WifiBridgeViewController"'))
    throw Error("Could not register iOS local Wi-Fi bridge");
  fs.writeFileSync(storyboard, s);
}
console.log("Native local Wi-Fi bridge installed; HTTPS policies unchanged.");

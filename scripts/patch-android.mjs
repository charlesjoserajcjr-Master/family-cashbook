// Adjusts the generated Android project: version numbers and release signing from the build environment.
import fs from "node:fs";
const gradle = "android/app/build.gradle";
const run = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10);
const versionName = process.env.VERSION_NAME || `1.0.${run}`;
let g = fs.readFileSync(gradle, "utf8");
const must = (re, what) => { if (!re.test(g)) throw new Error("patch-android: could not find " + what + " in build.gradle"); };
must(/versionCode\s+\d+/, "versionCode");
g = g.replace(/versionCode\s+\d+/, `versionCode ${run}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
if (!g.includes("signingConfigs")) {
  must(/buildTypes\s*\{/, "buildTypes");
  g = g.replace(/buildTypes\s*\{/, `signingConfigs {
        release {
            if (System.getenv("KEYSTORE_FILE")) {
                storeFile file(System.getenv("KEYSTORE_FILE"))
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }
    buildTypes {`);
  must(/buildTypes\s*\{\s*release\s*\{/, "buildTypes.release");
  g = g.replace(/(buildTypes\s*\{\s*release\s*\{)/, `$1
            if (System.getenv("KEYSTORE_FILE")) { signingConfig signingConfigs.release }`);
}
fs.writeFileSync(gradle, g);
console.log(`build.gradle: versionCode ${run}, versionName ${versionName}, release signing from environment`);

// Google sign-in (Capgo Social Login) needs MainActivity to hand Google's result back to the plugin.
const appId = JSON.parse(fs.readFileSync("capacitor.config.json", "utf8")).appId;
const actDir = "android/app/src/main/java/" + appId.replace(/\./g, "/");
fs.mkdirSync(actDir, { recursive: true });
fs.writeFileSync(actDir + "/MainActivity.java", `package ${appId};

import android.content.Intent;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle == null) { Log.i("Google Activity Result", "SocialLogin handle is null"); return; }
            Plugin plugin = handle.getInstance();
            if (!(plugin instanceof SocialLoginPlugin)) { Log.i("Google Activity Result", "not SocialLoginPlugin"); return; }
            ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
`);
console.log("MainActivity.java: Google sign-in hook added");

await import('./patch-local-wifi.mjs');

// Family Money protection: Android Keystore device key, no automatic Android backup of the records, no screenshots in release builds.
fs.writeFileSync(actDir + "/DeviceKeyPlugin.java", fs.readFileSync("native/device-key/DeviceKeyPlugin.java", "utf8").replace("__PACKAGE__", appId));
const mainPath = actDir + "/MainActivity.java";
let main = fs.readFileSync(mainPath, "utf8");
if (!main.includes("registerPlugin(LocalWifiPlugin.class);")) throw new Error("patch-android: MainActivity onCreate not found");
main = main.replace("registerPlugin(LocalWifiPlugin.class);", "registerPlugin(LocalWifiPlugin.class); registerPlugin(DeviceKeyPlugin.class);");
if (!appId.endsWith(".preview")) main = main.replace("super.onCreate(state);", "super.onCreate(state); getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);");
fs.writeFileSync(mainPath, main);
const manifestPath = "android/app/src/main/AndroidManifest.xml";
let manifest = fs.readFileSync(manifestPath, "utf8");
if (!/android:allowBackup="/.test(manifest)) manifest = manifest.replace("<application", '<application\n        android:allowBackup="false"');
else manifest = manifest.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"');
fs.writeFileSync(manifestPath, manifest);
console.log("Protection: device key added, Android backup off, screen protection " + (appId.endsWith(".preview") ? "off (preview)" : "on"));

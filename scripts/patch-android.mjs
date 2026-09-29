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

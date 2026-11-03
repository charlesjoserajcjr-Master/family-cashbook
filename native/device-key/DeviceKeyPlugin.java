package __PACKAGE__;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Family Money device key.
 * An AES-256-GCM key lives in the Android Keystore (hardware-backed, StrongBox where the phone has it) and can never be
 * read out of it. The app seals a random "device secret" with it; the PIN is then stretched together with that secret.
 * A copy of the app's files taken off the phone therefore has nothing to guess against.
 * wrap/unwrap take and return base64. A wrapped value is 12 bytes of iv followed by the ciphertext.
 */
@CapacitorPlugin(name = "DeviceKey")
public class DeviceKeyPlugin extends Plugin {
    private static final String ALIAS = "family_money_device_key_v1";

    private SecretKey existing() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private SecretKey create() throws Exception {
        for (int attempt = 0; attempt < 2; attempt++) {
            boolean strong = attempt == 0 && android.os.Build.VERSION.SDK_INT >= 28;
            try {
                KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256);
                if (strong) b.setIsStrongBoxBacked(true);
                KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                g.init(b.build());
                return g.generateKey();
            } catch (Exception e) {
                if (!strong) throw e;   // StrongBox not available on this phone: fall back to the normal secure hardware
            }
        }
        throw new IllegalStateException("no key");
    }

    @PluginMethod
    public void wrap(PluginCall call) {
        try {
            String data = call.getString("data");
            if (data == null) { call.reject("NO_DATA"); return; }
            SecretKey k = existing();
            if (k == null) k = create();
            byte[] iv, ct;
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, k);
                iv = c.getIV();
                ct = c.doFinal(Base64.decode(data, Base64.NO_WRAP));
            } catch (Exception first) {
                // A key that was just deleted and re-made can be left unusable on some phones: start again with a fresh one
                KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
                ks.load(null);
                if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
                k = create();
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, k);
                iv = c.getIV();
                ct = c.doFinal(Base64.decode(data, Base64.NO_WRAP));
            }
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(out, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("WRAP_FAILED: " + e.getClass().getSimpleName() + " " + e.getMessage());
        }
    }

    @PluginMethod
    public void unwrap(PluginCall call) {
        try {
            String data = call.getString("data");
            if (data == null) { call.reject("NO_DATA"); return; }
            SecretKey k = existing();
            if (k == null) { call.reject("NO_KEY"); return; }
            byte[] in = Base64.decode(data, Base64.NO_WRAP);
            if (in.length < 28) { call.reject("BAD_DATA"); return; }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, in, 0, 12));
            byte[] pt = c.doFinal(in, 12, in.length - 12);
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(pt, Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("UNWRAP_FAILED");   // the key is there but does not open this value (key lost and re-made, or data damaged)
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
            call.resolve();
        } catch (Exception e) {
            call.reject("REMOVE_FAILED");
        }
    }
}

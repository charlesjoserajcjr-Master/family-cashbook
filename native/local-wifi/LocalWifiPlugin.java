package __APP_ID__;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Socket;
import java.net.InetSocketAddress;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

/** Narrow ciphertext transport, not a general HTTP client. No redirects, DNS,
 * arbitrary ports below 1024, public endpoints or global cleartext exceptions. */
@CapacitorPlugin(name = "LocalWifi")
public class LocalWifiPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile Socket activeSocket;
    @PluginMethod
    public void cancel(PluginCall call) { try { if(activeSocket!=null)activeSocket.close(); } catch(Exception ignored) {} call.resolve(); }
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private static boolean privateIP(String value) {
        String[] p = value.split("\\.", -1);
        if (p.length != 4) return false;
        int[] n = new int[4];
        try { for (int i=0;i<4;i++) { n[i]=Integer.parseInt(p[i]); if(n[i]<0||n[i]>255||!Integer.toString(n[i]).equals(p[i]))return false; } }
        catch(Exception e){return false;}
        return n[0]==10 || (n[0]==172&&n[1]>=16&&n[1]<=31) || (n[0]==192&&n[1]==168);
    }
    @PluginMethod
    public void request(PluginCall call) {
        String host=call.getString("host", ""), route=call.getString("route", ""), body=call.getString("body", "");
        int port=call.getInt("port", 0);
        if(!privateIP(host)||port<1024||port>65535||!(route.equals("/v1/challenge")||route.equals("/v1/message"))||body.length()>42*1024*1024) {call.reject("Invalid local app endpoint");return;}
        if(!busy.compareAndSet(false,true)){call.reject("A local request is already running");return;}
        executor.execute(() -> {
            try(Socket socket=new Socket()) {
                activeSocket=socket;
                socket.connect(new InetSocketAddress(host,port),8000);socket.setSoTimeout(90000);
                byte[] data=body.getBytes(StandardCharsets.UTF_8);
                String header="POST "+route+" HTTP/1.1\r\nHost: "+host+":"+port+"\r\nContent-Type: application/json\r\nContent-Length: "+data.length+"\r\nConnection: close\r\n\r\n";
                socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII));socket.getOutputStream().write(data);socket.getOutputStream().flush();
                ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
                while((n=socket.getInputStream().read(buffer))!=-1){if(out.size()+n>42*1024*1024)throw new Exception("Response too large");out.write(buffer,0,n);}
                String response=out.toString("UTF-8");int split=response.indexOf("\r\n\r\n");
                if(split<0||!response.startsWith("HTTP/1.1 200 "))throw new Exception("Laptop rejected the request. Unlock it and try again.");
                JSObject result=new JSObject();result.put("body",response.substring(split+4));call.resolve(result);
            }catch(Exception e){call.reject("Could not connect locally. Keep both apps open on the same private Wi-Fi and allow Family Money through the laptop firewall.");}
            finally{activeSocket=null;busy.set(false);}
        });
    }
}

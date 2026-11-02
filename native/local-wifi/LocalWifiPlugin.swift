// App-local transport for already encrypted protocol messages. Network.framework
// avoids a global ATS exception; endpoints are literal RFC1918 IPv4 addresses only.
import Capacitor
import Network

@objc(LocalWifiPlugin)
public class LocalWifiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalWifiPlugin"
    public let jsName = "LocalWifi"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)]
    private let queue = DispatchQueue(label: "com.familycashbook.localwifi")
    private var busy = false
    private var cancelRequest: (() -> Void)?
    @objc func cancel(_ call: CAPPluginCall) { queue.async { self.cancelRequest?(); call.resolve() } }
    private func privateIP(_ value: String) -> Bool {
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        var n: [Int] = []
        for p in parts { guard let v = Int(p), v >= 0, v <= 255, String(v) == String(p) else { return false }; n.append(v) }
        return n[0] == 10 || (n[0] == 172 && n[1] >= 16 && n[1] <= 31) || (n[0] == 192 && n[1] == 168)
    }
    @objc func request(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), privateIP(host), let port = call.getInt("port"), port >= 1024, port <= 65535,
              let route = call.getString("route"), ["/v1/challenge", "/v1/message"].contains(route),
              let body = call.getString("body"), body.utf8.count <= 42 * 1024 * 1024 else { call.reject("Invalid local app endpoint"); return }
        queue.async {
            guard !self.busy else { call.reject("A local request is already running"); return }; self.busy = true
            let connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: UInt16(port))!, using: .tcp)
            var finished = false
            var response = Data()
            func finish(_ error: Bool) {
                guard !finished else { return }; finished = true; self.busy = false; self.cancelRequest = nil; connection.cancel()
                if !error, let text = String(data: response, encoding: .utf8), text.hasPrefix("HTTP/1.1 200 "), let split = text.range(of: "\r\n\r\n") { call.resolve(["body": String(text[split.upperBound...])]) }
                else { call.reject("Could not connect locally. Keep both apps open on the same private Wi-Fi, allow Local Network access, and check the laptop firewall.") }
            }
            self.cancelRequest = { finish(true) }
            func receive() {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
                    guard !finished else { return }
                    if let data = data { response.append(data) }
                    if response.count > 42 * 1024 * 1024 || error != nil { finish(true) }
                    else if complete { finish(false) } else { receive() }
                }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let header = "POST \(route) HTTP/1.1\r\nHost: \(host):\(port)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
                    connection.send(content: Data((header + body).utf8), completion: .contentProcessed { error in if error != nil { finish(true) } else { receive() } })
                case .failed(_): finish(true)
                default: break
                }
            }
            self.queue.asyncAfter(deadline: .now() + 90) { finish(true) }
            connection.start(queue: self.queue)
        }
    }
}

class WifiBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(LocalWifiPlugin()) }
}

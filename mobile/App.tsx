import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";
import { useKeepAwake } from "expo-keep-awake";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Native speaker client. The synchronized-audio engine (WebRTC + Web Audio
// channel routing + drift correction) only exists in the web app, so the app
// embeds the host's /speaker page in a hardened WebView and wraps it with the
// native pieces App Review expects: onboarding, saved identity, a QR join flow,
// a connection bar, and keep-awake + background-audio handling.

const HOST_KEY = "surround.hostUrl";
const NAME_KEY = "surround.deviceName";

function normalizeHost(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "http://" + v;
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}`; // strip any path; we append /speaker
  } catch {
    return null;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hostInput, setHostInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const webRef = useRef<WebView>(null);

  useKeepAwake(); // a satellite speaker must not sleep mid-track

  useEffect(() => {
    void (async () => {
      const [h, n] = await Promise.all([
        AsyncStorage.getItem(HOST_KEY),
        AsyncStorage.getItem(NAME_KEY),
      ]);
      if (h) {
        setHost(h);
        setHostInput(h);
      }
      setName(n ?? "My phone");
      setReady(true);
    })();
  }, []);

  const connect = useCallback(async (rawHost: string, rawName: string) => {
    const h = normalizeHost(rawHost);
    if (!h) {
      setError("Enter a valid address, e.g. 192.168.1.45:3002");
      return;
    }
    const n = rawName.trim() || "My phone";
    await AsyncStorage.multiSet([
      [HOST_KEY, h],
      [NAME_KEY, n],
    ]);
    setError(null);
    setName(n);
    setHost(h);
  }, []);

  const disconnect = useCallback(async () => {
    setHost(null);
    setConnected(false);
  }, []);

  const onScan = useCallback(({ data }: { data: string }) => {
    setScanning(false);
    const h = normalizeHost(data);
    if (h) setHostInput(h);
    else setError("That QR code isn't a host address.");
  }, []);

  if (!ready) {
    return (
      <View style={[styles.fill, styles.center, styles.bg]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // QR scanner overlay.
  if (scanning) {
    return (
      <SafeAreaView style={[styles.fill, styles.bg]}>
        <StatusBar style="light" />
        {permission?.granted ? (
          <CameraView
            style={styles.fill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScan}
          />
        ) : (
          <View style={[styles.fill, styles.center, styles.pad]}>
            <Text style={styles.body}>Camera permission is needed to scan.</Text>
            <Pressable style={styles.btn} onPress={() => void requestPermission()}>
              <Text style={styles.btnText}>Grant camera access</Text>
            </Pressable>
          </View>
        )}
        <Pressable style={styles.cancelScan} onPress={() => setScanning(false)}>
          <Text style={styles.btnText}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Setup / onboarding screen.
  if (!host) {
    return (
      <SafeAreaView style={[styles.fill, styles.bg]}>
        <StatusBar style="light" />
        <View style={[styles.pad, styles.center, styles.fill]}>
          <Text style={styles.title}>Surround Speaker</Text>
          <Text style={styles.subtitle}>
            Turn this phone into a synchronized satellite speaker for music
            playing on a nearby computer.
          </Text>

          <Text style={styles.label}>Host address</Text>
          <TextInput
            style={styles.input}
            value={hostInput}
            onChangeText={setHostInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="192.168.1.45:3002"
            placeholderTextColor="#888"
          />

          <Text style={styles.label}>This device&apos;s name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Kitchen phone"
            placeholderTextColor="#888"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable style={styles.btn} onPress={() => void connect(hostInput, name)}>
            <Text style={styles.btnText}>Join as speaker</Text>
          </Pressable>
          <Pressable
            style={styles.btnGhost}
            onPress={() => {
              setError(null);
              setScanning(true);
            }}
          >
            <Text style={styles.btnGhostText}>Scan host QR code</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Connected: embed the speaker page, name injected into its storage.
  const injectName = `try{localStorage.setItem('surround.name', ${JSON.stringify(
    name,
  )});}catch(e){}; true;`;
  const speakerUrl = `${host}/speaker`;

  return (
    <SafeAreaView style={[styles.fill, styles.bg]}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View style={styles.row}>
          <View
            style={[styles.dot, { backgroundColor: connected ? "#22c55e" : "#f59e0b" }]}
          />
          <Text style={styles.topText} numberOfLines={1}>
            {connected ? "Connected" : "Connecting"} ·{" "}
            {host.replace(/^https?:\/\//, "")}
          </Text>
        </View>
        <Pressable onPress={() => void disconnect()}>
          <Text style={styles.changeText}>Change host</Text>
        </Pressable>
      </View>

      <WebView
        ref={webRef}
        source={{ uri: speakerUrl }}
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={injectName}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        onLoadStart={() => setConnected(false)}
        onLoadEnd={() => setConnected(true)}
        onError={() =>
          setError("Couldn't reach the host — same Wi-Fi? Is it streaming?")
        }
        style={styles.fill}
      />
      {error && (
        <Pressable style={styles.errorBar} onPress={() => Linking.openURL(speakerUrl)}>
          <Text style={styles.errorBarText}>{error}</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bg: { backgroundColor: "#0a0a0a" },
  center: { alignItems: "center", justifyContent: "center" },
  pad: { padding: 24, gap: 12 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  subtitle: { color: "#9ca3af", textAlign: "center", marginBottom: 20 },
  label: { color: "#9ca3af", alignSelf: "stretch", fontSize: 13, marginTop: 8 },
  input: {
    alignSelf: "stretch",
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  body: { color: "#fff", textAlign: "center", marginBottom: 16 },
  error: { color: "#f87171", alignSelf: "stretch" },
  btn: {
    alignSelf: "stretch",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  btnText: { color: "#0a0a0a", fontWeight: "700", fontSize: 16 },
  btnGhost: { alignSelf: "stretch", paddingVertical: 12, alignItems: "center" },
  btnGhostText: { color: "#9ca3af", fontWeight: "600" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  topText: { color: "#e5e7eb", fontSize: 13, flexShrink: 1 },
  changeText: { color: "#60a5fa", fontSize: 13, fontWeight: "600" },
  cancelScan: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  errorBar: { backgroundColor: "#7f1d1d", padding: 10 },
  errorBarText: { color: "#fecaca", textAlign: "center", fontSize: 13 },
});

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { WebView } from "react-native-webview";
import { useKeepAwake } from "expo-keep-awake";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useFonts,
  BricolageGrotesque_300Light,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

// Native speaker client. The synchronized-audio engine (WebRTC + Web Audio
// channel routing + drift correction) only exists in the web app, so the app
// embeds the host's /speaker page in a hardened WebView and wraps it with the
// native pieces App Review expects: onboarding, saved identity, a QR join flow,
// a connection bar, and keep-awake + background-audio handling.
//
// Visual identity: this phone as one node emitting into a synchronized sound
// field. Deep indigo field, warm "signal" accent, a Bricolage wordmark, and a
// sonar pulse as the signature.

const C = {
  field: "#0A0C16",
  fieldTop: "#10132A",
  raise: "#161A2C",
  line: "#2A3050",
  ink: "#EEF0FB",
  inkSoft: "#888FB5",
  signal: "#FF8A4C", // action / brand
  live: "#6BE5D8", // reserved for the connected state
};
const F = {
  display: "BricolageGrotesque_800ExtraBold",
  displayLight: "BricolageGrotesque_300Light",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
};

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

/** Concentric rings pulsing outward from a node — this device in the field. */
function SoundField({
  color,
  reduceMotion,
  size = 300,
}: {
  color: string;
  reduceMotion: boolean;
  size?: number;
}) {
  const count = 4;
  const anims = useRef(
    Array.from({ length: count }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 1100),
          Animated.timing(a, {
            toValue: 1,
            duration: 4400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims, reduceMotion]);

  return (
    <View pointerEvents="none" style={[styles.fieldWrap, { width: size, height: size }]}>
      {/* Faint persistent rings so the field reads even between pulses. */}
      {[0.45, 0.78, 1].map((s, i) => (
        <View
          key={`static-${i}`}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: color,
              opacity: 0.08,
              transform: [{ scale: s }],
            },
          ]}
        />
      ))}
      {anims.map((a, i) => {
        const scale = reduceMotion
          ? 0.4 + i * 0.3
          : a.interpolate({ inputRange: [0, 1], outputRange: [0.32, 1.5] });
        const opacity = reduceMotion
          ? 0.1
          : a.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.5, 0] });
        return (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: color,
                opacity,
                transform: [{ scale }],
              },
            ]}
          />
        );
      })}
      <View style={[styles.node, { backgroundColor: color, shadowColor: color }]} />
    </View>
  );
}

/** Small pulsing dot for the connection bar. */
function PulseDot({ color, active }: { color: string; active: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a, active]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  return (
    <View style={styles.dotWrap}>
      {active && (
        <Animated.View
          style={[styles.dotHalo, { backgroundColor: color, transform: [{ scale }], opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }) }]}
        />
      )}
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_300Light,
    BricolageGrotesque_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [ready, setReady] = useState(false);
  const [host, setHost] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [hostInput, setHostInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [focus, setFocus] = useState<"host" | "name" | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const webRef = useRef<WebView>(null);

  useKeepAwake();

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
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
      setError("Enter a valid address, like 192.168.1.45:3002");
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

  if (!fontsLoaded || !ready) {
    return <View style={[styles.fill, { backgroundColor: C.field }]} />;
  }

  // QR scanner.
  if (scanning) {
    return (
      <View style={[styles.fill, { backgroundColor: "#000" }]}>
        <StatusBar style="light" />
        {permission?.granted ? (
          <CameraView
            style={styles.fill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScan}
          />
        ) : (
          <SafeAreaView style={[styles.fill, styles.center, styles.pad]}>
            <Text style={styles.body}>Camera access is needed to scan a host code.</Text>
            <Pressable style={styles.cta} onPress={() => void requestPermission()}>
              <Text style={styles.ctaText}>Allow camera</Text>
            </Pressable>
          </SafeAreaView>
        )}
        <View pointerEvents="none" style={styles.reticle} />
        <SafeAreaView style={styles.scanHint}>
          <Text style={styles.scanHintText}>Point at the host&apos;s QR code</Text>
        </SafeAreaView>
        <Pressable style={styles.cancelScan} onPress={() => setScanning(false)}>
          <Text style={styles.cancelScanText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  // Onboarding.
  if (!host) {
    return (
      <View style={styles.fill}>
        <StatusBar style="light" />
        <LinearGradient colors={[C.fieldTop, C.field]} style={StyleSheet.absoluteFill} />
        <View style={styles.fieldBackdrop} pointerEvents="none">
          <SoundField color={C.signal} reduceMotion={reduceMotion} />
        </View>
        <SafeAreaView style={styles.fill}>
          <View style={styles.onboard}>
            <View style={styles.wordmark}>
              <Text style={styles.wmTop}>SURROUND</Text>
              <Text style={styles.wmBottom}>SPEAKER</Text>
            </View>
            <Text style={styles.lede}>
              Make this phone one voice in a room full of them — in time with the
              music on a nearby computer.
            </Text>

            <View style={styles.form}>
              <Text style={styles.label}>Host address</Text>
              <TextInput
                style={[styles.input, focus === "host" && styles.inputFocus]}
                value={hostInput}
                onChangeText={setHostInput}
                onFocus={() => setFocus("host")}
                onBlur={() => setFocus(null)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="192.168.1.45:3002"
                placeholderTextColor={C.inkSoft}
              />

              <Text style={[styles.label, { marginTop: 18 }]}>Name this speaker</Text>
              <TextInput
                style={[styles.input, focus === "name" && styles.inputFocus]}
                value={name}
                onChangeText={setName}
                onFocus={() => setFocus("name")}
                onBlur={() => setFocus(null)}
                placeholder="Kitchen phone"
                placeholderTextColor={C.inkSoft}
              />

              {error && <Text style={styles.error}>{error}</Text>}

              <Pressable
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
                onPress={() => void connect(hostInput, name)}
              >
                <Text style={styles.ctaText}>Join as speaker</Text>
              </Pressable>
              <Pressable
                style={styles.ghost}
                onPress={() => {
                  setError(null);
                  setScanning(true);
                }}
              >
                <Text style={styles.ghostText}>Scan host QR code</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Connected: embed the speaker page with the device name injected.
  const injectName = `try{localStorage.setItem('surround.name', ${JSON.stringify(
    name,
  )});}catch(e){}; true;`;
  const speakerUrl = `${host}/speaker`;
  const shortHost = host.replace(/^https?:\/\//, "");

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: C.field }]}>
      <StatusBar style="light" />
      <View style={styles.topBar}>
        <View style={styles.topLeft}>
          <PulseDot color={connected ? C.live : C.signal} active={connected} />
          <View>
            <Text style={styles.topStatus}>
              {connected ? "Live in the field" : "Reaching host"}
            </Text>
            <Text style={styles.topHost} numberOfLines={1}>
              {shortHost}
            </Text>
          </View>
        </View>
        <Pressable hitSlop={10} onPress={() => void disconnect()}>
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
          setError("Couldn't reach the host — same Wi-Fi, and is it running?")
        }
        style={styles.fill}
      />
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorBarText}>{error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  pad: { padding: 28 },

  // sound field signature
  fieldWrap: { alignItems: "center", justifyContent: "center" },
  fieldBackdrop: {
    position: "absolute",
    top: "16%",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  ring: { position: "absolute", borderWidth: 1.5 },
  node: {
    width: 13,
    height: 13,
    borderRadius: 7,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  // onboarding
  onboard: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 28, paddingBottom: 24 },
  wordmark: { marginBottom: 14 },
  wmTop: {
    fontFamily: F.display,
    color: C.ink,
    fontSize: 40,
    letterSpacing: 1,
    lineHeight: 42,
  },
  wmBottom: {
    fontFamily: F.displayLight,
    color: C.signal,
    fontSize: 40,
    letterSpacing: 13,
    lineHeight: 44,
  },
  lede: {
    fontFamily: F.regular,
    color: C.inkSoft,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 320,
    marginBottom: 26,
  },
  form: { gap: 0 },
  label: {
    fontFamily: F.semibold,
    color: C.inkSoft,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  input: {
    backgroundColor: C.raise,
    color: C.ink,
    fontFamily: F.medium,
    fontSize: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inputFocus: { borderColor: C.signal },
  error: { fontFamily: F.medium, color: "#FF6B6B", marginTop: 14 },
  cta: {
    backgroundColor: C.signal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
    shadowColor: C.signal,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  ctaPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  ctaText: { fontFamily: F.bold, color: "#1A0E06", fontSize: 16, letterSpacing: 0.3 },
  ghost: { paddingVertical: 14, alignItems: "center" },
  ghostText: { fontFamily: F.semibold, color: C.inkSoft, fontSize: 14 },
  body: { fontFamily: F.regular, color: C.ink, textAlign: "center", marginBottom: 18, fontSize: 15 },

  // connection bar
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.raise,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  topStatus: { fontFamily: F.semibold, color: C.ink, fontSize: 13 },
  topHost: { fontFamily: F.regular, color: C.inkSoft, fontSize: 11 },
  changeText: { fontFamily: F.semibold, color: C.signal, fontSize: 13 },
  dotWrap: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotHalo: { position: "absolute", width: 8, height: 8, borderRadius: 4 },

  // scanner
  reticle: {
    position: "absolute",
    top: "32%",
    left: "18%",
    width: "64%",
    aspectRatio: 1,
    borderColor: C.signal,
    borderWidth: 2,
    borderRadius: 24,
    opacity: 0.9,
  },
  scanHint: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingTop: 16 },
  scanHintText: { fontFamily: F.medium, color: "#fff", fontSize: 14 },
  cancelScan: {
    position: "absolute",
    bottom: 52,
    alignSelf: "center",
    backgroundColor: C.signal,
    paddingHorizontal: 30,
    paddingVertical: 13,
    borderRadius: 26,
  },
  cancelScanText: { fontFamily: F.bold, color: "#1A0E06", fontSize: 15 },

  errorBar: { backgroundColor: "#3A1212", paddingVertical: 10, paddingHorizontal: 14 },
  errorBarText: { fontFamily: F.medium, color: "#FFC9C9", textAlign: "center", fontSize: 13 },
});

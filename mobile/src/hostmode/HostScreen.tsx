// "Host on this phone" screen — the entry point for phone-host mode (no
// computer, LAN-only). Captures this phone's audio and broadcasts to nearby
// phones that join over the LAN. Visual language matches the onboarding screen
// (deep indigo field, warm "signal" accent).
//
// When the native modules aren't in the build (Expo Go), the hook reports
// `available === false` and we show a clear "needs a dev build" notice instead
// of letting anything crash.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { useHostSession } from "./useHostSession";

const C = {
  field: "#0A0C16",
  raise: "#161A2C",
  line: "#2A3050",
  ink: "#EEF0FB",
  inkSoft: "#888FB5",
  signal: "#FF8A4C",
  live: "#6BE5D8",
  warn: "#FFC9C9",
};

export function HostScreen({
  hostId,
  hostName,
  onExit,
}: {
  hostId: string;
  hostName: string;
  onExit: () => void;
}) {
  useKeepAwake();
  const s = useHostSession(hostId, hostName);
  const connected = s.peers.filter((p) => p.connected).length;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: C.field }]}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Pressable hitSlop={10} onPress={onExit}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.barTitle}>Host on this phone</Text>
        <View style={styles.barSpacer} />
      </View>

      <View style={styles.body}>
        {!s.available ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Needs a dev build</Text>
            <Text style={styles.noticeText}>
              Phone-host mode streams live audio peer-to-peer, which needs native
              modules that aren&apos;t in this build. Run a dev build
              (`expo prebuild` then `expo run:ios`/`run:android`) to enable it.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.hint}>
              This phone is the source. Nearby phones on the same Wi-Fi can find
              and join it — no computer needed.
            </Text>

            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        s.status === "live" ? C.live : C.signal,
                    },
                  ]}
                />
                <Text style={styles.statusText}>
                  {s.status === "live"
                    ? "Live — accepting speakers"
                    : s.status === "starting"
                      ? "Starting…"
                      : s.status === "error"
                        ? "Error"
                        : "Idle"}
                </Text>
              </View>
              <Text style={styles.count}>
                {connected} {connected === 1 ? "speaker" : "speakers"} connected
              </Text>
            </View>

            {s.error && <Text style={styles.error}>{s.error}</Text>}

            {s.status === "idle" || s.status === "error" ? (
              <Pressable style={styles.cta} onPress={s.start}>
                <Text style={styles.ctaText}>Start hosting</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={styles.cta}
                  onPress={s.isPlaying ? s.pause : s.play}
                >
                  <Text style={styles.ctaText}>
                    {s.isPlaying ? "Pause" : "Play"}
                  </Text>
                </Pressable>
                <Pressable style={styles.ghost} onPress={s.stop}>
                  <Text style={styles.ghostText}>Stop hosting</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  back: { color: C.signal, fontSize: 15, fontWeight: "600", width: 64 },
  barTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  barSpacer: { width: 64 },
  body: { flex: 1, padding: 24, gap: 18 },
  hint: { color: C.inkSoft, fontSize: 15, lineHeight: 22 },
  statusCard: {
    backgroundColor: C.raise,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    gap: 10,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: C.ink, fontSize: 15, fontWeight: "600" },
  count: { color: C.inkSoft, fontSize: 13 },
  error: { color: C.warn, fontSize: 13, lineHeight: 19 },
  cta: {
    backgroundColor: C.signal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  ctaText: { color: "#1A0E06", fontSize: 16, fontWeight: "700" },
  ghost: { paddingVertical: 12, alignItems: "center" },
  ghostText: { color: C.inkSoft, fontSize: 14, fontWeight: "600" },
  notice: {
    backgroundColor: C.raise,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 20,
    gap: 10,
  },
  noticeTitle: { color: C.ink, fontSize: 16, fontWeight: "700" },
  noticeText: { color: C.inkSoft, fontSize: 14, lineHeight: 21 },
});

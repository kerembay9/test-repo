// "Join a phone host" screen — the guest side of phone-host mode (no computer,
// LAN-only). Discovers nearby phone hosts over the LAN, connects to the chosen
// one, and plays its live audio. Visual language matches HostScreen / onboarding.
//
// When the native modules aren't in the build (Expo Go), the hook reports
// `available === false` and we show a clear "needs a dev build" notice.

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import { useGuestSession } from "./useGuestSession";

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

export function GuestScreen({
  guestId,
  name,
  onExit,
}: {
  guestId: string;
  name: string;
  onExit: () => void;
}) {
  useKeepAwake();
  const s = useGuestSession(guestId, name);
  const playing = s.transport?.isPlaying ?? false;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: C.field }]}>
      <StatusBar style="light" />
      <View style={styles.bar}>
        <Pressable hitSlop={10} onPress={onExit}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.barTitle}>Join a phone host</Text>
        <View style={styles.barSpacer} />
      </View>

      <View style={styles.body}>
        {!s.available ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Needs a dev build</Text>
            <Text style={styles.noticeText}>
              Joining a phone host streams live audio peer-to-peer, which needs
              native modules that aren&apos;t in this build. Run a dev build
              (`expo prebuild` then `expo run:ios`/`run:android`) to enable it.
            </Text>
          </View>
        ) : s.status === "connected" || s.status === "connecting" ? (
          <View style={styles.connectedWrap}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: s.status === "connected" ? C.live : C.signal },
                ]}
              />
              <Text style={styles.statusText}>
                {s.status === "connected"
                  ? playing
                    ? "Live — playing"
                    : "Connected — host paused"
                  : "Connecting…"}
              </Text>
            </View>
            {s.error && <Text style={styles.error}>{s.error}</Text>}
            <Pressable style={styles.ghost} onPress={s.stop}>
              <Text style={styles.ghostText}>Leave</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.hint}>
              Pick a phone hosting nearby on the same Wi-Fi. No computer needed.
            </Text>
            {s.hosts.length > 0 ? (
              s.hosts.map((h) => (
                <Pressable
                  key={`${h.host}:${h.port}`}
                  style={styles.row}
                  onPress={() => s.connect(h)}
                >
                  <View style={styles.foundDot} />
                  <View style={styles.flex1}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {h.host}:{h.port}
                    </Text>
                  </View>
                  <Text style={styles.join}>Join</Text>
                </Pressable>
              ))
            ) : (
              <View style={styles.searching}>
                <ActivityIndicator size="small" color={C.signal} />
                <Text style={styles.searchingText}>Searching for phone hosts…</Text>
              </View>
            )}
            {s.error && <Text style={styles.error}>{s.error}</Text>}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex1: { flex: 1 },
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
  body: { flex: 1, padding: 24, gap: 14 },
  hint: { color: C.inkSoft, fontSize: 15, lineHeight: 22, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.raise,
    borderWidth: 1,
    borderColor: C.signal,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  foundDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.live },
  rowName: { color: C.ink, fontSize: 15, fontWeight: "600" },
  rowSub: { color: C.inkSoft, fontSize: 12 },
  join: { color: C.signal, fontSize: 14, fontWeight: "700" },
  searching: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  searchingText: { color: C.inkSoft, fontSize: 13 },
  connectedWrap: { gap: 16 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: C.ink, fontSize: 16, fontWeight: "600" },
  error: { color: C.warn, fontSize: 13, lineHeight: 19 },
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

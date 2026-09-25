import React, { useEffect, useRef } from "react";
import { Text, Animated, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../../store/AppContext.native";
import type { Toast } from "../../types";
import { color, radius, space, type } from "../../theme/tokens";

/**
 * The tab bar's height above the bottom safe-area inset — see
 * `app/(tabs)/_layout.tsx`, which sizes it `60 + insets.bottom`. Toasts sit
 * this far up, plus a gap, so they never cover the tabs.
 */
const TAB_BAR_HEIGHT = 60;

/** Ink for news, `heart` for failures. Success reads as news, not as green. */
export const toastBackground = (kind: Toast["type"]): string =>
  kind === "error" ? color.heart : color.text;

const ToastItem: React.FC<{ id: string; message: string; type?: Toast["type"] }> = ({
  id,
  message,
  type: kind = "info",
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  const { removeToast } = useApp();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();

    const timeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 20, duration: 200, useNativeDriver: true }),
      ]).start(() => removeToast(id));
    }, 3000);

    return () => clearTimeout(timeout);
  }, [id, opacity, translateY, removeToast]);

  return (
    <Animated.View
      style={[
        styles.toast,
        { backgroundColor: toastBackground(kind), opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        onPress={() => removeToast(id)}
        accessibilityRole="alert"
        accessibilityLabel={message}
      >
        <Text style={styles.message}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
};

const ToastContainer: React.FC = () => {
  const { toasts } = useApp();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <Animated.View
      style={[styles.container, { bottom: TAB_BAR_HEIGHT + insets.bottom + space.sm }]}
      pointerEvents="box-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} id={toast.id} message={toast.message} type={toast.type} />
      ))}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    zIndex: 9999,
  },
  toast: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginBottom: space.sm,
    borderRadius: radius.none,
  },
  message: {
    fontFamily: type.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: color.inverse,
    textAlign: "center",
  },
});

export default ToastContainer;

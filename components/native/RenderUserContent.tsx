import React from "react";
import { Text, Linking, StyleSheet } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { color, type } from "../../theme/tokens";

interface RenderUserContentProps {
  content: string;
  /**
   * Screens still on the old dark skin pass their own text colour here. When
   * one is given the default ink colour steps aside, so their light-on-dark
   * text stays legible until their re-skin removes it.
   */
  className?: string;
  /** Applied after the defaults — size and line height, for instance. */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export interface Segment {
  type: "text" | "mention" | "hashtag" | "link";
  value: string;
}

interface MatchInfo {
  type: "mention" | "hashtag" | "link";
  value: string;
  index: number;
  length: number;
}

const URL_PATTERN = /https?:\/\/[^\s]+/g;
const MENTION_PATTERN = /@(\w+)/g;
const HASHTAG_PATTERN = /#(\w+)/g;

/**
 * Split user text into plain runs, @mentions, #hashtags and links. Where two
 * matches overlap the earlier one wins, so a `#fragment` inside a URL stays
 * part of the link.
 */
export const segmentUserContent = (content: string): Segment[] => {
  const allMatches: MatchInfo[] = [];
  const collect = (pattern: RegExp, kind: MatchInfo["type"], group: 0 | 1) => {
    const regex = new RegExp(pattern.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      allMatches.push({ type: kind, value: match[group], index: match.index, length: match[0].length });
    }
  };
  collect(URL_PATTERN, "link", 0);
  collect(MENTION_PATTERN, "mention", 1);
  collect(HASHTAG_PATTERN, "hashtag", 1);

  allMatches.sort((a, b) => a.index - b.index);

  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const m of allMatches) {
    if (m.index < lastIndex) continue;
    if (m.index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, m.index) });
    }
    segments.push({ type: m.type, value: m.value });
    lastIndex = m.index + m.length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments;
};

/**
 * User-written text with its mentions, hashtags and links picked out.
 *
 * Mentions and hashtags are set in the medium weight rather than a link
 * colour; they inherit the body's colour, so on the light ground they are ink.
 * Mentions open the profile and links open the browser, as before. Hashtags
 * carry no tap target — they had none before this re-skin either.
 */
const RenderUserContent: React.FC<RenderUserContentProps> = ({
  content,
  className,
  style,
  numberOfLines,
}) => {
  const router = useRouter();

  if (!content) return null;

  const segments = segmentUserContent(content);

  return (
    <Text
      className={className}
      numberOfLines={numberOfLines}
      style={[styles.body, className ? null : styles.ink, style]}
    >
      {segments.map((seg, i) => {
        if (seg.type === "mention") {
          return (
            <Text
              key={i}
              style={styles.emphasis}
              accessibilityRole="link"
              onPress={() => router.push(`/user/${seg.value}`)}
            >
              @{seg.value}
            </Text>
          );
        }
        if (seg.type === "hashtag") {
          return (
            <Text key={i} style={styles.emphasis}>
              #{seg.value}
            </Text>
          );
        }
        if (seg.type === "link") {
          return (
            <Text
              key={i}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => Linking.openURL(seg.value)}
            >
              {seg.value}
            </Text>
          );
        }
        return <Text key={i}>{seg.value}</Text>;
      })}
    </Text>
  );
};

const styles = StyleSheet.create({
  body: {
    fontFamily: type.body,
  },
  ink: {
    color: color.text,
  },
  emphasis: {
    fontFamily: type.bodyMedium,
  },
  link: {
    textDecorationLine: "underline",
  },
});

export default RenderUserContent;

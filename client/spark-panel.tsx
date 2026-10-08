import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import type { StudioPreferences } from "../shared/preferences";
import { isQuickModel, readSparkModels, runSpark, type SparkInput, type SparkLook } from "../shared/spark";
import type { StudioTheme } from "../shared/theme";
import { PackThumbnail } from "./pack-thumbnail";
import { Eyebrow, StudioChip, StudioLabel } from "./studio-ui";

/** Offline ideas, so Surprise me answers at once and the quick model only has to enrich it. */
const surprises = [
  "Spider-Man, comic ink",
  "Blade Runner 2049 in the rain",
  "Studio Ghibli forest at dusk",
  "Old Macintosh, System 7",
  "Solarpunk rooftop garden",
  "Game Boy on a long car trip",
  "Tokyo vending machines at 3am",
  "Wes Anderson hotel lobby",
  "Deep sea bioluminescence",
  "1970s NASA mission control",
  "Cherry blossom on wet asphalt",
  "Brutalist concrete with one orange door",
  "Vaporwave mall fountain",
  "Risograph zine, two inks",
  "Arctic research station",
  "Desert highway neon motel",
  "Dune, spice and sandstone",
  "Minecraft at sunrise",
  "Italian espresso bar, 1962",
  "Aurora over a black lake",
  "Tron light cycles",
  "Matcha and unbleached paper",
  "Lava lamp in a dark room",
  "Zelda, Hyrule field",
  "Amber terminal in a submarine",
  "Bauhaus primary blocks",
  "Stained glass cathedral",
  "Pink Floyd, dark side of the moon",
];
type Answer = Awaited<ReturnType<ReturnType<typeof useRpc<typeof runSpark.input, typeof runSpark.output>>>>;
// The last answer survives switching tabs while Paseo keeps the plugin loaded.
let remembered: { key: string; answer: Answer } | null = null;
const keyOf = (input: SparkInput) =>
  JSON.stringify([input.subject.trim().toLowerCase(), input.moods, input.appearance]);
const livePauseMs = 1300;

/** A placeholder that breathes while the quick model works. */
function Pulse({ theme, height, delay }: { theme: PluginTheme; height: number; delay: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 0.9, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View style={{ flex: 1, height, borderRadius: 8, backgroundColor: theme.colors.surface2, opacity }} />
  );
}

/** Looks arrive one after another with a small spring, so a new answer is felt. */
function PopIn({ index, children }: { index: number; children: React.ReactNode }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(progress, {
      toValue: 1,
      delay: index * 90,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View
      style={{
        flex: 1,
        minWidth: 0,
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Instant help from a small, fast model the user picks: it finishes the idea,
 * suggests where to push it, and paints three looks that apply with one tap.
 */
export function SparkPanel({
  theme,
  input,
  base,
  busy,
  preferences,
  appliedColors,
  onSavePreferences,
  onSubject,
  onMood,
  onApplyLook,
}: {
  theme: PluginTheme;
  input: SparkInput;
  /** The draft, whose shape and type the look previews borrow. */
  base: StudioTheme;
  busy: boolean;
  preferences: StudioPreferences | undefined;
  /** The draft's palette as JSON, to mark the look that is applied. */
  appliedColors: string;
  onSavePreferences: (patch: Partial<StudioPreferences>) => void;
  onSubject: (subject: string) => void;
  onMood: (mood: string) => void;
  onApplyLook: (look: SparkLook, subject: string) => void;
}) {
  const c = theme.colors;
  const readModels = useRpc(readSparkModels);
  const run = useRpc(runSpark);
  const models = useQuery({
    queryKey: ["theme-studio-spark-models"],
    queryFn: () => readModels({}),
    staleTime: 300000,
  });
  const [answer, setAnswer] = useState<Answer | null>(remembered?.answer ?? null);
  const asked = useRef<string | null>(remembered?.key ?? null);
  const [picking, setPicking] = useState(false);
  const live = preferences?.sparkLive !== false;
  const spark = useMutation({
    mutationFn: run,
    onSuccess: (value, variables) => {
      remembered = { key: keyOf(variables), answer: value };
      setAnswer(value);
    },
  });
  function ask(next: SparkInput) {
    asked.current = keyOf(next);
    spark.mutate(next);
  }
  // Live: answer on its own once the user pauses on an idea it has not seen.
  useEffect(() => {
    if (!live || spark.isPending || input.subject.trim().length < 3 || keyOf(input) === asked.current) return;
    const timer = setTimeout(() => ask(input), livePauseMs);
    return () => clearTimeout(timer);
  }, [live, spark.isPending, input.subject, input.moods.join("|"), input.appearance]);

  const chosen =
    preferences?.sparkProvider && preferences.sparkModel
      ? { provider: preferences.sparkProvider, model: preferences.sparkModel }
      : (models.data?.suggested ?? null);
  const chosenLabel =
    models.data?.providers.find(item => item.id === chosen?.provider)?.models.find(item => item.id === chosen?.model)
      ?.label ??
    chosen?.model ??
    (models.isPending ? "Finding a model…" : "No model");
  const stale = Boolean(answer) && keyOf(input) !== asked.current;
  const subject = input.subject.trim();

  function surprise() {
    const pool = surprises.filter(item => item !== subject);
    const idea = pool[Math.floor(Math.random() * pool.length)];
    onSubject(idea);
    ask({ ...input, subject: idea });
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <StudioChip theme={theme} label="Surprise me" icon="Dices" disabled={spark.isPending} onPress={surprise} />
        <StudioChip
          theme={theme}
          label={spark.isPending ? "Sparking…" : "Spark it"}
          icon="Sparkles"
          disabled={spark.isPending || !chosen}
          onPress={() => ask(input)}
        />
        <StudioChip
          theme={theme}
          label="Live"
          icon={live ? "Zap" : "ZapOff"}
          selected={live}
          onPress={() => onSavePreferences({ sparkLive: !live })}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Quick model: ${chosenLabel}. Change`}
          onPress={() => setPicking(true)}
          hitSlop={6}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" }}
        >
          <Eyebrow theme={theme}>{chosenLabel}</Eyebrow>
          <Icon name="ChevronDown" size={12} color={c.foregroundMuted} />
        </Pressable>
      </View>

      {spark.isPending ? (
        <View style={{ gap: 8 }} accessibilityLabel={`${chosenLabel} is thinking`}>
          <View style={{ flexDirection: "row" }}>
            <Pulse theme={theme} height={34} delay={0} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {[0, 1, 2].map(index => (
              <Pulse key={index} theme={theme} height={70} delay={index * 140} />
            ))}
          </View>
        </View>
      ) : spark.error ? (
        <Text accessibilityRole="alert" style={{ color: c.statusDanger, fontSize: 12, lineHeight: 18 }}>
          {spark.error instanceof Error ? spark.error.message : String(spark.error)}
        </Text>
      ) : answer ? (
        <View style={{ gap: 10, opacity: stale ? 0.55 : 1 }}>
          {answer.enhanced && answer.enhanced !== subject ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use this idea: ${answer.enhanced}`}
              onPress={() => onSubject(answer.enhanced)}
              style={({ pressed }) => ({
                flexDirection: "row",
                gap: 8,
                padding: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: c.border,
                backgroundColor: pressed ? c.surface2 : "transparent",
              })}
            >
              <Icon name="WandSparkles" size={14} color={c.accent} />
              <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12, lineHeight: 18, fontStyle: "italic" }}>
                {answer.enhanced}
              </Text>
              <Eyebrow theme={theme} color={c.accent}>
                Use
              </Eyebrow>
            </Pressable>
          ) : null}
          {answer.nudges.length || answer.moods.some(mood => !input.moods.includes(mood)) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {answer.nudges.map(nudge => (
                <StudioChip
                  key={nudge}
                  theme={theme}
                  label={nudge}
                  icon="Plus"
                  onPress={() => onSubject(subject ? `${subject.replace(/[.,;\s]+$/, "")}, ${nudge}` : nudge)}
                />
              ))}
              {answer.moods
                .filter(mood => !input.moods.includes(mood))
                .map(mood => (
                  <StudioChip key={mood} theme={theme} label={mood} icon="Sparkle" onPress={() => onMood(mood)} />
                ))}
            </View>
          ) : null}
          {answer.looks.length ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {answer.looks.slice(0, 3).map((look, index) => {
                const applied = JSON.stringify(look.colors) === appliedColors;
                return (
                  <PopIn key={`${asked.current}-${index}`} index={index}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Apply the ${look.name} look`}
                      accessibilityState={{ selected: applied, disabled: busy }}
                      disabled={busy}
                      onPress={() => onApplyLook(look, answer.subject || subject)}
                      style={({ pressed }) => ({
                        borderRadius: 9,
                        borderWidth: applied ? 1.5 : 1,
                        borderColor: applied ? c.accent : c.border,
                        overflow: "hidden",
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      })}
                    >
                      <PackThumbnail pack={{ ...base, appearance: look.appearance, colors: look.colors }} height={62} />
                      <View
                        style={{ paddingHorizontal: 7, paddingVertical: 5, borderTopWidth: 1, borderColor: c.border }}
                      >
                        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11 }}>
                          {look.name}
                        </Text>
                      </View>
                    </Pressable>
                  </PopIn>
                );
              })}
            </View>
          ) : null}
          <Eyebrow theme={theme}>
            {answer.model} · {(answer.milliseconds / 1000).toFixed(1)} s
            {answer.looks.length ? " · tap a look to try it" : ""}
          </Eyebrow>
        </View>
      ) : (
        <StudioLabel theme={theme} subdued>
          {live
            ? "Type an idea and pause: a quick model finishes it and paints three looks."
            : "Press Spark it for a finished idea and three looks from a quick model."}
        </StudioLabel>
      )}

      <Modal
        title="Quick model"
        icon={<Icon name="Zap" size={18} color={c.foreground} />}
        open={picking}
        onOpenChange={open => {
          if (!open) setPicking(false);
        }}
      >
        <Modal.Content>
          <StudioLabel theme={theme} subdued>
            Used for instant ideas and looks. Each answer is one short turn on that provider, so a small model keeps it
            fast and cheap. The designer keeps its own model.
          </StudioLabel>
          {models.data?.providers.map(provider => (
            <View key={provider.id} style={{ gap: 4 }}>
              <Eyebrow theme={theme}>{provider.id}</Eyebrow>
              {[...provider.models]
                .sort((a, b) => Number(isQuickModel(b)) - Number(isQuickModel(a)))
                .map(model => {
                  const selected = chosen?.provider === provider.id && chosen.model === model.id;
                  return (
                    <Pressable
                      key={model.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${model.label}`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        onSavePreferences({ sparkProvider: provider.id, sparkModel: model.id });
                        setPicking(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: selected ? c.accent : "transparent",
                        backgroundColor: selected || pressed ? c.surface2 : "transparent",
                      })}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13 }}>
                          {model.label}
                        </Text>
                        {model.description ? (
                          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>
                            {model.description}
                          </Text>
                        ) : null}
                      </View>
                      {isQuickModel(model) ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Icon name="Zap" size={11} color={c.accent} />
                          <Eyebrow theme={theme} color={c.accent}>
                            Fast
                          </Eyebrow>
                        </View>
                      ) : null}
                      {selected ? <Icon name="Check" size={14} color={c.accent} /> : null}
                    </Pressable>
                  );
                })}
            </View>
          ))}
          {!models.data?.providers.length ? (
            <StudioLabel theme={theme} subdued>
              {models.isPending ? "Looking for models…" : "No provider is available on this host."}
            </StudioLabel>
          ) : null}
        </Modal.Content>
      </Modal>
    </View>
  );
}

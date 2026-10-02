import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { hexSchema } from "../shared/theme";
import { hexToHsv, hsvToHex, type HsvColor } from "./studio-color";
import { StudioButton, StudioLabel } from "./studio-ui";

function ColorSlider({ theme, name, value, max, unit, colors, disabled, onChange }: {
  theme: PluginTheme; name: string; value: number; max: number; unit: string; colors: string[];
  disabled: boolean; onChange: (value: number) => void;
}) {
  const width = useRef(1), initial = useRef(0), change = useRef(onChange), blocked = useRef(disabled);
  change.current = onChange; blocked.current = disabled;
  const clamp = (position: number) => Math.max(0, Math.min(1, position));
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !blocked.current,
    onMoveShouldSetPanResponder: (_, gesture) => !blocked.current && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: event => { initial.current = clamp(event.nativeEvent.locationX / width.current); change.current(initial.current * max); },
    onPanResponderMove: (_, gesture) => { if (!blocked.current) change.current(clamp(initial.current + gesture.dx / width.current) * max); },
    onPanResponderTerminationRequest: () => false,
  }), [max]);
  return <View style={{ gap: 6, opacity: disabled ? 0.5 : 1 }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>{name}</Text>
      <StudioLabel theme={theme} subdued>{Math.round(value)}{unit}</StudioLabel>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${name.toLowerCase()}`} disabled={disabled} onPress={() => onChange(Math.max(0, value - max / 100))} style={{ padding: 7 }}>
        <Icon name="Minus" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
      <View {...responder.panHandlers} accessibilityRole="adjustable" accessibilityLabel={name}
        accessibilityValue={{ min: 0, max, now: Math.round(value), text: `${Math.round(value)}${unit}` }}
        accessibilityActions={[{ name: "increment", label: `Increase ${name}` }, { name: "decrement", label: `Decrease ${name}` }]}
        onAccessibilityAction={event => { if (!disabled) onChange(Math.min(max, Math.max(0, value + (event.nativeEvent.actionName === "increment" ? 1 : -1) * max / 100))); }}
        onLayout={event => { width.current = event.nativeEvent.layout.width; }}
        style={{ flex: 1, height: 34, justifyContent: "center" }}>
        <View pointerEvents="none" style={{ height: 13, flexDirection: "row", borderRadius: 7, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
          {colors.map((color, index) => <View key={index} style={{ flex: 1, backgroundColor: color }} />)}
        </View>
        <View pointerEvents="none" style={{ position: "absolute", left: `${value / max * 100}%`, marginLeft: -8, width: 16, height: 23,
          borderRadius: 6, borderWidth: 3, borderColor: theme.colors.foreground, backgroundColor: "transparent" }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${name.toLowerCase()}`} disabled={disabled} onPress={() => onChange(Math.min(max, value + max / 100))} style={{ padding: 7 }}>
        <Icon name="Plus" size={14} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  </View>;
}

export function StudioColorPicker({ theme, label, value, open, locked, busy, changed, onOpenChange, onApply }: {
  theme: PluginTheme; label: string; value: string; open: boolean; locked: boolean; busy: boolean; changed: boolean;
  onOpenChange: (open: boolean) => void; onApply: (color: string) => Promise<void>;
}) {
  const [color, setColor] = useState<HsvColor>(() => hexToHsv(value));
  const [original, setOriginal] = useState(value);
  const [hex, setHex] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setColor(hexToHsv(value)); setHex(value); setOriginal(value); setError(null); } }, [open]);
  const valid = hexSchema.safeParse(hex.trim()).success;
  const displayColor = hsvToHex(color);
  const stops = (field: keyof HsvColor, maximum: number) => Array.from({ length: 32 }, (_, index) => hsvToHex({ ...color, [field]: index / 31 * maximum, ...(field === "hue" ? { saturation: 100, brightness: 100, opacity: 100 } : { opacity: field === "opacity" ? index / 31 * 100 : 100 }) }));
  function setChannel(field: keyof HsvColor, next: number) { const nextColor = { ...color, [field]: next }; setColor(nextColor); setHex(hsvToHex(nextColor)); setError(null); }
  async function apply() {
    if (!valid || busy || locked) return;
    try { await onApply(hex.trim().toUpperCase()); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not apply this color."); }
  }
  return <Modal title={`${label} color`} icon={<Icon name="Pipette" size={18} color={theme.colors.foreground} />} open={open} onOpenChange={onOpenChange}>
    <Modal.Content>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {[{ title: "Before", color: original }, { title: "New color", color: displayColor }].map(item => <View key={item.title} style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 76, backgroundColor: item.color, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border }} />
          <StudioLabel theme={theme} subdued>{item.title}</StudioLabel>
        </View>)}
      </View>
      <ColorSlider theme={theme} name="Hue" value={color.hue} max={360} unit="°" colors={stops("hue", 360)} disabled={busy || locked} onChange={value => setChannel("hue", value)} />
      <ColorSlider theme={theme} name="Saturation" value={color.saturation} max={100} unit="%" colors={stops("saturation", 100)} disabled={busy || locked} onChange={value => setChannel("saturation", value)} />
      <ColorSlider theme={theme} name="Brightness" value={color.brightness} max={100} unit="%" colors={stops("brightness", 100)} disabled={busy || locked} onChange={value => setChannel("brightness", value)} />
      <ColorSlider theme={theme} name="Opacity" value={color.opacity} max={100} unit="%" colors={stops("opacity", 100)} disabled={busy || locked} onChange={value => setChannel("opacity", value)} />
      <View style={{ gap: 6 }}>
        <StudioLabel theme={theme}>Hex color</StudioLabel>
        <TextInput accessibilityLabel={`${label} picker hex color`} value={hex} maxLength={9} autoCorrect={false} autoCapitalize="characters" editable={!busy && !locked}
          onChangeText={next => { setHex(next); const parsed = hexSchema.safeParse(next.trim()); if (parsed.success) { setColor(hexToHsv(parsed.data)); setError(null); } }}
          style={{ color: theme.colors.foreground, fontFamily: "monospace", backgroundColor: theme.colors.surface0, borderWidth: 1, borderColor: valid ? theme.colors.border : theme.colors.statusWarning,
            borderRadius: 8, padding: 11, fontSize: 13 }} />
        <StudioLabel theme={theme} subdued>{valid ? "Alpha is included as the final two hex digits when opacity is below 100%." : "Use #RGB, #RRGGBB, or #RRGGBBAA."}</StudioLabel>
      </View>
      {changed ? <StudioLabel theme={theme} subdued>The palette changed while this picker was open. Close and reopen it before applying.</StudioLabel> : null}
      {locked ? <StudioLabel theme={theme} subdued>This color is now locked. Close the picker and unlock it to edit.</StudioLabel> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <StudioButton theme={theme} title="Cancel" disabled={busy} onPress={() => onOpenChange(false)} />
        <StudioButton theme={theme} title={busy ? "Applying…" : "Apply color"} primary icon="Check" disabled={busy || locked || !valid || changed} onPress={() => { void apply(); }} />
      </View>
    </Modal.Content>
  </Modal>;
}

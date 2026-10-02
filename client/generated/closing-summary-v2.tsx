import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { ExternalLink } from '@getpaseo/plugin/client/ui';
import type { ComponentProps } from '../../shared/components';

// Resumen de cierre: tarjeta que el agente publica al terminar una tarea que tocó archivos.
// State (todo opcional, datos reales; nunca inventar):
//   task, summary, branch, commit, prUrl, result, processing, userNotes
//   files: [{path, status:'added'|'modified'|'deleted'|'renamed', additions?, deletions?}]
//   changes: string[]            · qué cambió, una línea por punto
//   checks: [{label, status:'pass'|'fail'|'skip'|'running', detail?}]
//   pending: string[]            · lo que quedó sin hacer
//   status: 'uncommitted'|'committed'|'pushed'|'pr-open'|'failed' (o texto libre)
// Compatibilidad v1: filesChanged/changes/checks/pending como texto también se muestran.
// Acciones: closing-review-diff · closing-commit · closing-open-pr · closing-continue.

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
type FileRow = { path: string; status: string; additions: number | null; deletions: number | null };
type Check = { label: string; status: string; detail: string };

const fallback = {
  surface0: '#0F1115', surface1: '#16191F', surface2: '#1E222A', border: '#2A2F38',
  foreground: '#E8EAED', foregroundMuted: '#9AA0A8', accent: '#7C9CFF', accentForeground: '#0B0D12',
  statusSuccess: '#3FB950', statusWarning: '#D29922', statusDanger: '#F85149',
};

const policy = {
  ownership: 'La instancia pertenece al agente que hizo la tarea. Interpretar la acción dentro de su propia tarea y repositorio; nunca derivarla al diseñador.',
  instance: 'Leer read_component_instance antes de actuar. Al empezar poner processing:true; al terminar processing:false. Actualizar la misma instanceId con el estado completo y su revisión INSTANCE; conservar userNotes. Ante conflicto, releer y combinar. No publicar ni disparar otra tarjeta por esta interacción.',
  results: 'Escribir en result, status, branch, commit y prUrl solo lo comprobado. No inventar commits, hashes, URLs ni resultados de tests.',
};
const behavior: Record<string, string> = {
  'closing-review-diff': 'Mostrar en el chat el diff de los archivos de la tarea (solo lectura) con un resumen breve. No modificar archivos.',
  'closing-commit': 'El clic autoriza commitear. Si está en la rama por defecto, crear antes una rama descriptiva. Agregar solo los archivos de esta tarea (nunca secretos ni ajenos), usar userNotes como mensaje si existe, respetar atribución y reglas del repo. No hacer push. Si no hay repo git, informarlo en result.',
  'closing-open-pr': 'El clic autoriza commit, push de una rama de trabajo y abrir el PR con gh. Nunca pushear a la rama por defecto. Usar userNotes para título/descripción si existe y respetar la atribución. Guardar la URL real en prUrl. Sin remoto de GitHub o gh sin autenticar: informarlo en result.',
  'closing-continue': 'Continuar con los puntos de pending según userNotes, con permisos normales, y actualizar files, changes, checks, pending y result. Si no hay pendientes, indicarlo en result.',
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const lines = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  if (!s || /^(no disponible|nada pendiente|—|-)$/i.test(s)) return [];
  return s.split(/\n+/).map(x => x.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
};
const tint = (hex: string, alpha: number) =>
  /^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(alpha * 255).toString(16).padStart(2, '0') : hex;

const statusInfo = (raw: string): { label: string; tone: Tone } => {
  const s = raw.toLowerCase();
  if (!s || s === 'uncommitted' || s.startsWith('sin commit')) return { label: 'Sin commit', tone: 'warning' };
  if (s === 'committed' || s.startsWith('commit')) return { label: 'Commiteado', tone: 'success' };
  if (s === 'pushed') return { label: 'Pusheado', tone: 'success' };
  if (s === 'pr-open' || s.includes('pr ')) return { label: 'PR abierto', tone: 'accent' };
  if (s === 'failed' || s.includes('fall')) return { label: 'Con errores', tone: 'danger' };
  return { label: raw.length > 28 ? raw.slice(0, 27) + '…' : raw, tone: 'neutral' };
};
const fileMark: Record<string, { letter: string; tone: Tone; label: string }> = {
  added: { letter: 'A', tone: 'success', label: 'nuevo' },
  modified: { letter: 'M', tone: 'warning', label: 'modificado' },
  deleted: { letter: 'D', tone: 'danger', label: 'eliminado' },
  renamed: { letter: 'R', tone: 'accent', label: 'renombrado' },
};
const checkMark: Record<string, { icon: string; tone: Tone }> = {
  pass: { icon: '✓', tone: 'success' }, fail: { icon: '✕', tone: 'danger' },
  skip: { icon: '–', tone: 'neutral' }, running: { icon: '•', tone: 'accent' },
};

export default function ClosingSummary({ theme, state, onAction }: ComponentProps) {
  const raw = (theme && typeof theme === 'object' && 'colors' in theme ? theme.colors : {}) as Record<string, unknown>;
  const pick = (k: keyof typeof fallback) => (typeof raw[k] === 'string' ? (raw[k] as string) : fallback[k]);
  const C = {
    s0: pick('surface0'), s1: pick('surface1'), s2: pick('surface2'), border: pick('border'),
    fg: pick('foreground'), muted: pick('foregroundMuted'), accent: pick('accent'), onAccent: pick('accentForeground'),
    success: pick('statusSuccess'), warning: pick('statusWarning'), danger: pick('statusDanger'),
  };
  const toneColor = (t: Tone) =>
    t === 'success' ? C.success : t === 'warning' ? C.warning : t === 'danger' ? C.danger : t === 'accent' ? C.accent : C.muted;

  const task = str(state.task) || 'Tarea completada';
  const summary = str(state.summary);
  const branch = str(state.branch);
  const commit = str(state.commit);
  const prUrl = str(state.prUrl);
  const result = str(state.result).replace(/^—$/, '');
  const notes = typeof state.userNotes === 'string' ? state.userNotes : '';
  const processing = state.processing === true;
  const st = statusInfo(str(state.status));

  const files: FileRow[] = Array.isArray(state.files)
    ? state.files.flatMap(f => {
        if (!f || typeof f !== 'object' || Array.isArray(f)) return [];
        const o = f as Record<string, unknown>;
        const path = str(o.path);
        return path ? [{ path, status: str(o.status) || 'modified', additions: num(o.additions), deletions: num(o.deletions) }] : [];
      })
    : [];
  const filesText = files.length ? '' : str(state.filesChanged);
  const changes = lines(state.changes);
  const pending = lines(state.pending);
  const checks: Check[] = Array.isArray(state.checks)
    ? state.checks.flatMap(c => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) return [];
        const o = c as Record<string, unknown>;
        const label = str(o.label);
        return label ? [{ label, status: str(o.status) || 'skip', detail: str(o.detail) }] : [];
      })
    : [];
  const checksText = checks.length ? '' : str(state.checks);

  const adds = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const hasLineStats = files.some(f => f.additions !== null || f.deletions !== null);
  const failing = checks.filter(c => c.status === 'fail').length;
  const passing = checks.filter(c => c.status === 'pass').length;
  const headTone: Tone = failing ? 'danger' : pending.length ? 'warning' : 'success';
  const headLabel = failing ? 'TAREA CON FALLOS' : pending.length ? 'TAREA CON PENDIENTES' : 'TAREA COMPLETADA';

  const emit = (action: string) => {
    if (processing) return;
    onAction({ action, value: { intent: action, userNotes: notes, policy, behavior: behavior[action] ?? '' }, patch: { processing: true } });
  };

  const Pill = ({ label, tone }: { label: string; tone: Tone }) => (
    <View style={[S.pill, { backgroundColor: tint(toneColor(tone), 0.14), borderColor: tint(toneColor(tone), 0.35) }]}>
      <View style={[S.pillDot, { backgroundColor: toneColor(tone) }]} />
      <Text style={[S.pillText, { color: toneColor(tone) }]}>{label}</Text>
    </View>
  );
  const SectionTitle = ({ label, count }: { label: string; count?: number }) => (
    <View style={S.sectionHead}>
      <Text style={[S.sectionTitle, { color: C.muted }]}>{label}</Text>
      {count !== undefined && <Text style={[S.sectionCount, { color: C.muted, backgroundColor: C.s2 }]}>{count}</Text>}
    </View>
  );

  return (
    <View style={[S.root, { backgroundColor: C.s1, borderColor: C.border }]}>
      <View style={[S.rail, { backgroundColor: toneColor(headTone) }]} />

      {/* Header */}
      <View style={S.header}>
        <View style={S.headMain}>
          <View style={S.eyebrowRow}>
            <View style={[S.glow, { backgroundColor: tint(toneColor(headTone), 0.22) }]}>
              <View style={[S.dot, { backgroundColor: toneColor(headTone) }]} />
            </View>
            <Text style={[S.eyebrow, { color: toneColor(headTone) }]}>{headLabel}</Text>
          </View>
          <Text style={[S.title, { color: C.fg }]}>{task}</Text>
          {!!summary && <Text style={[S.summary, { color: C.muted }]}>{summary}</Text>}
        </View>
        <Pill label={st.label} tone={st.tone} />
      </View>

      {/* Métricas */}
      <View style={[S.metrics, { borderColor: C.border, backgroundColor: C.s0 }]}>
        <View style={S.metric}>
          <Text style={[S.metricValue, { color: C.fg }]}>{files.length || '—'}</Text>
          <Text style={[S.metricLabel, { color: C.muted }]}>archivos</Text>
        </View>
        <View style={[S.metricSep, { backgroundColor: C.border }]} />
        <View style={S.metric}>
          {hasLineStats ? (
            <Text style={S.metricValue}>
              <Text style={{ color: C.success }}>+{adds}</Text>
              <Text style={{ color: C.muted }}> </Text>
              <Text style={{ color: C.danger }}>−{dels}</Text>
            </Text>
          ) : (
            <Text style={[S.metricValue, { color: C.fg }]}>—</Text>
          )}
          <Text style={[S.metricLabel, { color: C.muted }]}>líneas</Text>
        </View>
        <View style={[S.metricSep, { backgroundColor: C.border }]} />
        <View style={S.metric}>
          <Text style={[S.metricValue, { color: checks.length ? (failing ? C.danger : C.success) : C.fg }]}>
            {checks.length ? `${passing}/${checks.length}` : '—'}
          </Text>
          <Text style={[S.metricLabel, { color: C.muted }]}>checks</Text>
        </View>
      </View>

      {(branch || commit) && (
        <View style={S.gitRow}>
          {!!branch && <Text style={[S.mono, S.gitChip, { color: C.fg, backgroundColor: C.s2, borderColor: C.border }]}>⎇ {branch}</Text>}
          {!!commit && <Text style={[S.mono, S.gitChip, { color: C.muted, backgroundColor: C.s2, borderColor: C.border }]}>{commit.slice(0, 7)}</Text>}
          {!!prUrl && (
            <ExternalLink href={prUrl} accessibilityLabel="Abrir pull request">
              <Text style={[S.gitLink, { color: C.accent }]}>Ver PR ↗</Text>
            </ExternalLink>
          )}
        </View>
      )}

      {/* Archivos */}
      {(files.length > 0 || !!filesText) && (
        <View style={S.section}>
          <SectionTitle label="ARCHIVOS" count={files.length || undefined} />
          {files.length > 0 ? (
            <View style={[S.fileList, { borderColor: C.border, backgroundColor: C.s0 }]}>
              {files.map((f, i) => {
                const m = fileMark[f.status] ?? fileMark.modified;
                const cut = f.path.lastIndexOf('/');
                const dir = cut >= 0 ? f.path.slice(0, cut + 1) : '';
                const base = cut >= 0 ? f.path.slice(cut + 1) : f.path;
                return (
                  <View key={f.path + i} style={[S.fileRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}>
                    <View accessibilityLabel={m.label} style={[S.fileBadge, { backgroundColor: tint(toneColor(m.tone), 0.16) }]}>
                      <Text style={[S.fileBadgeText, { color: toneColor(m.tone) }]}>{m.letter}</Text>
                    </View>
                    <Text numberOfLines={1} style={[S.mono, S.filePath]}>
                      <Text style={{ color: C.muted }}>{dir}</Text>
                      <Text style={{ color: f.status === 'deleted' ? C.muted : C.fg, textDecorationLine: f.status === 'deleted' ? 'line-through' : 'none' }}>{base}</Text>
                    </Text>
                    {(f.additions !== null || f.deletions !== null) && (
                      <Text style={[S.mono, S.fileStat]}>
                        {f.additions !== null && <Text style={{ color: C.success }}>+{f.additions} </Text>}
                        {f.deletions !== null && <Text style={{ color: C.danger }}>−{f.deletions}</Text>}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[S.body, { color: C.fg }]}>{filesText}</Text>
          )}
        </View>
      )}

      {/* Qué cambió */}
      {changes.length > 0 && (
        <View style={S.section}>
          <SectionTitle label="QUÉ CAMBIÓ" />
          {changes.map((c, i) => (
            <View key={i} style={S.bulletRow}>
              <View style={[S.bullet, { backgroundColor: C.accent }]} />
              <Text style={[S.body, S.flex, { color: C.fg }]}>{c}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Checks */}
      {(checks.length > 0 || !!checksText) && (
        <View style={S.section}>
          <SectionTitle label="TESTS Y BUILD" />
          {checks.length > 0 ? (
            <View style={S.checkWrap}>
              {checks.map((c, i) => {
                const m = checkMark[c.status] ?? checkMark.skip;
                return (
                  <View key={c.label + i} style={[S.checkChip, { borderColor: tint(toneColor(m.tone), 0.4), backgroundColor: tint(toneColor(m.tone), 0.1) }]}>
                    <Text style={[S.checkIcon, { color: toneColor(m.tone) }]}>{m.icon}</Text>
                    <Text style={[S.checkLabel, { color: C.fg }]}>{c.label}</Text>
                    {!!c.detail && <Text style={[S.checkDetail, { color: C.muted }]}>{c.detail}</Text>}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[S.body, { color: C.fg }]}>{checksText}</Text>
          )}
        </View>
      )}

      {/* Pendiente */}
      {pending.length > 0 && (
        <View style={[S.callout, { backgroundColor: tint(C.warning, 0.08), borderColor: tint(C.warning, 0.3) }]}>
          <Text style={[S.calloutTitle, { color: C.warning }]}>Pendiente · {pending.length}</Text>
          {pending.map((p, i) => (
            <View key={i} style={S.bulletRow}>
              <Text style={[S.pendingBox, { color: C.warning }]}>○</Text>
              <Text style={[S.body, S.flex, { color: C.fg }]}>{p}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Resultado / trabajando */}
      {(processing || !!result) && (
        <View style={[S.result, { backgroundColor: C.s2, borderColor: C.border }]}>
          {processing ? (
            <View style={S.resultRow}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={[S.body, S.flex, { color: C.muted, marginLeft: 10 }]}>El agente está trabajando…</Text>
            </View>
          ) : (
            <Text accessibilityLiveRegion="polite" style={[S.body, { color: C.fg }]}>{result}</Text>
          )}
        </View>
      )}

      {/* Notas */}
      <TextInput
        accessibilityLabel="Notas para el agente"
        multiline
        value={notes}
        onChangeText={text => onAction({ action: '__state__', patch: { userNotes: text } })}
        placeholder="Mensaje de commit, título del PR o qué hacer con lo pendiente…"
        placeholderTextColor={C.muted}
        selectionColor={C.accent}
        style={[S.input, { backgroundColor: C.s0, borderColor: C.border, color: C.fg }]}
      />

      {/* Acciones */}
      <View style={S.actions}>
        <Pressable
          accessibilityRole="button" disabled={processing} accessibilityState={{ disabled: processing }}
          onPress={() => emit('closing-commit')}
          style={({ pressed }) => [S.btn, S.primary, { backgroundColor: C.accent, opacity: processing ? 0.5 : pressed ? 0.85 : 1 }]}>
          <Text style={[S.btnText, { color: C.onAccent }]}>Commit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button" disabled={processing} accessibilityState={{ disabled: processing }}
          onPress={() => emit('closing-open-pr')}
          style={({ pressed }) => [S.btn, { backgroundColor: C.s2, borderColor: C.border, borderWidth: 1, opacity: processing ? 0.5 : pressed ? 0.8 : 1 }]}>
          <Text style={[S.btnText, { color: C.fg }]}>Abrir PR</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button" disabled={processing} accessibilityState={{ disabled: processing }}
          onPress={() => emit('closing-review-diff')}
          style={({ pressed }) => [S.btn, { opacity: processing ? 0.5 : pressed ? 0.7 : 1 }]}>
          <Text style={[S.btnText, { color: C.muted }]}>Ver diff</Text>
        </Pressable>
        {pending.length > 0 && (
          <Pressable
            accessibilityRole="button" disabled={processing} accessibilityState={{ disabled: processing }}
            onPress={() => emit('closing-continue')}
            style={({ pressed }) => [S.btn, S.pushRight, { opacity: processing ? 0.5 : pressed ? 0.7 : 1 }]}>
            <Text style={[S.btnText, { color: C.warning }]}>Seguir con lo pendiente →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root: { width: '100%', borderWidth: 1, borderRadius: 12, paddingVertical: 16, paddingLeft: 20, paddingRight: 16, overflow: 'hidden' },
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  headMain: { flex: 1, minWidth: 200 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  glow: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 7 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  title: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  summary: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 11, fontWeight: '600' },
  metrics: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingVertical: 10, marginBottom: 12 },
  metric: { flex: 1, alignItems: 'center' },
  metricSep: { width: 1, alignSelf: 'stretch' },
  metricValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 10, letterSpacing: 0.6, marginTop: 2 },
  gitRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  gitChip: { fontSize: 11, borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  gitLink: { fontSize: 12, fontWeight: '600', marginLeft: 4 },
  section: { marginBottom: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  sectionCount: { fontSize: 10, fontWeight: '600', marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
  fileList: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  fileBadge: { width: 18, height: 18, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  fileBadgeText: { fontSize: 10, fontWeight: '800' },
  filePath: { flex: 1, fontSize: 12 },
  fileStat: { fontSize: 11, marginLeft: 8 },
  mono: { fontFamily: 'monospace' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 7, marginRight: 10 },
  body: { fontSize: 13, lineHeight: 19 },
  flex: { flex: 1 },
  checkWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  checkChip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  checkIcon: { fontSize: 12, fontWeight: '800', marginRight: 6 },
  checkLabel: { fontSize: 12, fontWeight: '600' },
  checkDetail: { fontSize: 11, marginLeft: 6 },
  callout: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 14 },
  calloutTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 8 },
  pendingBox: { fontSize: 12, marginRight: 8, lineHeight: 19 },
  result: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, lineHeight: 19, minHeight: 44, textAlignVertical: 'top', marginBottom: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  btn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  primary: {},
  pushRight: { marginLeft: 'auto' },
  btnText: { fontSize: 13, fontWeight: '600' },
});

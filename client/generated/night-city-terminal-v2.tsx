import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import type { ComponentProps } from '../../shared/components';

// User preference: offer this deck in this conversation when a terminal, debugging,
// scripting, or other "hacky" technical task benefits from an interactive tracker.
// This is a contextual publication preference, not a global automatic trigger.
const C = { bg:'#080D12', panel:'#101B23', control:'#182A33', line:'#397283',
  cyan:'#42DCEE', yellow:'#FCEE0A', text:'#E8F7FA', muted:'#9DB9C2' };
const modes = [
  { value:'terminal', label:'TERMINAL' },
  { value:'debug', label:'DEBUG' },
  { value:'automation', label:'SCRIPT' }
];
const areaNames: Record<string,string> = {
  terminal:'TERMINAL', debug:'DEBUG', automation:'SCRIPT',
  palette:'PALETA', ui:'UI DEL PACK', components:'COMPONENTES'
};
export default function NetrunnerDeck({ state, onAction }: ComponentProps) {
  const objective = typeof state.objective === 'string' ? state.objective : '';
  const status = typeof state.status === 'string' ? state.status : 'Pendiente';
  const area = typeof state.area === 'string' ? state.area : 'terminal';
  const urgent = state.urgent === true;
  const progress = Math.max(0, Math.min(100,
    typeof state.progress === 'number' && Number.isFinite(state.progress) ? state.progress : 0));
  const send = () => onAction({ action:'cyberpunk-start', value:objective });
  return (
    <View style={S.deck}>
      <View pointerEvents="none" style={S.scanLayer}>
        {Array.from({length:24},(_,i)=><View key={i} style={[S.scan,{top:i*26}]} />)}
      </View>
      <View pointerEvents="none" style={S.topCorner} />
      <View pointerEvents="none" style={S.bottomCorner} />
      <View style={S.topbar}>
        <Text style={S.micro}>NIGHT CITY / FIELD SYSTEMS</Text>
        <View style={S.version}><Text style={S.versionText}>DECK 02</Text></View>
      </View>
      <View style={S.hero}>
        <View style={S.mark}><Text style={S.markText}>{'>_'}</Text></View>
        <View style={S.heroText}>
          <Text style={S.eyebrow}>NETRUNNER INTERFACE</Text>
          <Text style={S.title}>GHOST//LINK</Text>
          <Text style={S.subtitle}>Consola táctica para tu próximo desafío técnico.</Text>
        </View>
      </View>
      <View style={S.statusRow}>
        <View style={S.metric}><Text style={S.label}>ESTADO</Text><Text style={S.metricValue}>{status.toUpperCase()}</Text></View>
        <View style={S.metric}><Text style={S.label}>CANAL</Text><Text style={S.metricValue}>{areaNames[area] || area.toUpperCase()}</Text></View>
        <View style={S.metric}><Text style={S.label}>AVANCE MANUAL</Text><Text style={S.percent}>{progress}%</Text></View>
      </View>
      <View style={S.section}>
        <Text style={S.sectionLabel}>01 / PERFIL DEL ENCARGO</Text>
        <View style={S.chips}>
          {modes.map(mode=><Pressable key={mode.value}
            accessibilityRole="button" accessibilityLabel={mode.label}
            accessibilityState={{selected:area===mode.value}}
            onPress={()=>onAction({action:'__state__',patch:{area:mode.value}})}
            style={({pressed})=>[S.chip,area===mode.value && S.chipSelected,pressed && S.pressed]}>
            <Text style={[S.chipText,area===mode.value && S.chipTextSelected]}>{mode.label}</Text>
          </Pressable>)}
        </View>
      </View>
      <View style={S.section}>
        <View style={S.labelRow}>
          <Text style={S.sectionLabel}>02 / OBJETIVO</Text>
          <Text style={S.micro}>INPUT PERSISTENTE</Text>
        </View>
        <View style={S.inputFrame}>
          <Text style={S.prompt}>{'>'}</Text>
          <TextInput accessibilityLabel="Objetivo técnico" multiline
            value={objective} placeholder="Describí el problema, la terminal o el script…"
            placeholderTextColor={C.muted} selectionColor={C.cyan}
            onChangeText={text=>onAction({action:'__state__',patch:{objective:text}})}
            style={S.input} />
        </View>
        <Pressable accessibilityRole="switch" accessibilityLabel="Prioridad alta"
          accessibilityState={{checked:urgent}}
          onPress={()=>onAction({action:'__state__',patch:{urgent:!urgent}})}
          style={S.priority}>
          <View style={[S.switchTrack,urgent && S.switchOn]}>
            <View style={[S.switchThumb,urgent && S.switchThumbOn]} />
          </View>
          <Text style={S.priorityText}>{urgent ? 'PRIORIDAD ALTA' : 'PRIORIDAD NORMAL'}</Text>
        </Pressable>
      </View>
      <View style={S.console}>
        <Text style={S.consoleHeader}>// ESTADO DE LA SESIÓN</Text>
        <Text style={S.consoleLine}><Text style={S.cyan}>{'> canal  '}</Text>{areaNames[area] || area}</Text>
        <Text style={S.consoleLine}><Text style={S.cyan}>{'> estado '}</Text>{status}</Text>
        <Text style={S.consoleLine} numberOfLines={3}><Text style={S.cyan}>{'> tarea  '}</Text>{objective || 'Esperando tu objetivo…'}</Text>
        <Text style={S.consoleLine}><Text style={S.cyan}>{'> avance '}</Text>{progress}% / seguimiento manual</Text>
      </View>
      <View style={S.progressHeader}>
        <Text style={S.sectionLabel}>03 / PROGRESO</Text>
        <Text style={S.micro}>{Math.round(progress/5)}/20 BLOQUES</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel="Avance manual"
        accessibilityValue={{min:0,max:100,now:progress}} style={S.progressTrack}>
        {Array.from({length:20},(_,i)=><View key={i}
          style={[S.progressBlock,i<Math.floor(progress/5) && S.progressFilled]} />)}
      </View>
      <View style={S.actions}>
        <Pressable accessibilityRole="button" disabled={!objective.trim()}
          accessibilityState={{disabled:!objective.trim()}} onPress={send}
          style={({pressed})=>[S.primary,!objective.trim() && S.disabled,pressed && S.pressed]}>
          <Text style={S.primaryText}>ENVIAR AL AGENTE →</Text>
        </Pressable>
        <Pressable accessibilityRole="button"
          onPress={()=>onAction({action:'cyberpunk-advance',value:25})}
          style={({pressed})=>[S.secondary,pressed && S.pressed]}>
          <Text style={S.secondaryText}>+25 %</Text>
        </Pressable>
        <Pressable accessibilityRole="button"
          onPress={()=>onAction({action:'cyberpunk-reset'})}
          style={({pressed})=>[S.secondary,pressed && S.pressed]}>
          <Text style={S.secondaryText}>RESET</Text>
        </Pressable>
      </View>
      <View style={S.footer}>
        <Text style={S.footerText}>GHOST//LINK · INTERACCIÓN CON EL AGENTE</Text>
        <Text style={S.footerText}>NC-2077</Text>
      </View>
    </View>
  );
}
const S = StyleSheet.create({
  deck:{backgroundColor:C.bg,borderWidth:1,borderColor:C.line,padding:20,overflow:'hidden',position:'relative',width:'100%'},
  scanLayer:{position:'absolute',top:0,bottom:0,left:0,right:0},
  scan:{position:'absolute',left:0,right:0,height:1,backgroundColor:C.cyan,opacity:0.07},
  topCorner:{position:'absolute',top:0,right:0,width:34,height:7,backgroundColor:C.yellow},
  bottomCorner:{position:'absolute',bottom:0,left:0,width:48,height:4,backgroundColor:C.cyan},
  topbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:22},
  micro:{fontFamily:'monospace',fontSize:10,color:C.muted,letterSpacing:1,lineHeight:16},
  version:{borderWidth:1,borderColor:C.line,paddingHorizontal:7,paddingVertical:3},
  versionText:{fontFamily:'monospace',fontSize:10,color:C.cyan,letterSpacing:1},
  hero:{flexDirection:'row',alignItems:'center',marginBottom:22},
  mark:{width:54,height:62,borderWidth:2,borderColor:C.yellow,alignItems:'center',justifyContent:'center',marginRight:14},
  markText:{fontFamily:'monospace',fontSize:27,fontWeight:'700',color:C.yellow},
  heroText:{flex:1},
  eyebrow:{fontFamily:'monospace',fontSize:10,color:C.cyan,letterSpacing:2,marginBottom:4},
  title:{fontFamily:'monospace',fontSize:28,fontWeight:'900',color:C.yellow,letterSpacing:-1},
  subtitle:{fontFamily:'monospace',fontSize:11,color:C.muted,lineHeight:18,marginTop:4},
  statusRow:{flexDirection:'row',flexWrap:'wrap',backgroundColor:C.panel,borderTopWidth:1,borderBottomWidth:1,borderColor:C.line,marginBottom:20},
  metric:{flexGrow:1,flexBasis:110,padding:12},
  label:{fontFamily:'monospace',fontSize:10,letterSpacing:1,color:C.muted,marginBottom:7},
  metricValue:{fontFamily:'monospace',fontSize:12,fontWeight:'700',color:C.text},
  percent:{fontFamily:'monospace',fontSize:20,fontWeight:'700',color:C.yellow},
  section:{marginBottom:18},
  sectionLabel:{fontFamily:'monospace',fontSize:11,fontWeight:'700',color:C.cyan,letterSpacing:1,lineHeight:18},
  chips:{flexDirection:'row',flexWrap:'wrap',marginTop:10},
  chip:{borderWidth:1,borderColor:C.line,paddingHorizontal:12,paddingVertical:10,marginRight:8,marginBottom:8,backgroundColor:C.panel},
  chipSelected:{backgroundColor:C.cyan,borderColor:C.cyan},
  chipText:{fontFamily:'monospace',fontSize:11,fontWeight:'700',color:C.muted,letterSpacing:1},
  chipTextSelected:{color:C.bg},
  labelRow:{flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap',marginBottom:9},
  inputFrame:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderLeftWidth:3,borderLeftColor:C.cyan,flexDirection:'row',padding:12},
  prompt:{fontFamily:'monospace',fontSize:18,color:C.cyan,marginRight:10},
  input:{fontFamily:'monospace',fontSize:13,color:C.text,flex:1,minHeight:64,textAlignVertical:'top',padding:0,lineHeight:20},
  priority:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',paddingVertical:10,marginTop:3},
  priorityText:{fontFamily:'monospace',fontSize:11,color:C.text,letterSpacing:1},
  switchTrack:{width:34,height:18,borderWidth:1,borderColor:C.line,backgroundColor:C.control,marginRight:10,padding:3},
  switchOn:{borderColor:C.yellow},
  switchThumb:{width:10,height:10,backgroundColor:C.muted},
  switchThumbOn:{backgroundColor:C.yellow,alignSelf:'flex-end'},
  console:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,padding:14,marginBottom:20},
  consoleHeader:{fontFamily:'monospace',fontSize:10,color:C.yellow,letterSpacing:1,marginBottom:10},
  consoleLine:{fontFamily:'monospace',fontSize:12,color:C.text,lineHeight:21},
  cyan:{color:C.cyan},
  progressHeader:{flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap',marginBottom:8},
  progressTrack:{flexDirection:'row',height:14,marginBottom:20},
  progressBlock:{flex:1,backgroundColor:C.control,marginRight:3},
  progressFilled:{backgroundColor:C.cyan},
  actions:{flexDirection:'row',flexWrap:'wrap',marginBottom:12},
  primary:{flexGrow:1,backgroundColor:C.yellow,paddingHorizontal:15,paddingVertical:14,alignItems:'center',justifyContent:'center',marginRight:8,marginBottom:8},
  primaryText:{fontFamily:'monospace',fontSize:12,fontWeight:'700',color:C.bg,letterSpacing:1},
  secondary:{borderWidth:1,borderColor:C.line,backgroundColor:C.panel,paddingHorizontal:14,paddingVertical:14,justifyContent:'center',marginRight:8,marginBottom:8},
  secondaryText:{fontFamily:'monospace',fontSize:12,fontWeight:'700',color:C.cyan},
  disabled:{backgroundColor:C.muted},
  pressed:{opacity:0.8},
  footer:{borderTopWidth:1,borderColor:C.line,paddingTop:12,flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap'},
  footerText:{fontFamily:'monospace',fontSize:9,color:C.muted,letterSpacing:1,lineHeight:16}
});
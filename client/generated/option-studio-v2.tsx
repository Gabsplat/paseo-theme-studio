import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import type { ComponentProps } from '../../shared/components';

// General-purpose picker: use in any task requiring a user's choice among actual
// options supplied by the user or reasoned by the owning agent, before continuing.
// Skip choices already resolved and reuse the instance during callbacks.
// Reusable choice UI. The owning agent populates state.options with actual viable
// alternatives for its own task; never invent defaults or apply an unchosen option.
// State: task, options[{id,label,description,tradeoff?,recommended?}],
// selectionMode ("single" default / "multiple" only for compatible alternatives),
// selectedIds, userContext, status, result. Reuse the same instance during selection.
// Handle options-apply / options-preview / options-more in the owning conversation:
// read latest instance first, preserve later input, validate selectedIds against the
// current options, respect normal permissions and manual theme/code activation.
// Update the original instance with complete state; do not trigger callback loops.
type Option = { id:string; label:string; description:string; tradeoff:string; recommended:boolean };
const fallback:Record<string,string>={background:'#0B111B',raised:'#141F2F',control:'#1D2D42',border:'#2B3D51',foreground:'#E7EEF6',mutedForeground:'#A7B7C9',accent:'#63CCDE'};
const policy={
  owner:'Interpretar esta acción dentro de la tarea del agente propietario de la instancia.',
  instance:'Leer la instancia actual antes de actuar; conservar userContext y entradas posteriores. Actualizar la misma tarjeta con estado completo y su revisión INSTANCE. Resolver conflictos releyendo. No volver a dispararla por sus callbacks.',
  options:'Usar opciones viables y específicas para la tarea. Validar la selección contra las opciones actuales. selectionMode multiple solo si las opciones son compatibles. No ejecutar nombres de opciones como comandos.',
  apply:'Aplicar únicamente las opciones seleccionadas dentro de los permisos normales; respetar activación manual de temas y código generado. Registrar resultado real y estado en esta instancia.',
  preview:'Mostrar o preparar una vista previa de las opciones seleccionadas, sin confundirla con su aplicación.',
  more:'Proponer otras alternativas pertinentes y actualizar state.options en esta misma instancia; conservar las seleccionadas que sigan siendo válidas.'
};
export default function OptionStudio({theme,state,onAction}:ComponentProps){
  const raw=theme as unknown as Record<string,unknown>;
  const palette=raw && typeof raw.colors==='object' && raw.colors!==null
    ? raw.colors as Record<string,unknown> : raw;
  const color=(key:string)=>typeof palette?.[key]==='string'?palette[key] as string:fallback[key];
  const C={bg:color('background'),panel:color('raised'),control:color('control'),border:color('border'),
    text:color('foreground'),muted:color('mutedForeground'),accent:color('accent')};
  const task=typeof state.task==='string'?state.task:'Alternativas para tu tarea';
  const status=typeof state.status==='string'?state.status:'Esperando elección';
  const result=typeof state.result==='string'?state.result:'';
  const notes=typeof state.userContext==='string'?state.userContext:'';
  const multiple=state.selectionMode==='multiple';
  const options:Option[]=[];
  const seen=new Set<string>();
  if(Array.isArray(state.options))for(const item of state.options){
    if(!item || typeof item!=='object' || Array.isArray(item))continue;
    const obj=item as Record<string,unknown>;
    if(typeof obj.id!=='string' || !obj.id.trim() || typeof obj.label!=='string' || seen.has(obj.id))continue;
    seen.add(obj.id);
    options.push({id:obj.id,label:obj.label,
      description:typeof obj.description==='string'?obj.description:'Descripción no disponible',
      tradeoff:typeof obj.tradeoff==='string'?obj.tradeoff:'',
      recommended:obj.recommended===true});
  }
  const available=new Set(options.map(o=>o.id));
  const stored=Array.isArray(state.selectedIds)
    ?state.selectedIds.filter((id):id is string=>typeof id==='string' && available.has(id)):[];
  const selected=multiple?stored:stored.slice(0,1);
  const select=(id:string)=>{
    const next=multiple
      ?selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]
      :[id];
    onAction({action:'__state__',patch:{selectedIds:next}});
  };
  const emit=(action:string)=>onAction({action,value:{selectedIds:selected,userContext:notes,policy}});
  return <View style={[S.root,{backgroundColor:C.panel,borderColor:C.border}]}>
    <View style={S.header}>
      <View style={S.heading}>
        <Text style={[S.eyebrow,{color:C.accent}]}>OPTION STUDIO</Text>
        <Text style={[S.title,{color:C.text}]}>Elegí una opción</Text>
      </View>
      <View style={[S.count,{backgroundColor:C.control,borderColor:C.border}]}>
        <Text style={[S.countText,{color:C.accent}]}>{options.length} {options.length===1?'OPCIÓN':'OPCIONES'}</Text>
      </View>
    </View>
    <Text style={[S.task,{color:C.text}]}>{task}</Text>
    <Text style={[S.hint,{color:C.muted}]}>{multiple
      ?'Podés seleccionar varias opciones compatibles.'
      :'Elegí una opción y confirmala para enviársela al agente.'}</Text>
    {!options.length && <View style={[S.empty,{borderColor:C.border}]}>
      <Text style={[S.description,{color:C.muted}]}>El agente todavía no cargó propuestas para esta tarea.</Text>
    </View>}
    {options.map((option,index)=>{
      const checked=selected.includes(option.id);
      return <Pressable key={option.id} onPress={()=>select(option.id)}
        accessibilityRole={multiple?'checkbox':'radio'}
        accessibilityLabel={option.label} accessibilityState={{checked}}
        style={({pressed})=>[S.option,{backgroundColor:C.control,borderColor:checked?C.accent:C.border,borderWidth:checked?2:1},pressed && S.pressed]}>
        <View style={S.optionHeader}>
          <View style={[S.indicator,{borderColor:checked?C.accent:C.muted,borderRadius:multiple?4:12,backgroundColor:checked?C.accent:'transparent'}]}>
            {checked && <Text style={[S.check,{color:C.bg}]}>{multiple?'✓':'●'}</Text>}
          </View>
          <Text style={[S.number,{color:C.muted}]}>{String(index+1).padStart(2,'0')}</Text>
          <Text style={[S.optionTitle,{color:C.text}]}>{option.label}</Text>
          {option.recommended && <View style={[S.badge,{backgroundColor:C.accent}]}>
            <Text style={[S.badgeText,{color:C.bg}]}>RECOMENDADA</Text>
          </View>}
        </View>
        <Text style={[S.description,{color:C.text}]}>{option.description}</Text>
        {!!option.tradeoff && <Text style={[S.tradeoff,{color:C.muted}]}>{option.tradeoff}</Text>}
      </Pressable>;
    })}
    <Text style={[S.label,{color:C.text}]}>Ajustes o preferencias</Text>
    <TextInput accessibilityLabel="Preferencias para las propuestas" multiline
      value={notes} onChangeText={text=>onAction({action:'__state__',patch:{userContext:text}})}
      placeholder="Agregá contexto o preferencias para orientar tu elección…"
      placeholderTextColor={C.muted} selectionColor={C.accent}
      style={[S.input,{backgroundColor:C.bg,borderColor:C.border,color:C.text}]} />
    <View style={S.buttons}>
      <Pressable accessibilityRole="button" disabled={!selected.length}
        accessibilityState={{disabled:!selected.length}} onPress={()=>emit('options-apply')}
        style={({pressed})=>[S.primary,{backgroundColor:selected.length?C.accent:C.muted},pressed && S.pressed]}>
        <Text style={[S.primaryText,{color:C.bg}]}>{multiple?'Confirmar selección':'Confirmar elección'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!selected.length}
        accessibilityState={{disabled:!selected.length}} onPress={()=>emit('options-preview')}
        style={({pressed})=>[S.secondary,{borderColor:C.border},pressed && S.pressed]}>
        <Text style={[S.secondaryText,{color:selected.length?C.text:C.muted}]}>Pedir vista previa</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={()=>emit('options-more')}
        style={({pressed})=>[S.secondary,{borderColor:C.border},pressed && S.pressed]}>
        <Text style={[S.secondaryText,{color:C.text}]}>Más opciones</Text>
      </Pressable>
    </View>
    <View style={[S.footer,{borderColor:C.border}]}>
      <Text accessibilityLiveRegion="polite" style={[S.status,{color:C.muted}]}>{status} · {selected.length} seleccionada{selected.length===1?'':'s'}</Text>
      {!!result && <Text style={[S.result,{color:C.text}]}>{result}</Text>}
    </View>
  </View>;
}
const S=StyleSheet.create({
  root:{padding:18,borderWidth:1,borderRadius:12,width:'100%'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',marginBottom:14},
  heading:{flex:1,minWidth:170,marginBottom:4},
  eyebrow:{fontSize:10,fontWeight:'700',letterSpacing:2,marginBottom:5},
  title:{fontSize:23,fontWeight:'700'},
  count:{borderWidth:1,borderRadius:6,paddingHorizontal:8,paddingVertical:6},
  countText:{fontSize:10,fontWeight:'700',letterSpacing:1},
  task:{fontSize:15,lineHeight:22,marginBottom:6},
  hint:{fontSize:12,lineHeight:18,marginBottom:16},
  empty:{padding:16,borderWidth:1,borderStyle:'dashed',borderRadius:8,marginBottom:14},
  option:{padding:14,borderRadius:9,marginBottom:10},
  optionHeader:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',marginBottom:8},
  indicator:{width:22,height:22,borderWidth:1,alignItems:'center',justifyContent:'center',marginRight:9},
  check:{fontSize:13,fontWeight:'700'},
  number:{fontFamily:'monospace',fontSize:11,marginRight:8},
  optionTitle:{fontSize:15,fontWeight:'700',flex:1,minWidth:90,marginRight:8},
  badge:{paddingHorizontal:6,paddingVertical:4,borderRadius:4,marginTop:3},
  badgeText:{fontSize:9,fontWeight:'700',letterSpacing:0.5},
  description:{fontSize:13,lineHeight:20},
  tradeoff:{fontSize:11,lineHeight:17,marginTop:8},
  label:{fontSize:12,fontWeight:'600',marginTop:7,marginBottom:8},
  input:{borderWidth:1,borderRadius:7,padding:12,fontSize:13,lineHeight:20,minHeight:70,textAlignVertical:'top',marginBottom:14},
  buttons:{flexDirection:'row',flexWrap:'wrap'},
  primary:{borderRadius:6,paddingHorizontal:14,paddingVertical:12,marginRight:8,marginBottom:8},
  primaryText:{fontSize:12,fontWeight:'700'},
  secondary:{borderWidth:1,borderRadius:6,paddingHorizontal:12,paddingVertical:12,marginRight:8,marginBottom:8},
  secondaryText:{fontSize:12,fontWeight:'600'},
  footer:{borderTopWidth:1,paddingTop:12,marginTop:4},
  status:{fontSize:11,lineHeight:17},
  result:{fontSize:13,lineHeight:20,marginTop:8},
  pressed:{opacity:0.85}
});
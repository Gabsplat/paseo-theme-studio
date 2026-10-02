import assert from "node:assert/strict";
import { test } from "node:test";
import { componentLibrarySchema } from "../shared/components";
import { componentTriggerCatalog } from "./component-triggers";

test("trigger discovery uses latest versions, enabled rules and activation readiness without leaking source or chat state", () => {
  const rule={id:"context",event:"agent_context",when:"When reviewing a screenshot",enabled:true};
  const library=componentLibrarySchema.parse({format:1,revision:4,definitions:[
    {id:"review",name:"Review",version:1,createdAt:"now",mode:"composition",tree:{type:"text",text:"Old"},triggers:[rule]},
    {id:"review",name:"Review",version:2,createdAt:"now",mode:"composition",tree:{type:"text",text:"New"},triggers:[]},
    {id:"chart",name:"Chart",version:1,createdAt:"now",mode:"code",code:"private source",triggers:[rule,{...rule,id:"disabled",enabled:false}]},
    {id:"ready",name:"Ready",version:1,createdAt:"now",mode:"composition",tree:{type:"text",text:"Ready"},triggers:[rule]},
  ],instances:[],favorites:[],builds:[],activeKeys:[]});
  const catalog=componentTriggerCatalog(library,false);
  assert.equal(catalog.automaticTriggers,false);
  assert.deepEqual(catalog.components.map(component=>[component.componentId,component.available,component.triggers.length]),[["chart",false,1],["ready",true,1]]);
  assert.equal(JSON.stringify(catalog).includes("private source"),false);
  library.activeKeys=["chart@1"];
  assert.equal(componentTriggerCatalog(library,true).components[0].available,true);
});

const DATA=CONFIG;
await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("3:3"));
await Promise.all([{family:"Montserrat",style:"Medium"},{family:"Montserrat",style:"SemiBold"}].map(f=>figma.loadFontAsync(f)));
const nav=await figma.getNodeByIdAsync("3:76"),bg=await figma.variables.getVariableByIdAsync("VariableID:3:12"),black=await figma.variables.getVariableByIdAsync("VariableID:3:18"),ink=await figma.variables.getVariableByIdAsync("VariableID:3:13"),white=await figma.variables.getVariableByIdAsync("VariableID:3:17");
const created=[],mutated=[];
function prop(n,label,icon){const p={};for(const k of Object.keys(n.componentProperties)){if(k.startsWith("Label#"))p[k]=label;if(k.startsWith("Icon#"))p[k]=icon;}n.setProperties(p);}
function fill(n,v){n.fills=[figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:v.id===bg.id||v.id===white.id?1:v.id===ink.id?17/255:0,g:v.id===bg.id||v.id===white.id?1:v.id===ink.id?17/255:0,b:v.id===bg.id||v.id===white.id?1:v.id===ink.id?17/255:0}},"color",v)];}
function look(n,active){fill(n,active?black:bg);mutated.push(n.id);for(const t of n.findAllWithCriteria({types:["TEXT"]})){fill(t,active?white:ink);mutated.push(t.id);}for(const v of n.findAllWithCriteria({types:["VECTOR"]})){if(v.strokes.length)v.strokes=v.strokes.map(p=>p.type==="SOLID"?figma.variables.setBoundVariableForPaint(p,"color",active?white:ink):p);if(v.fills.length)v.fills=v.fills.map(p=>p.type==="SOLID"?figma.variables.setBoundVariableForPaint(p,"color",active?white:ink):p);mutated.push(v.id);}}
for(const id of DATA.roots){const root=await figma.getNodeByIdAsync(id),sidebar=root.children.find(n=>n.name==="Sidebar");if(!sidebar)continue;const category=DATA.customerRoots.includes(id)?"Customers":DATA.locationRoots.includes(id)?"Locations":null;if(category){const dispatch=sidebar.children.find(n=>n.type==="INSTANCE"&&Object.values(n.componentProperties).some(v=>v.value==="Dispatch"));if(dispatch)look(dispatch,false);}
for(const [label,icon,target]of [["Customers","47:243",DATA.ids.customers],["Locations","47:238",DATA.ids.locations]]){
 let n=sidebar.children.find(n=>n.type==="INSTANCE"&&Object.values(n.componentProperties).some(v=>v.value===label));if(!n){n=nav.createInstance();prop(n,label,icon);const index=sidebar.children.findIndex(n=>n.type==="TEXT"&&n.characters==="REVIEW & RECORDS");sidebar.insertChild(index,n);n.resize(208,44);created.push(n.id,...n.findAll().map(c=>c.id));}
 look(n,category===label);if(target===root.id){await n.setReactionsAsync([]);continue;}await n.setReactionsAsync([{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:target,navigation:"NAVIGATE",transition:null,resetScrollPosition:true}]}]);
}
mutated.push(sidebar.id);
}
return{createdNodeIds:created.join(","),mutatedNodeIds:[...new Set(mutated)].join(","),screenCount:DATA.roots.length};

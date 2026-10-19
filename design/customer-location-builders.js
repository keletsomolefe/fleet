// Shared native Figma builders. Depends on CONFIG supplied by each saved batch.
const page=await figma.getNodeByIdAsync("3:3");await figma.setCurrentPageAsync(page);
const fonts=new Map();for(const t of page.findAllWithCriteria({types:["TEXT"]}))for(const seg of t.getStyledTextSegments(["fontName"]))fonts.set(JSON.stringify(seg.fontName),seg.fontName);
await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
const variableIds={bg:"3:12",ink:"3:13",secondary:"3:14",border:"3:15",muted:"3:16",inverse:"3:17",black:"3:18",s0:"3:19",s4:"3:20",s8:"3:21",s12:"3:22",s16:"3:23",s24:"3:24",s32:"3:25",s48:"3:26",r8:"3:27",r12:"3:28",s20:"18:146",pill:"18:145"};
const vars=Object.fromEntries(await Promise.all(Object.entries(variableIds).map(async([k,id])=>[k,await figma.variables.getVariableByIdAsync("VariableID:"+id)])));
const styles=Object.fromEntries((await figma.getLocalTextStylesAsync()).map(s=>[s.name.replace("VHH/",""),s.id]));
const components=Object.fromEntries(await Promise.all(Object.entries({input:"3:51",primary:"3:38",secondary:"3:42",ghost:"3:46",nav:"3:76",table:"3:86",banner:"3:73",status:"3:71",card:"3:67",chevron:"47:228",pin:"47:238",users:"47:243",search:"47:248"}).map(async([k,id])=>[k,await figma.getNodeByIdAsync(id)])));
const createdRoots=[],mutated=[],removed=[],routes=[],controls={},screens={};
function paint(n,k="bg"){n.fills=[figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:{bg:1,ink:17/255,secondary:89/255,border:235/255,muted:248/255,inverse:1,black:0}[k],g:{bg:1,ink:17/255,secondary:89/255,border:235/255,muted:248/255,inverse:1,black:0}[k],b:{bg:1,ink:17/255,secondary:89/255,border:235/255,muted:248/255,inverse:1,black:0}[k]}},"color",vars[k])];}
function border(n){n.strokes=[figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:0,g:0,b:0}},"color",vars.border)];n.strokeWeight=1;}
function box(parent,name,w,dir="VERTICAL",pad=0,gap=16,bg="bg"){
 const n=figma.createAutoLayout(dir);parent.appendChild(n);n.name=name;n.resize(w,32);n.primaryAxisSizingMode=dir==="HORIZONTAL"?"FIXED":"AUTO";n.counterAxisSizingMode=dir==="HORIZONTAL"?"AUTO":"FIXED";
 for(const key of ["paddingTop","paddingBottom","paddingLeft","paddingRight"])n.setBoundVariable(key,vars["s"+pad]);
 n.setBoundVariable("itemSpacing",vars["s"+gap]);if(bg)paint(n,bg);else n.fills=[];return n;
}
function panel(parent,name,w=828){const n=box(parent,name,w,"VERTICAL",24,16);border(n);n.setBoundVariable("topLeftRadius",vars.r12);n.setBoundVariable("topRightRadius",vars.r12);n.setBoundVariable("bottomLeftRadius",vars.r12);n.setBoundVariable("bottomRightRadius",vars.r12);return n;}
function txt(parent,value,style="Small",color="ink",w){const n=figma.createText();n.textStyleId=styles[style];n.characters=value;n.name=value.slice(0,70);paint(n,color);parent.appendChild(n);if(w){n.textAutoResize="HEIGHT";n.resize(w,n.height);}return n;}
function props(n,values){const p={};for(const [name,value]of Object.entries(values)){const key=Object.keys(n.componentProperties).find(k=>k.split("#")[0]===name);if(key)p[key]=value;}n.setProperties(p);return n;}
function inst(parent,key,values={},w){const n=components[key].createInstance();parent.appendChild(n);props(n,values);if(w)n.resize(w,n.height);return n;}
function route(n,target){if(target)routes.push({id:n.id,target});return n;}
function button(parent,label,target,style="primary",w=232){const n=inst(parent,style,{Label:label},w);n.resize(w,48);return route(n,target);}
function field(parent,label,value,w=378,target,hint=""){
 const n=inst(parent,"input",{Label:label,Value:value,Hint:hint},w);n.resize(w,hint?98:76);const well=n.children.find(c=>c.name==="Input well");well.resize(w,48);const h=n.children.find(c=>c.name==="Supporting information");h.visible=Boolean(hint);if(target)route(n,target);return n;
}
function select(parent,label,value,w,target,hint=""){
 const wrap=box(parent,"Select / "+label,w,"VERTICAL",0,0,null);const f=field(wrap,label,value,w,target,hint);const icon=inst(wrap,"chevron",{},20);icon.resize(20,20);icon.layoutPositioning="ABSOLUTE";icon.x=w-32;icon.y=36;icon.rotation=-90;return {wrap,field:f};
}
function fieldRow(parent,items,w=778){const r=box(parent,"Form row",w,"HORIZONTAL",0,16,null);const width=(w-16*(items.length-1))/items.length;for(const a of items){if(a.select)select(r,a.label,a.value,width,a.target,a.hint||"");else field(r,a.label,a.value,width,a.target,a.hint||"");}return r;}
function banner(parent,title,detail,w=778){return inst(parent,"banner",{Title:title,Detail:detail},w);}
function steps(parent,active,w=778){const r=box(parent,"Dispatch steps",w,"HORIZONTAL",0,12,null);for(const [i,label] of ["1 Job","2 Stops","3 Assignment","4 Proof"].entries()){const n=inst(r,"status",{Label:label},(w-36)/4);n.resize((w-36)/4,28);if(i===active){paint(n,"black");for(const t of n.findAllWithCriteria({types:["TEXT"]}))paint(t,"inverse");}}return r;}
function heading(w,title,detail,category="CUSTOMERS & LOCATIONS"){const h=box(w,"Page heading",1152,"VERTICAL",0,8,null);txt(h,category,"Caption","secondary",1152);txt(h,title,"H1","ink",1152);txt(h,detail,"Small","secondary",1152);return h;}
function rail(grid,title,lines){const r=panel(grid,"Context panel",300);txt(r,title,"H3","ink",250);for(const line of lines)txt(r,line,"Small","secondary",250);return r;}
function columns(w){return box(w,"Workspace columns",1152,"HORIZONTAL",0,24,null);}
function actions(w,defs){const row=box(w,"Page actions",1152,"HORIZONTAL",0,16,null);row.paddingTop=12;border(row);row.strokeLeftWeight=0;row.strokeRightWeight=0;row.strokeBottomWeight=0;for(const [label,target,style] of defs)button(row,label,target,style||"primary");return row;}
function table(parent,title,heads,rows){const p=panel(parent,title,1152);txt(p,title,"H3","ink",1102);const h=box(p,"Table header",1102,"HORIZONTAL",12,16,"muted");for(const value of heads)txt(h,value,"Caption","secondary",250);for(const [values,target]of rows){const r=inst(p,"table",Object.fromEntries(values.map((v,i)=>["Column "+(i+1),v])),1102);for(const t of r.children.filter(c=>c.type==="TEXT")){t.textAutoResize="HEIGHT";t.resize(250,t.height);}route(r,target);}return p;}
function getWorkspace(root){return root.children.find(n=>n.name==="Main").children.find(n=>n.name==="Workspace");}
async function shell(key,title,detail,category){
 let root;
 if(CONFIG.existing?.[key]){root=await figma.getNodeByIdAsync(CONFIG.existing[key]);mutated.push(root.id);}
 else {root=(await figma.getNodeByIdAsync("7:291")).clone();createdRoots.push(root);CONFIG.section.appendChild(root);const i=CONFIG.offset+createdRoots.length-1;root.x=48+(i%3)*1560;root.y=80+Math.floor(i/3)*1204;root.name=CONFIG.number+"."+String(i+1).padStart(2,"0")+" · "+key+" / "+title;}
 const ws=getWorkspace(root);for(const n of [...ws.children]){if(CONFIG.existing?.[key])removed.push(n.id,...("findAll"in n?n.findAll().map(c=>c.id):[]));n.remove();}
 ws.itemSpacing=24;ws.paddingTop=24;ws.paddingBottom=24;ws.paddingLeft=24;ws.paddingRight=24;
 const top=root.children.find(n=>n.name==="Main").children.find(n=>n.name==="Topbar");const ts=top.findAllWithCriteria({types:["TEXT"]});if(ts[0]){ts[0].characters="Operations / "+title;mutated.push(ts[0].id);}
 heading(ws,title,detail,category);screens[key]=root.id;controls[key]={root,ws};return controls[key];
}
function menu(root,anchor,title,options,empty=false,searchTarget){
 const b=panel(root,"Dropdown / "+title,anchor.width);b.layoutPositioning="ABSOLUTE";
 const a=anchor.absoluteBoundingBox,r=root.absoluteBoundingBox;b.x=a.x-r.x;b.y=a.y-r.y+76;
 const top=box(b,"Dropdown title",anchor.width-48,"HORIZONTAL",0,8,null);txt(top,title,"H3","ink",anchor.width-48);
 field(b,"Search",empty?"Northside":"Search by name",anchor.width-48,searchTarget);
 if(empty){txt(b,"No matching customer","Body strong","ink",anchor.width-48);txt(b,"Add a customer to use it on this job.","Small","secondary",anchor.width-48);}
 for(const [label,target]of options)button(b,label,target,"secondary",anchor.width-48);
 return b;
}
const spec=CONFIG.spec;
for(const s of spec){
 const {root,ws}=await shell(s.key,s.title,s.subtitle,s.category||"CUSTOMERS & LOCATIONS");
 if(s.kind==="customerList"){
  const t=box(ws,"Customer list toolbar",1152,"HORIZONTAL",0,16,null);field(t,"Search customers","Search name or reference",700,s.saved?"customerSaved":"customers");button(t,"Add customer","customerCreate","primary",240);
  const rows=[[["BuildCo Distribution","CUST-001","3 locations","Active"],"customerBuildCo"]];
  if(s.saved)rows.push([["Northside Aggregates","CUST-002",s.noSite?"0 locations":"1 location","Active"],s.noSite?"customerNorthside":"customerNorthsideSite"]);
  table(ws,"Customers",["CUSTOMER","REFERENCE","LOCATIONS","STATUS"],rows);
  banner(ws,"Saved records, reused on jobs","Choose a customer from the job dropdown. Locations stay linked to their customer.",1152);
  actions(ws,[["Plan a job","jobCreate"],["Manage locations","locations","secondary"]]);
 }
 if(s.kind==="customerForm"){
  const grid=columns(ws),p=panel(grid,"Customer details");const ready=s.ready;
  fieldRow(p,[{label:"Customer name *",value:ready?"Northside Aggregates":"Enter customer name",target:"customerReady"},{label:"Customer reference",value:"CUST-002 · generated"}]);
  fieldRow(p,[{label:"Primary contact",value:ready?"Site coordinator":"Contact name",target:"customerReady"},{label:"Email",value:ready?"operations@example.test":"Email address",target:"customerReady"}]);
  fieldRow(p,[{label:"Phone (optional)",value:"Not supplied"},{label:"Status",value:"Active"}]);
  field(p,"Notes (optional)",ready?"Collection and delivery of bulk material":"Add useful planning notes",778,"customerReady");
  if(s.error)banner(p,"Customer name is required","Enter a name before saving. Your other details stay in this form.");
  rail(grid,"Reusable customer record",["Contacts belong to the customer.","Add locations separately for collection or delivery.","Records shown here are fictional prototype data."]);
  actions(ws,[["Save customer",ready&&!s.error?"customerNorthside":"customerError"],["Back to customers","customers","secondary"]]);
 }
 if(s.kind==="customerDetail"){
  const grid=columns(ws),p=panel(grid,"Customer details");
  const north=s.north;
  fieldRow(p,[{label:"Customer name",value:north?"Northside Aggregates":"BuildCo Distribution"},{label:"Reference",value:north?"CUST-002":"CUST-001"}]);
  fieldRow(p,[{label:"Primary contact",value:north?"Site coordinator":"Dispatch coordinator"},{label:"Email",value:north?"operations@example.test":"dispatch@example.test"}]);
  txt(p,"Locations","H3","ink",778);
  if(!north){for(const line of ["City Deep · collection","Midrand · delivery","Pretoria · delivery"])route(inst(p,"card",{Title:line,Detail:"Saved site, contact and access instructions",Meta:"Active",Icon:"47:238"},778),"locationCityDeep");}
  else if(s.hasSite)route(inst(p,"card",{Title:"Northside Yard",Detail:"Collection area · Gate 1",Meta:"Active",Icon:"47:238"},778),"locationNorthside");
  else banner(p,"No locations yet","Add a collection or delivery location before planning this customer’s route.");
  rail(grid,"Customer and locations",["One customer can have several locations.","A location stores its own site contact and access notes.","Shared locations can serve different customers."]);
  actions(ws,north?[["Add location","locationCreate"],...(s.hasSite?[["Plan a job","jobNorthside","secondary"]]:[]),["Back to customers",s.hasSite?"customerSaved":"customerSavedNoSite","secondary"]]:[["View locations","locations"],["Plan a job","jobCreate","secondary"]]);
 }
 if(s.kind==="locationList"){
  const t=box(ws,"Location toolbar",1152,"HORIZONTAL",0,16,null);field(t,"Search locations","Search site, customer or address",700,"locations");button(t,"Add location","locationCreate","primary",240);
  const rows=[
   [["City Deep","BuildCo Distribution","Collection · Gate 3","Active"],"locationCityDeep"],
   [["Midrand","BuildCo Distribution","Delivery · receiving bay","Active"],"stopMidrand"],
   [["Pretoria","BuildCo Distribution","Delivery · receiving bay","Active"],"stopPretoria"],
   [["Central receiving site","Shared location","Delivery / unloading","Active"],"locationShared"]
  ];
  if(s.saved)rows.push([["Northside Yard","Northside Aggregates","Collection · Gate 1","Active"],"locationNorthside"]);
  table(ws,"Saved locations",["LOCATION","CUSTOMER / SHARED","SITE USE / ACCESS","STATUS"],rows);
  actions(ws,[["Plan a job",s.saved?"jobNorthside":"jobCreate"],["Customers",s.saved?"customerSaved":"customers","secondary"]]);
 }
 if(s.kind==="locationForm"){
  const grid=columns(ws),p=panel(grid,"Location details"),ready=s.ready;
  fieldRow(p,[{label:"Location name *",value:ready?"Northside Yard":"Enter a site name",target:"locationReady"},{label:"Customer",value:"Northside Aggregates"}]);
  fieldRow(p,[{label:"Address / site directions *",value:ready?"Northside operations · Gate 1":"Address, coordinates or site directions",target:"locationReady"},{label:"Used for",value:"Collection"}]);
  fieldRow(p,[{label:"Site contact",value:ready?"Loading coordinator":"Contact name",target:"locationReady"},{label:"Contact phone (optional)",value:"Not supplied"}]);
  field(p,"Access instructions",ready?"Report at Gate 1. Wait for the loading coordinator.":"Gate, access point and arrival instructions",778,"locationReady");
  txt(p,"Address, coordinates or clear site directions identify the location. GPS is optional.","Small","secondary",778);
  if(s.error)banner(p,"Add a name and location","Provide a site name and an address, coordinates or directions before saving.");
  rail(grid,"Saved location",["This site belongs to Northside Aggregates.","Site contact and access instructions fill the stop when selected.","Job-specific quantities and time windows stay on the job."]);
  actions(ws,[["Save location",ready&&!s.error?"locationNorthside":"locationError"],["Cancel","customerNorthside","secondary"]]);
 }
 if(s.kind==="locationDetail"){
  const grid=columns(ws),p=panel(grid,"Location details"),north=s.north,shared=s.shared,place=s.which||"City Deep";
  fieldRow(p,[{label:"Location name",value:north?"Northside Yard":shared?"Central receiving site":place},{label:"Customer / availability",value:north?"Northside Aggregates":shared?"Shared · any customer":"BuildCo Distribution"}]);
  fieldRow(p,[{label:"Address / directions",value:north?"Northside operations · Gate 1":shared?"Receiving site · main entrance":place==="City Deep"?"City Deep · Gate 3":place+" · receiving bay"},{label:"Used for",value:shared||s.delivery?"Delivery / unloading":"Collection"}]);
  fieldRow(p,[{label:"Site contact",value:shared||s.delivery?"Receiving operator":"Loading coordinator"},{label:"Status",value:"Active"}]);
  field(p,"Access instructions",north?"Report at Gate 1. Wait for the loading coordinator.":shared?"Report to the receiving operator before unloading.":place==="City Deep"?"Use Gate 3. Report to the loading office.":"Report to the receiving bay.",778);
  rail(grid,shared?"Shared location":"Customer location",["Saved details fill the selected stop.","Each job keeps a snapshot of the selected details.","Changes to saved records do not silently alter dispatched jobs."]);
  actions(ws,north?[["Use on a job","jobNorthside"],["View customer","customerNorthsideSite","secondary"],["All locations","locationSaved","secondary"]]:[["Plan a job","jobCreate"],["All locations","locations","secondary"]]);
 }
 if(s.kind==="job"){
  const north=s.north,grid=columns(ws),p=panel(grid,"Job details");steps(p,0);
  const selectRoot=select(p,"Customer *",north?"Northside Aggregates":"BuildCo Distribution",778,north?"customerMenuSaved":"customerMenu");
  fieldRow(p,[{label:"Job reference",value:north?"VHH-1043":"VHH-1042"},{label:"Scheduled date",value:north?"17 October 2026":"16 October 2026"}]);
  fieldRow(p,[{label:"Load description",value:north?"Bulk material":"Palletised building supplies"},{label:"Quantity / unit",value:north?"20 tonnes":"24 pallets"}]);
  fieldRow(p,[{label:"Dispatch window",value:"08:00–14:00"},{label:"Instructions",value:north?"Collect, then deliver and unload":"Pickup at Gate 3, City Deep"}]);
  txt(p,"Next: choose saved locations and order the stops. Driver and truck follow in step 3.","Small","secondary",778);
  rail(grid,north?"VHH-1043":"VHH-1042",[north?"Northside Aggregates":"BuildCo Distribution",north?"20 tonnes · collection and delivery":"24 pallets · collection and delivery","Choose locations in the next step."]);
  actions(ws,[["Continue: stops",north?"stopsNorthside":"stops"],[north?"Back to customer":"Cancel draft",north?"customerNorthsideSite":"cancelJob","secondary"]]);
  controls[s.key].customerAnchor=selectRoot.wrap;
  if(s.menu)menu(root,selectRoot.wrap,"Choose customer",s.saved?[["BuildCo Distribution","jobCreate"],["Northside Aggregates","jobNorthside"],["Close","jobNorthside"]]:s.empty?[["Add Northside Aggregates","customerReady"],["Clear search","customerMenu"],["Close","jobCreate"]]:[["BuildCo Distribution","jobCreate"],["Add customer","customerCreate"],["Close","jobCreate"]],s.empty,s.saved?"customerMenuSaved":s.empty?"customerMenu":"customerSearch");
 }
 if(s.kind==="stops"){
  const north=s.north,grid=columns(ws),p=panel(grid,"Ordered stops");steps(p,1);
  const lines=north?[["01 · Collection","Northside Yard","Gate 1 · collect 20 tonnes","stopNorthside"],["02 · Delivery / unloading","Central receiving site","Tipper unloading · deliver 20 tonnes","stopNorthsideDelivery"]]:[["01 · Collection","City Deep","Gate 3 · collect 24 pallets","stopCityDeep"],["02 · Delivery","Midrand","10:00–11:00 · deliver 12 pallets","stopMidrand"],["03 · Delivery","Pretoria","13:00–14:00 · deliver 12 pallets","stopPretoria"]];
  for(const [title,loc,detail,target]of lines){const row=panel(p,title,778);txt(row,title,"Caption","secondary",728);select(row,"Saved location",loc,728,target);txt(row,detail,"Small","secondary",728);}
  rail(grid,north?"VHH-1043":"VHH-1042",[north?"Northside Aggregates":"BuildCo Distribution","Select a stop to choose its saved location.","Site contacts and access instructions fill automatically.","Stop quantities and time windows belong to this job."]);
  actions(ws,[["Continue: assignment",north?"assignmentNorthside":"assignment"],["Back to job",north?"jobNorthside":"jobCreate","secondary"],...(!north?[["Reorder deliveries","reorderStops","secondary"]]:[])]);
 }
 if(s.kind==="stop"){
  const north=s.north,delivery=s.delivery,which=s.which||"City Deep",grid=columns(ws),p=panel(grid,"Stop details");
  steps(p,1);const anchor=select(p,"Location *",north?(delivery?"Central receiving site":"Northside Yard"):which,778,s.menuKey||"locationMenu");
  fieldRow(p,[{label:"Activity",value:delivery?"Delivery / unloading":"Collection"},{label:"Quantity / unit",value:north?"20 tonnes":which==="City Deep"?"24 pallets":"12 pallets"}]);
  fieldRow(p,[{label:"Time window",value:which==="Midrand"?"10:00–11:00":which==="Pretoria"?"13:00–14:00":"08:00–08:30"},{label:"Contact",value:delivery?"Receiving operator":"Loading coordinator"}]);
  field(p,"Site access instructions",north?(delivery?"Report before tipping or unloading.":"Gate 1 · report to the loading coordinator."):which==="City Deep"?"Gate 3 · report to the loading office.":"Report to the receiving bay.",778);
  banner(p,"Filled from the saved location","Adjust this stop’s instructions if needed. The saved location record is kept separately.");
  rail(grid,"Location selection",[north?"Customer: Northside Aggregates":"Customer: BuildCo Distribution","Customer locations and shared sites are available.","Select a location, then review the stop details."]);
  actions(ws,[["Save stop",north?"stopsNorthside":"stops"],["Cancel",north?"stopsNorthside":"stops","secondary"]]);
  if(s.menu)menu(root,anchor.wrap,"Choose location",s.north?[["Northside Yard · Collection","stopNorthside"],["Central receiving · Delivery","stopNorthsideDelivery"],["Manage locations","locationSaved"],["Close","stopNorthside"]]:[["City Deep · Collection","stopCityDeep"],["Midrand · Delivery","stopMidrand"],["Pretoria · Delivery","stopPretoria"],["Manage locations","locations"],["Close","stopCityDeep"]]);
 }
 if(s.kind==="assignment"){
  const grid=columns(ws),p=panel(grid,"Assignment");steps(p,2);fieldRow(p,[{label:"Driver",value:"Thabo Mokoena · TM-014"},{label:"Truck",value:"VHH-012 · GP 24 VH GP"}]);banner(p,"Assignment is ready","The driver has prepared access on this truck device.");rail(grid,"VHH-1043",["Northside Aggregates · 20 tonnes","01 Northside Yard · collection","02 Central receiving site · delivery / unloading"]);actions(ws,[["Continue: proof","proofNorthside"],["Back to stops","stopsNorthside","secondary"]]);
 }
 if(s.kind==="proof"){
  const grid=columns(ws),p=panel(grid,"Requirements and review");steps(p,3);
  fieldRow(p,[{label:"Photo or document",value:"Required"},{label:"Recipient name / signature",value:"Optional for this example"}]);
  banner(p,"Missing required evidence stays visible","The driver records a reason when required proof is unavailable.");
  txt(p,"Northside Aggregates · VHH-1043","H3","ink",778);txt(p,"Collect 20 tonnes at Northside Yard, then deliver and unload at Central receiving site.","Body","ink",778);txt(p,"Thabo Mokoena · VHH-012 · GP 24 VH GP","Small","secondary",778);
  rail(grid,"Review before dispatch",["2 ordered stops · 20 tonnes","Saved location contacts and instructions are included.","This new example uses a separate job reference."]);actions(ws,[["Dispatch VHH-1043","dispatchedNorthside"],["Back to assignment","assignmentNorthside","secondary"]]);
 }
 if(s.kind==="dispatched"){
  const grid=columns(ws),p=panel(grid,"Dispatch result");banner(p,"VHH-1043 dispatched","Northside Aggregates · Thabo Mokoena · VHH-012");txt(p,"01 · Collect 20 tonnes","H3","ink",778);txt(p,"Northside Yard · Gate 1","Small","secondary",778);txt(p,"02 · Deliver and unload 20 tonnes","H3","ink",778);txt(p,"Central receiving site · report before unloading","Small","secondary",778);rail(grid,"Job records",["Customer, location and stop details stay linked.","The driver receives the assignment after synchronizing.","This is a prototype dispatch result."]);actions(ws,[["Back to dispatch","dispatch"],["View customer","customerNorthsideSite","secondary"],["Plan another job","jobNorthside","secondary"]]);
 }
}
for(const r of routes){const target=CONFIG.ids[r.target]||screens[r.target];if(target){const n=await figma.getNodeByIdAsync(r.id);let owner=n;while(owner.parent&&owner.parent.type!=="PAGE"&&owner.parent.type!=="SECTION")owner=owner.parent;if(owner.id===target)continue;await n.setReactionsAsync([{trigger:{type:"ON_CLICK"},actions:[{type:"NODE",destinationId:target,navigation:"NAVIGATE",transition:null,resetScrollPosition:true}]}]);}}
const createdIds=createdRoots.flatMap(n=>[n.id,...n.findAll().map(c=>c.id)]);
// New descendants in edited existing screens are included too.
for(const id of Object.values(CONFIG.existing||{})){const n=await figma.getNodeByIdAsync(id);for(const c of getWorkspace(n).findAll())createdIds.push(c.id);}
return {createdNodeIds:[...new Set(createdIds)].join(","),mutatedNodeIds:[...new Set(mutated)],removedNodeIds:removed.join(","),screens,routes,summary:createdRoots.map(n=>({id:n.id,name:n.name,w:n.width,h:n.height,descendants:n.findAll().length}))};


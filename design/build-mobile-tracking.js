// Executed after mobile-device-setup-state.json. Inspect the saved ledger before replaying.
const page=await figma.getNodeByIdAsync('3:2');await figma.setCurrentPageAsync(page);
if(page.children.some(n=>n.name==='00b · Native app · durable location sharing'))throw new Error('Tracking states already exist. Inspect before updating.');
const source=await figma.getNodeByIdAsync('140:6277');
const fonts=new Map();for(const t of source.findAllWithCriteria({types:['TEXT']}))for(const s of t.getStyledTextSegments(['fontName']))fonts.set(JSON.stringify(s.fontName),s.fontName);await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
const component={};for(const [k,id] of Object.entries({card:'3:67',banner:'3:73',button:'3:38',ghost:'3:46'}))component[k]=await figma.getNodeByIdAsync(id);
const variables={};for(const [k,id] of Object.entries({s8:'VariableID:3:21',muted:'VariableID:3:14'}))variables[k]=await figma.variables.getVariableByIdAsync(id);
const styles=await figma.getLocalTextStylesAsync(),small=styles.find(s=>s.name==='VHH/Small');await figma.loadFontAsync(small.fontName);
const created=[],mutated=[],screens={},controls={},cards={},secondary={};
const section=figma.createSection();section.name='00b · Native app · durable location sharing';section.x=Math.max(...page.children.filter(n=>n.id!==section.id).map(n=>n.x+n.width))+160;section.y=160;section.resizeWithoutConstraints(2116,1120);created.push(section.id);
function instance(parent,key,props,height){const n=component[key].createInstance();parent.appendChild(n);n.setProperties(props);n.resize(parent.width,height);n.layoutSizingHorizontal='FILL';created.push(n.id);return n;}
async function copy(parent,value){const n=figma.createText();n.fontName=small.fontName;await n.setTextStyleIdAsync(small.id);n.characters=value;parent.appendChild(n);n.textAutoResize='HEIGHT';n.resize(parent.width,n.height);n.layoutSizingHorizontal='FILL';n.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',variables.muted)];created.push(n.id);return n;}
const states=[
{key:'trackingOff',title:'Location sharing off',detail:'0 records waiting · Disconnected',meta:'Precise and background access required',button:'Start location sharing',paragraph:'Record this truck’s route while sharing is on, including offline and in the background.'},
{key:'trackingOnline',title:'Location sharing on',detail:'0 records waiting · MQTT',meta:'Last GPS fix · 08:14',button:'Stop sharing'},
{key:'trackingOffline',title:'Location sharing on',detail:'24 records waiting · Offline',meta:'Last GPS fix · 08:14',button:'Stop sharing',secondary:'Sync location log'},
{key:'trackingPermission',title:'Location sharing paused',detail:'24 records waiting · Disconnected',meta:'Last GPS fix · 08:12',button:'Stop sharing',secondary:'Location settings',warning:'Allow precise location and all-the-time access in device settings.'}
];
for(let i=0;i<states.length;i++){
 const state=states[i],frame=source.clone();section.appendChild(frame);frame.name=`00b.${i+1} · ${state.key}`;frame.x=64+i*508;frame.y=96;created.push(frame.id,...frame.findAll(()=>true).map(n=>n.id));screens[state.key]=frame.id;
 for(const n of [frame,...frame.findAll(()=>true)])if('setReactionsAsync'in n&&n.reactions?.length)await n.setReactionsAsync([]);
 const body=frame.findOne(n=>n.type==='FRAME'&&n.name==='Screen content');
 const group=figma.createAutoLayout('VERTICAL');group.name='Location sharing controls';body.appendChild(group);group.resize(body.width,10);group.layoutSizingHorizontal='FILL';group.layoutSizingVertical='HUG';group.primaryAxisSizingMode='AUTO';group.counterAxisSizingMode='FIXED';group.fills=[];group.setBoundVariable('itemSpacing',variables.s8);created.push(group.id);
 cards[state.key]=instance(group,'card',{'Title#3:19':state.title,'Detail#3:20':state.detail,'Meta#3:21':state.meta,'Icon#47:0':'47:233'},104);
 if(state.paragraph)await copy(group,state.paragraph);
 if(state.warning)instance(group,'banner',{'Title#3:23':'Location access needed','Detail#3:24':state.warning,'Icon#47:1':'47:223'},96);
 controls[state.key]=instance(group,state.key==='trackingOff'?'button':'ghost',{'Label#3:0':state.button},48);
 if(state.secondary)secondary[state.key]=instance(group,'ghost',{'Label#3:0':state.secondary},48);
 if(state.key==='trackingOffline'){const status=frame.findAllWithCriteria({types:['INSTANCE']}).find(n=>n.componentProperties['Label#3:22']);if(status)status.setProperties({'Label#3:22':'Offline'});}
 const oldActions=frame.findOne(n=>n.type==='FRAME'&&n.name==='Screen actions');for(const n of oldActions.children){if(n.type==='INSTANCE'&&n.componentProperties['Label#3:0']?.value==='Check assigned truck')n.setProperties({'Label#3:0':'Refresh truck'});}
}
const route=(node,id)=>node.setReactionsAsync([{trigger:{type:'ON_CLICK'},actions:[{type:'NODE',destinationId:id,navigation:'NAVIGATE',transition:{type:'DISSOLVE',duration:0.15,easing:{type:'EASE_OUT'}},preserveScrollPosition:false}]}]);
await route(controls.trackingOff,screens.trackingOnline);for(const key of ['trackingOnline','trackingOffline','trackingPermission'])await route(controls[key],screens.trackingOff);
await route(cards.trackingOnline,screens.trackingOffline);await route(cards.trackingOffline,screens.trackingPermission);for(const key of ['trackingOffline','trackingPermission'])await route(secondary[key],screens.trackingOnline);
const confirmed=await figma.getNodeByIdAsync('140:6277');const entry=confirmed.findAllWithCriteria({types:['INSTANCE']}).find(n=>n.componentProperties['Label#3:0']?.value==='Check assigned truck');if(entry){entry.setProperties({'Label#3:0':'Location sharing'});await route(entry,screens.trackingOff);mutated.push(entry.id);}
const starts=new Map(page.flowStartingPoints.map(p=>[p.nodeId,p]));starts.set(screens.trackingOff,{nodeId:screens.trackingOff,name:'00b · Native app · online and offline location sharing'});page.flowStartingPoints=[...starts.values()];mutated.push(page.id);
const descendants=section.findAll(()=>true),counts={};for(const n of descendants)counts[n.type]=(counts[n.type]??0)+1;
return {sectionId:section.id,screens,createdNodeIds:[...new Set([...created,...descendants.map(n=>n.id)])],mutatedNodeIds:mutated,nodeCounts:counts,imageNodes:descendants.filter(n=>Array.isArray(n.fills)&&n.fills.some(p=>p.type==='IMAGE')).map(n=>({id:n.id,name:n.name})),badFonts:descendants.filter(n=>n.type==='TEXT').flatMap(t=>t.getStyledTextSegments(['fontName']).filter(s=>s.fontName.family!=='Montserrat').map(s=>({id:t.id,font:s.fontName}))),bodyBounds:section.children.filter(n=>n.type==='FRAME').map(f=>({id:f.id,content:f.findOne(n=>n.type==='FRAME'&&n.name==='Screen content').height,actions:f.findOne(n=>n.type==='FRAME'&&n.name==='Screen actions').height}))};

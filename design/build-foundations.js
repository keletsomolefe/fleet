// Scoped VHH component library. Helper adapted from the skill's createVariableCollection.
async function createVariableCollection(name, modeNames) {
 const collection=figma.variables.createVariableCollection(name), modeIds={};
 collection.renameMode(collection.modes[0].modeId,modeNames[0]);
 modeIds[modeNames[0]]=collection.modes[0].modeId;
 return {collection,modeIds};
}
const page=figma.root.children.find(p=>p.id==='0:1');
await figma.setCurrentPageAsync(page);
if(page.children.length) throw Error('Foundations already has content; inspect before retry');
page.name='Foundations';
const driver=figma.createPage(); driver.name='Driver App';
const admin=figma.createPage(); admin.name='Web Admin';
await Promise.all(['Regular','Medium','Semi Bold','Bold'].map(style=>figma.loadFontAsync({family:'Inter',style})));
const prim=await createVariableCollection('VHH Primitives',['Value']);
const sem=await createVariableCollection('VHH Tokens',['Light']);
const pv={},v={};
for(const [name,n] of Object.entries({black:0,ink:17,secondary:99,border:220,muted:245,white:255})) {
 const t=figma.variables.createVariable(name,prim.collection,'COLOR'); t.scopes=[];t.setValueForMode(prim.modeIds.Value,{r:n/255,g:n/255,b:n/255,a:1});t.setVariableCodeSyntax('WEB',`var(--vhh-${name})`);pv[name]=t;
}
for(const [name,base,scopes] of [['bg','white',['FRAME_FILL','SHAPE_FILL']],['ink','ink',['TEXT_FILL','FRAME_FILL','SHAPE_FILL','STROKE_COLOR']],['secondary','secondary',['TEXT_FILL','STROKE_COLOR']],['border','border',['STROKE_COLOR']],['muted','muted',['FRAME_FILL','SHAPE_FILL']],['inverse','white',['TEXT_FILL','STROKE_COLOR']],['black','black',['FRAME_FILL','SHAPE_FILL','STROKE_COLOR']]]){
 const t=figma.variables.createVariable(name,sem.collection,'COLOR');t.scopes=scopes;t.setValueForMode(sem.modeIds.Light,{type:'VARIABLE_ALIAS',id:pv[base].id});t.setVariableCodeSyntax('WEB',`var(--vhh-${name})`);t.setVariableCodeSyntax('ANDROID',`VhhTheme.${name}`);v[name]=t;
}
for(const n of [0,4,8,12,16,24,32,48]){const t=figma.variables.createVariable('space/'+n,sem.collection,'FLOAT');t.scopes=['GAP'];t.setValueForMode(sem.modeIds.Light,n);t.setVariableCodeSyntax('WEB',`var(--vhh-space-${n})`);v['s'+n]=t;}
for(const n of [8,12]){const t=figma.variables.createVariable('radius/'+n,sem.collection,'FLOAT');t.scopes=['CORNER_RADIUS'];t.setValueForMode(sem.modeIds.Light,n);t.setVariableCodeSyntax('WEB',`var(--vhh-radius-${n})`);v['r'+n]=t;}
const styles={};
for(const [name,size,style,line] of [['Display',48,'Semi Bold',56],['H1',32,'Semi Bold',40],['H2',24,'Semi Bold',32],['H3',18,'Semi Bold',24],['Body',16,'Regular',24],['Body strong',16,'Semi Bold',24],['Small',14,'Regular',20],['Caption',12,'Medium',16],['Metric',36,'Semi Bold',44]]){const s=figma.createTextStyle();s.name='VHH/'+name;s.fontName={family:'Inter',style};s.fontSize=size;s.lineHeight={unit:'PIXELS',value:line};styles[name]=s;}
function fill(n,k='bg'){n.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',v[k])];}
function stroke(n){n.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',v.border)];n.strokeWeight=1;}
function rad(n,r=8){for(const p of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])n.setBoundVariable(p,v['r'+r]);}
function text(parent,str,style='Body',color='ink',width){const t=figma.createText();t.name=str.slice(0,40);t.textStyleId=styles[style].id;t.characters=str;fill(t,color);parent.appendChild(t);if(width){t.textAutoResize='HEIGHT';t.resize(width,t.height);}return t;}
function box(parent,name,w,h,dir='VERTICAL',padding=16,gap=8,bg='bg'){const b=figma.createAutoLayout(dir);b.name=name;parent.appendChild(b);b.resize(w,h);b.primaryAxisSizingMode='FIXED';b.counterAxisSizingMode='FIXED';for(const p of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])b.setBoundVariable(p,v['s'+padding]);b.setBoundVariable('itemSpacing',v['s'+gap]);fill(b,bg);return b;}
function component(name,w,h,padding=16,gap=8,bg='bg'){const c=figma.createComponent();c.name=name;c.resize(w,h);c.layoutMode='VERTICAL';c.primaryAxisSizingMode='FIXED';c.counterAxisSizingMode='FIXED';for(const p of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])c.setBoundVariable(p,v['s'+padding]);c.setBoundVariable('itemSpacing',v['s'+gap]);fill(c,bg);rad(c);c.description='VHH Fleet reusable '+name;return c;}
function prop(c,node,name){const k=c.addComponentProperty(name,'TEXT',node.characters);node.componentPropertyReferences={characters:k};}
const components={};let cx=1560,cy=160;
function park(c){page.appendChild(c);c.x=cx;c.y=cy;cy+=c.height+48;components[c.name]=c.id;return c;}
function variants(name,items){const set=figma.combineAsVariants(items,page);set.name=name;set.description='VHH Fleet '+name+' variants';set.x=cx;set.y=cy;items.forEach((c,i)=>{c.x=16;c.y=16+i*(c.height+16)});set.resize(400,items.reduce((sum,c)=>sum+c.height+16,16));cy+=set.height+64;components[name]=set.id;return set;}
const buttons=[];
for(const style of ['Primary','Secondary','Ghost'])for(const state of ['Default','Disabled']){const c=component(`Style=${style}, State=${state}`,364,52,16,0,style==='Primary'?'black':'bg');c.layoutMode='HORIZONTAL';c.primaryAxisAlignItems='CENTER';c.counterAxisAlignItems='CENTER';if(style==='Secondary')stroke(c);if(state==='Disabled')c.opacity=.4;const t=text(c,'Continue','Body strong',style==='Primary'?'inverse':'ink');buttons.push(c);}
const bs=variants('Button',buttons);const bk=bs.addComponentProperty('Label','TEXT','Continue');for(const c of buttons)c.children[0].componentPropertyReferences={characters:bk};
const inputs=[];
for(const state of ['Default','Error','Disabled']){const c=component('State='+state,364,96,0,8);const label=text(c,'Field label','Small');const well=box(c,'Input well',364,48,'HORIZONTAL',12,8,'bg');stroke(well);rad(well);well.counterAxisAlignItems='CENTER';const value=text(well,'Enter a value','Body');const hint=text(c,state==='Error'?'Check this value':'Supporting information','Caption','secondary');if(state==='Disabled')c.opacity=.4;inputs.push({c,label,value,hint});}
const ins=variants('Input',inputs.map(x=>x.c));for(const field of ['Label','Value','Hint']){const k=ins.addComponentProperty(field,'TEXT',field);for(const x of inputs)x[field.toLowerCase()].componentPropertyReferences={characters:k};}
const card=component('Card',364,120);stroke(card);prop(card,text(card,'Job VHH-1042','H3'),'Title');prop(card,text(card,'Johannesburg → Pretoria','Small','secondary'),'Detail');prop(card,text(card,'3 stops · 24 pallets','Caption'),'Meta');park(card);
const badge=component('Status',160,32,8,0,'muted');badge.layoutMode='HORIZONTAL';badge.counterAxisAlignItems='CENTER';prop(badge,text(badge,'○ In progress','Caption'),'Label');park(badge);
const banner=component('Banner',364,72,12,4,'muted');stroke(banner);prop(banner,text(banner,'Offline · saved on this device','Small'),'Title');prop(banner,text(banner,'Your work will upload when connected.','Caption','secondary'),'Detail');park(banner);
const nav=component('Navigation item',208,48,12,0);nav.layoutMode='HORIZONTAL';nav.counterAxisAlignItems='CENTER';prop(nav,text(nav,'Overview','Body'),'Label');park(nav);
const stop=component('Stop timeline item',364,88,16,4,'muted');prop(stop,text(stop,'01  Loading · City Deep','Body strong'),'Title');prop(stop,text(stop,'08:00–08:30 · 24 pallets','Small','secondary'),'Detail');park(stop);
const att=component('Proof attachment',364,76,12,4,'muted');stroke(att);prop(att,text(att,'▧ Delivery note.pdf','Body strong'),'Title');prop(att,text(att,'Attached · ready to upload','Small','secondary'),'Detail');park(att);
const pin=component('PIN entry',364,64,16,0,'muted');pin.primaryAxisAlignItems='CENTER';pin.counterAxisAlignItems='CENTER';prop(pin,text(pin,'●    ●    ●    ●    ●    ●','H2'),'Digits');park(pin);
const row=component('Table row',1056,64,16,16);row.layoutMode='HORIZONTAL';stroke(row);for(let i=0;i<4;i++)prop(row,text(row,['VHH-1042','Thabo Mokoena','GP 24 VH GP','In progress'][i],'Small','ink',240),'Column '+(i+1));park(row);
const dialog=component('Dialog',364,224,24,16);stroke(dialog);prop(dialog,text(dialog,'Confirm action','H3'),'Title');prop(dialog,text(dialog,'This action is recorded in the truck timeline.','Small','secondary',316),'Detail');const db=buttons[0].createInstance();dialog.appendChild(db);db.resize(316,52);park(dialog);
const drawer=component('Drawer',364,280,24,16);stroke(drawer);prop(drawer,text(drawer,'Record details','H2'),'Title');prop(drawer,text(drawer,'Driver, truck, time and proof stay linked.','Body','secondary',316),'Detail');park(drawer);
const specimen=box(page,'VHH Foundations / Review',1200,1160,'VERTICAL',48,24);specimen.x=160;specimen.y=160;
text(specimen,'VHH FLEET / FOUNDATIONS','Caption','secondary');text(specimen,'Clarity in every movement.','Display');text(specimen,'Black and white. Built for people on the road.','H3','secondary');
const colors=box(specimen,'Monochrome palette',1104,96,'HORIZONTAL',0,16);for(const k of ['black','ink','secondary','border','muted','bg']){const s=box(colors,'Color / '+k,168,88,'VERTICAL',12,8,k==='border'?'muted':k==='secondary'?'ink':k);text(s,k,'Caption',['black','ink','secondary'].includes(k)?'inverse':'ink');}
text(specimen,'Interface components','H2');
const sample=box(specimen,'Component specimens',1104,680,'HORIZONTAL',0,24);
const left=box(sample,'Controls',364,680,'VERTICAL',0,16),right=box(sample,'Operational patterns',364,680,'VERTICAL',0,16);
for(const c of [buttons[0],buttons[2],inputs[0].c,pin,nav])left.appendChild(c.createInstance());
for(const c of [badge,card,banner,stop,att])right.appendChild(c.createInstance());
text(specimen,'Inter · 8px rhythm · 48px minimum driver targets · status always uses words and icons','Small','secondary');
return {pages:{Foundations:page.id,Driver:driver.id,Admin:admin.id},collections:{primitives:prim.collection.id,tokens:sem.collection.id},variables:Object.fromEntries(Object.entries(v).map(([k,t])=>[k,t.id])),styles:Object.fromEntries(Object.entries(styles).map(([k,t])=>[k,t.id])),components,buttonVariants:Object.fromEntries(buttons.map(c=>[c.name,c.id])),inputVariants:Object.fromEntries(inputs.map(x=>[x.c.name,x.c.id])),specimen:specimen.id,createdNodeIds:[page.id,driver.id,admin.id,...page.findAll().map(n=>n.id)],counts:{variables:Object.keys(v).length+Object.keys(pv).length,styles:Object.keys(styles).length,componentFamilies:Object.keys(components).length}};

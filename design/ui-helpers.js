const page=await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
await Promise.all(['Regular','Medium','Semi Bold','Bold'].map(style=>figma.loadFontAsync({family:'Inter',style})));
const variables=Object.fromEntries(await Promise.all(Object.entries(STATE.variables).map(async([k,id])=>[k,await figma.variables.getVariableByIdAsync(id)])));
const comps=Object.fromEntries(await Promise.all(Object.entries(STATE.components).map(async([k,id])=>[k,await figma.getNodeByIdAsync(id)])));
const primary=await figma.getNodeByIdAsync(STATE.buttonVariants['Style=Primary, State=Default']);
const secondary=await figma.getNodeByIdAsync(STATE.buttonVariants['Style=Secondary, State=Default']);
const ghost=await figma.getNodeByIdAsync(STATE.buttonVariants['Style=Ghost, State=Default']);
const input=await figma.getNodeByIdAsync(STATE.inputVariants['State=Default']);
const links=[],screens={},newRoots=[];
function paint(n,k='bg'){n.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',variables[k])];}
function border(n){n.strokes=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',variables.border)];n.strokeWeight=1;}
function corners(n,r=8){for(const p of ['topLeftRadius','topRightRadius','bottomLeftRadius','bottomRightRadius'])n.setBoundVariable(p,variables['r'+r]);}
function box(parent,name,w,h,dir='VERTICAL',padding=0,gap=16,bg='bg',hug=false){const b=figma.createAutoLayout(dir);b.name=name;parent.appendChild(b);b.resize(w,h);b.primaryAxisSizingMode=hug?'AUTO':'FIXED';b.counterAxisSizingMode='FIXED';for(const p of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])b.setBoundVariable(p,variables['s'+padding]);b.setBoundVariable('itemSpacing',variables['s'+gap]);paint(b,bg);return b;}
function txt(parent,str,style='Body',color='ink',width){const t=figma.createText();t.name=str.slice(0,60);t.textStyleId=STATE.styles[style];t.characters=str;paint(t,color);parent.appendChild(t);if(width){t.textAutoResize='HEIGHT';t.resize(width,t.height);}return t;}
function properties(instance,values){const p={};for(const [name,value]of Object.entries(values)){const key=Object.keys(instance.componentProperties).find(k=>k.split('#')[0]===name);if(key)p[key]=value;}instance.setProperties(p);return instance;}
function instance(parent,name,values={},width){const i=comps[name].createInstance();parent.appendChild(i);properties(i,values);if(width)i.resize(width,i.height);return i;}
function link(n,target){if(target)links.push({id:n.id,target});return n;}
function button(parent,label,target,style='Primary',width=364){const i=(style==='Secondary'?secondary:style==='Ghost'?ghost:primary).createInstance();parent.appendChild(i);properties(i,{Label:label});i.resize(width,52);return link(i,target);}
function field(parent,label,value,hint='',error=false,width=364){const i=input.createInstance();parent.appendChild(i);properties(i,{Label:label,Value:value,Hint:hint});i.resize(width,hint?104:80);i.children[1].resize(width,48);if(!hint)i.children[2].visible=false;if(error){i.children[1].strokeWeight=2;paint(i.children[1],'muted');}return i;}
function banner(parent,title,detail,width=364){return instance(parent,'Banner',{Title:title,Detail:detail},width);}
function badge(parent,label){return instance(parent,'Status',{Label:label});}
function card(parent,title,detail,meta,target,width=364){return link(instance(parent,'Card',{Title:title,Detail:detail,Meta:meta},width),target);}
function stop(parent,title,detail,target,width=364){return link(instance(parent,'Stop timeline item',{Title:title,Detail:detail},width),target);}
function proof(parent,title,detail,target,width=364){return link(instance(parent,'Proof attachment',{Title:title,Detail:detail},width),target);}
function brand(parent,full=false,w){const n=comps[full?'Brand / VHH full':'Brand / Monogram'].createInstance();parent.appendChild(n);const width=w||(full?240:34);n.resize(width,width*(full?.4:240/280));return n;}
function map(parent,w=364,h=200,label='Android GPS · demonstration'){
 const panel=box(parent,'Editable map / '+label,w,h,'VERTICAL',16,8,'muted');corners(panel);
 const svg=figma.createNodeFromSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w-32}" height="${h-80}" viewBox="0 0 800 300"><path fill="#ececec" d="M0 0H800V300H0Z"/><g stroke="#ffffff" stroke-width="22" fill="none"><path d="M-20 20L820 260M-10 260L770 50M90-10L250 310M420-20L580 310M710-10L760 310"/></g><path d="M150 240L310 190L420 135L565 115L660 90" fill="none" stroke="#111111" stroke-width="7" stroke-dasharray="12 6"/><g fill="#111111"><circle cx="150" cy="240" r="12"/><circle cx="420" cy="135" r="12"/><circle cx="660" cy="90" r="14"/></g></svg>`);panel.appendChild(svg);svg.resize(w-32,h-80);txt(panel,label,'Caption','secondary',w-32);return panel;
}
function signature(parent,w=364){const p=box(parent,'Recipient signature / demonstrated',w,144,'VERTICAL',16,8,'muted');corners(p);const svg=figma.createNodeFromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="330" height="70" viewBox="0 0 330 70"><path d="M15 54C32 3 45 13 24 48L63 28L47 51Q80 5 76 46L91 31Q86 58 108 38T132 35L125 50Q148 16 159 37Q151 61 181 35T209 37L197 54Q243 38 289 46" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/></svg>');p.appendChild(svg);svg.resize(w-32,70);txt(p,'Demonstration signature · Nomsa Nkosi','Caption','secondary',w-32);return p;}
function row(parent,values,target,width=1120){const r=instance(parent,'Table row',Object.fromEntries(values.map((v,i)=>['Column '+(i+1),v])),width);for(const t of r.children){if(t.type==='TEXT'){t.textAutoResize='HEIGHT';t.resize((width-80)/4,t.height);}}return link(r,target);}
function heading(parent,title,detail,width=364){txt(parent,title,'H1','ink',width);if(detail)txt(parent,detail,'Small','secondary',width);}
function section(parent,title,detail,width=364){txt(parent,title,'H3','ink',width);if(detail)txt(parent,detail,'Small','secondary',width);}

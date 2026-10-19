await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("3:3"));
const accounts=figma.currentPage.findAllWithCriteria({types:["FRAME"]}).filter(n=>n.name==="Workspace account");
const fonts=new Map();for(const n of accounts){for(const t of n.findAllWithCriteria({types:["TEXT"]}))for(const seg of t.getStyledTextSegments(["fontName"]))fonts.set(JSON.stringify(seg.fontName),seg.fontName);const p=n.parent;if(p?.type==="FRAME")for(const t of p.children.filter(c=>c.type==="TEXT"))for(const seg of t.getStyledTextSegments(["fontName"]))fonts.set(JSON.stringify(seg.fontName),seg.fontName);}
await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
const mutated=[],headers=[];
for(const account of accounts){account.counterAxisAlignItems="CENTER";mutated.push(account.id);const topbar=account.parent;if(topbar.type==="FRAME"&&topbar.name==="Topbar"){topbar.counterAxisAlignItems="CENTER";mutated.push(topbar.id);headers.push({account:account.id,topbar:topbar.id,accountAlignment:account.counterAxisAlignItems,topbarAlignment:topbar.counterAxisAlignItems});}}
const target=await figma.getNodeByIdAsync("52:5885");const title=target.parent.children.find(n=>n.type==="TEXT");const label=target.children.find(n=>n.type==="TEXT"),avatar=target.children.find(n=>n.type==="FRAME");
await target.screenshot({scale:3});await target.parent.screenshot({scale:1});
return{mutatedNodeIds:[...new Set(mutated)],headerCount:headers.length,headers,target:{id:target.id,labelCenter:label.y+label.height/2,avatarCenter:avatar.y+avatar.height/2,breadcrumbCenter:title.y+title.height/2,accountCenter:target.y+target.height/2}};

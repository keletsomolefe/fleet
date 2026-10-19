await figma.setCurrentPageAsync(await figma.getNodeByIdAsync("3:2"));
const ids=["5:1555","5:1659","5:1706","34:2523","34:2596","34:2669"],targets=[];
for(const id of ids){const root=await figma.getNodeByIdAsync(id);const bar=root.children.find(n=>n.name==="Truck context / shown");if(!bar)throw Error("Missing context bar "+id);const t=bar.findAllWithCriteria({types:["TEXT"]}).find(t=>t.characters.includes("current truck"));if(t)targets.push(t);}
for(const t of targets)for(const seg of t.getStyledTextSegments(["fontName"]))await figma.loadFontAsync(seg.fontName);
const mutated=[];
for(const t of targets){t.characters="VHH-012 · assigned truck";mutated.push(t.id);}
const wrong=await figma.getNodeByIdAsync("5:1825");wrong.name="01.08 · wrongTruck / Truck does not match?";mutated.push(wrong.id);
await(await figma.getNodeByIdAsync("69:4196")).screenshot({scale:0.34});
await(await figma.getNodeByIdAsync("5:2889")).screenshot({scale:1});
return{mutatedNodeIds:mutated,assignmentLabelCount:targets.length};

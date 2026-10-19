await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(PAGE_ID));
const reverse=Object.fromEntries(Object.entries(SCREENS).map(([k,id])=>[id,k]));
const nodes=await Promise.all(LINKS.map(l=>figma.getNodeByIdAsync(l.id)));
const missing=LINKS.filter((l,i)=>!nodes[i]);if(missing.length)throw Error('Missing action nodes: '+JSON.stringify(missing));
const ids=[],skipped=[],edges={};let crossRole=0;
for(let i=0;i<LINKS.length;i++){
 const l=LINKS[i],node=nodes[i];let root=node;while(root.parent&&root.parent.type!=='PAGE')root=root.parent;
 const from=reverse[root.id];if(!from)throw Error('Unknown root '+root.id);
 let target=l.target;const text='findAllWithCriteria'in node?node.findAllWithCriteria({types:['TEXT']}).map(t=>t.characters).join(' | '):'';
 if(ROLE==='driver'&&from.startsWith('lerato')){
  if(target==='home')target='leratoHome';if(target==='jobs')target='leratoJobs';if(target==='history')target='leratoHistory';if(target==='more'||target==='handover')target='leratoSession';
 }
 if(ROLE==='admin'){
  if(from==='drivers'&&text.includes('+ Add driver'))target='driverCreate';
  if(from==='staleMap'&&text.includes('Inspect device health'))target='staleDevice';
  if(from==='records'&&text.includes('Fuel ·'))target='fuelDetail';
  if(from==='records'&&text.includes('City Deep ·'))target='loadingDetail';
  if(from==='exceptions'&&text.includes('VHH-1043'))target='signatureReview';
  if((target==='driverDetails'&&!text.includes('Thabo')&&text.includes('LD-008'))||(target==='driverDetails'&&text.includes('SN-021'))||(target==='deviceDetails'&&(text.includes('VHH-013')||text.includes('VHH-014')))||(target==='jobProgress'&&(text.includes('VHH-1043')||text.includes('VHH-1044')))) {skipped.push(node.id);continue;}
 }
 if(target===from){skipped.push(node.id);continue;}
 let action;
 if(target==='ADMIN_ENTRY'||target==='DRIVER_ENTRY'){
  const other=target==='ADMIN_ENTRY'?OTHER_ADMIN:OTHER_DRIVER;
  action={type:'URL',url:`https://www.figma.com/proto/LEbt69of7SErhXVRHps0B3/VHH-Fleet?node-id=${other.replace(':','-')}&starting-point-node-id=${encodeURIComponent(other)}&scaling=contain`,openInNewTab:true};crossRole++;
 }else{
  if(!SCREENS[target])throw Error('Missing destination '+target);
  action={type:'NODE',destinationId:SCREENS[target],navigation:'NAVIGATE',transition:null,resetScrollPosition:true};
 }
 await node.setReactionsAsync([{trigger:{type:'ON_CLICK'},actions:[action]}]);ids.push(node.id);
 if(!edges[from])edges[from]=[];if(!edges[from].includes(target))edges[from].push(target);
}
return {mutatedNodeIds:ids.join(','),wired:ids.length,crossRole,skippedNodeIds:skipped,edges,missingTargets:[]};

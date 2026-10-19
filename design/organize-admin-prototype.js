// Reorder existing screens without changing IDs or existing prototype actions.
const DATA={
  "pageId": "3:3",
  "groups": [
    {
      "name": "01 · Sign in → fleet overview",
      "rows": [
        [
          {
            "key": "adminLogin",
            "id": "7:21",
            "name": "adminLogin / Admin sign in"
          },
          {
            "key": "dashboard",
            "id": "7:106",
            "name": "dashboard / Fleet overview"
          }
        ]
      ]
    },
    {
      "name": "02 · Dispatch → plan → stops → assignment → send",
      "rows": [
        [
          {
            "key": "dispatch",
            "id": "7:203",
            "name": "dispatch / Dispatch board"
          },
          {
            "key": "jobCreate",
            "id": "7:291",
            "name": "jobCreate / Plan a job"
          },
          {
            "key": "stops",
            "id": "7:378",
            "name": "stops / Order the stops"
          }
        ],
        [
          {
            "key": "assignment",
            "id": "7:442",
            "name": "assignment / Assign driver and truck"
          },
          {
            "key": "proofPolicy",
            "id": "7:519",
            "name": "proofPolicy / Choose delivery proof"
          },
          {
            "key": "jobDispatched",
            "id": "7:655",
            "name": "jobDispatched / Job dispatched"
          }
        ],
        [
          {
            "key": "jobProgress",
            "id": "7:719",
            "name": "jobProgress / Job progress"
          },
          {
            "key": "reorderStops",
            "id": "10:1271",
            "name": "reorderStops / Reorder deliveries"
          },
          {
            "key": "cancelJob",
            "id": "7:2076",
            "name": "cancelJob / Discard draft changes?"
          }
        ]
      ]
    },
    {
      "name": "03 · Delivery proof policy · alternate selections",
      "rows": [
        [
          {
            "key": "proofPolicy0",
            "id": "16:1383",
            "name": "proofPolicy0 / Choose delivery proof"
          },
          {
            "key": "proofPolicy1",
            "id": "16:1450",
            "name": "proofPolicy1 / Choose delivery proof"
          },
          {
            "key": "proofPolicy2",
            "id": "16:1517",
            "name": "proofPolicy2 / Choose delivery proof"
          }
        ],
        [
          {
            "key": "proofPolicyAlt",
            "id": "7:588",
            "name": "proofPolicyAlt / Choose delivery proof"
          },
          {
            "key": "proofPolicy4",
            "id": "16:1584",
            "name": "proofPolicy4 / Choose delivery proof"
          },
          {
            "key": "proofPolicy5",
            "id": "16:1651",
            "name": "proofPolicy5 / Choose delivery proof"
          }
        ],
        [
          {
            "key": "proofPolicy6",
            "id": "16:1718",
            "name": "proofPolicy6 / Choose delivery proof"
          }
        ]
      ]
    },
    {
      "name": "04 · Fleet → movement history → location states",
      "rows": [
        [
          {
            "key": "fleet",
            "id": "7:814",
            "name": "fleet / Fleet map"
          },
          {
            "key": "mapHistory",
            "id": "7:895",
            "name": "mapHistory / Truck movement history"
          },
          {
            "key": "trackerMap",
            "id": "7:981",
            "name": "trackerMap / Simulated tracker comparison"
          }
        ],
        [
          {
            "key": "staleMap",
            "id": "7:1049",
            "name": "staleMap / Outdated truck location"
          },
          {
            "key": "staleDevice",
            "id": "10:1203",
            "name": "staleDevice / Outdated device contact"
          }
        ]
      ]
    },
    {
      "name": "05 · Drivers → create → profile → access",
      "rows": [
        [
          {
            "key": "drivers",
            "id": "7:1117",
            "name": "drivers / Drivers"
          },
          {
            "key": "driverCreate",
            "id": "10:917",
            "name": "driverCreate / Add a driver"
          },
          {
            "key": "driverSaved",
            "id": "10:994",
            "name": "driverSaved / Driver added"
          }
        ],
        [
          {
            "key": "driverDetails",
            "id": "7:1194",
            "name": "driverDetails / Driver profile"
          },
          {
            "key": "accessReset",
            "id": "7:1284",
            "name": "accessReset / Manage driver access"
          },
          {
            "key": "driverDeactivated",
            "id": "10:1335",
            "name": "driverDeactivated / Driver access deactivated"
          }
        ]
      ]
    },
    {
      "name": "06 · Trucks → device assignment → details",
      "rows": [
        [
          {
            "key": "trucks",
            "id": "7:1344",
            "name": "trucks / Trucks and devices"
          },
          {
            "key": "truckCreate",
            "id": "10:1060",
            "name": "truckCreate / Add truck and device"
          },
          {
            "key": "truckSaved",
            "id": "10:1137",
            "name": "truckSaved / Truck association created"
          }
        ],
        [
          {
            "key": "deviceDetails",
            "id": "7:1422",
            "name": "deviceDetails / Truck device details"
          }
        ]
      ]
    },
    {
      "name": "07 · Activities → proof → search states",
      "rows": [
        [
          {
            "key": "records",
            "id": "7:1501",
            "name": "records / Activities and proof"
          },
          {
            "key": "proofDetail",
            "id": "7:1592",
            "name": "proofDetail / Delivery proof"
          },
          {
            "key": "fuelDetail",
            "id": "11:1968",
            "name": "fuelDetail / Fuel activity and receipt"
          }
        ],
        [
          {
            "key": "loadingDetail",
            "id": "11:2048",
            "name": "loadingDetail / Loading activity and document"
          },
          {
            "key": "emptySearch",
            "id": "7:2019",
            "name": "emptySearch / Activities and proof"
          }
        ]
      ]
    },
    {
      "name": "08 · Exceptions → review → resolution",
      "rows": [
        [
          {
            "key": "exceptions",
            "id": "7:1668",
            "name": "exceptions / Exceptions"
          },
          {
            "key": "review",
            "id": "7:1738",
            "name": "review / Review delivery exception"
          },
          {
            "key": "resolved",
            "id": "7:1820",
            "name": "resolved / Review recorded"
          }
        ],
        [
          {
            "key": "signatureReview",
            "id": "11:2117",
            "name": "signatureReview / Review signature exception"
          },
          {
            "key": "signatureResolved",
            "id": "11:2197",
            "name": "signatureResolved / Signature review recorded"
          }
        ]
      ]
    },
    {
      "name": "09 · Vehicle reports → acknowledge → resolve",
      "rows": [
        [
          {
            "key": "vehicleReports",
            "id": "36:1631",
            "name": "vehicleReports / Vehicle reports"
          },
          {
            "key": "vehicleReportReview",
            "id": "36:1749",
            "name": "vehicleReportReview / Review vehicle report"
          },
          {
            "key": "vehicleReportAcknowledged",
            "id": "36:1886",
            "name": "vehicleReportAcknowledged / Vehicle report acknowledged"
          }
        ],
        [
          {
            "key": "vehicleReportResolved",
            "id": "36:2023",
            "name": "vehicleReportResolved / Vehicle report resolved"
          }
        ]
      ]
    },
    {
      "name": "10 · Shifts → mileage proof → follow-up",
      "rows": [
        [
          {
            "key": "shiftRecords",
            "id": "36:2158",
            "name": "shiftRecords / Shifts & mileage"
          },
          {
            "key": "shiftDetail",
            "id": "36:2276",
            "name": "shiftDetail / Shift mileage & proof"
          },
          {
            "key": "shiftProofReview",
            "id": "36:2408",
            "name": "shiftProofReview / Review missing odometer proof"
          }
        ],
        [
          {
            "key": "shiftProofResolved",
            "id": "36:2526",
            "name": "shiftProofResolved / Mileage proof follow-up recorded"
          }
        ]
      ]
    },
    {
      "name": "11 · Exports → prepared pack",
      "rows": [
        [
          {
            "key": "exports",
            "id": "7:1877",
            "name": "exports / Extract records and proof"
          },
          {
            "key": "exportReady",
            "id": "7:1955",
            "name": "exportReady / Export pack ready"
          }
        ]
      ]
    }
  ],
  "flows": [
    {
      "nodeId": "7:21",
      "name": "01 · Admin · sign in and overview"
    },
    {
      "nodeId": "7:203",
      "name": "02 · Dispatch · plan, assign and send"
    },
    {
      "nodeId": "16:1383",
      "name": "03 · Delivery proof · selection variants"
    },
    {
      "nodeId": "7:814",
      "name": "04 · Fleet · movement and location states"
    },
    {
      "nodeId": "7:1117",
      "name": "05 · Drivers · create and manage access"
    },
    {
      "nodeId": "7:1344",
      "name": "06 · Trucks · admin device assignment"
    },
    {
      "nodeId": "7:1501",
      "name": "07 · Activities · inspect proof"
    },
    {
      "nodeId": "7:1668",
      "name": "08 · Exceptions · review and resolve"
    },
    {
      "nodeId": "36:1631",
      "name": "09 · Vehicle reports · acknowledge and resolve"
    },
    {
      "nodeId": "36:2158",
      "name": "10 · Shifts · mileage and proof review"
    },
    {
      "nodeId": "7:1877",
      "name": "11 · Exports · prepare demonstration pack"
    }
  ],
  "textEdits": {}
};
const page=await figma.getNodeByIdAsync(DATA.pageId);
await figma.setCurrentPageAsync(page);
const fonts=new Map();
for(const t of page.findAllWithCriteria({types:["TEXT"]})){
  for(const seg of t.getStyledTextSegments(["fontName"]))fonts.set(JSON.stringify(seg.fontName),seg.fontName);
}
await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
const created=[],mutated=[],sections=[],screens=[];
let canvasY=160;
for(const [gi,group] of DATA.groups.entries()){
  let section=page.children.find(n=>n.type==="SECTION"&&n.name===group.name);
  if(!section){section=figma.createSection();created.push(section.id);}
  section.name=group.name;section.x=80;section.y=canvasY;
  section.fills=[{type:"SOLID",color:{r:0.94,g:0.94,b:0.94}}];
  let maxWidth=0,rowY=80,step=0;
  for(const row of group.rows){
    let colX=48,rowHeight=0;
    for(const item of row){
      const node=await figma.getNodeByIdAsync(item.id);
      if(!node||node.type!=="FRAME")throw Error("Missing screen "+item.id);
      section.appendChild(node);node.x=colX;node.y=rowY;
      step++;
      const originalName=item.key==="truck"?"truck / Check assigned truck":item.name;
      node.name=String(gi+1).padStart(2,"0")+"."+String(step).padStart(2,"0")+" · "+originalName;
      mutated.push(node.id);
      screens.push({id:node.id,key:item.key,name:node.name,sectionId:section.id,x:node.x,y:node.y});
      colX+=node.width+120;rowHeight=Math.max(rowHeight,node.height);
    }
    maxWidth=Math.max(maxWidth,colX-120+48);
    rowY+=rowHeight+180;
  }
  section.resizeWithoutConstraints(maxWidth,rowY-180+48);
  mutated.push(section.id);
  sections.push({id:section.id,name:section.name,x:section.x,y:section.y,w:section.width,h:section.height});
  canvasY+=section.height+180;
}
for(const [id,value] of Object.entries(DATA.textEdits)){
 const t=await figma.getNodeByIdAsync(id);
 if(!t||t.type!=="TEXT")throw Error("Missing text "+id);
 // All current fonts were loaded before the first mutation.
 t.characters=value;mutated.push(id);
}
page.flowStartingPoints=DATA.flows;mutated.push(page.id);
return {createdNodeIds:created,mutatedNodeIds:mutated,sections,screens,flowStartingPoints:page.flowStartingPoints};

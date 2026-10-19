// Reorder existing screens without changing IDs or existing prototype actions.
const DATA={
  "pageId": "3:2",
  "groups": [
    {
      "name": "01 · Sign in → check assigned truck → clock in",
      "rows": [
        [
          {
            "key": "login",
            "id": "5:1555",
            "name": "login / Ready for the road."
          },
          {
            "key": "pinSetup",
            "id": "5:1706",
            "name": "pinSetup / Make access simple."
          },
          {
            "key": "truck",
            "id": "5:1785",
            "name": "truck / Confirm your truck"
          },
          {
            "key": "shiftStart",
            "id": "34:2523",
            "name": "shiftStart / Start your shift"
          },
          {
            "key": "shiftStartReady",
            "id": "34:2596",
            "name": "shiftStartReady / Start your shift"
          },
          {
            "key": "home",
            "id": "5:1864",
            "name": "home / Good morning, Thabo."
          }
        ],
        [
          {
            "key": "loginError",
            "id": "5:1659",
            "name": "loginError / Check your details"
          },
          {
            "key": "wrongTruck",
            "id": "5:1825",
            "name": "wrongTruck / Check the truck device"
          },
          {
            "key": "shiftStartMissing",
            "id": "34:2669",
            "name": "shiftStartMissing / Photo unavailable"
          }
        ]
      ]
    },
    {
      "name": "02 · Assigned jobs → loading → delivery",
      "rows": [
        [
          {
            "key": "jobs",
            "id": "5:1909",
            "name": "jobs / Your jobs"
          },
          {
            "key": "job",
            "id": "5:1949",
            "name": "job / Johannesburg → Pretoria"
          },
          {
            "key": "stop",
            "id": "5:1994",
            "name": "stop / City Deep loading point"
          },
          {
            "key": "loading",
            "id": "5:2043",
            "name": "loading / Record loading"
          },
          {
            "key": "loaded",
            "id": "5:2092",
            "name": "loaded / Load recorded."
          }
        ],
        [
          {
            "key": "offload",
            "id": "5:2132",
            "name": "offload / Record offloading"
          },
          {
            "key": "proof",
            "id": "5:2183",
            "name": "proof / Delivery proof"
          },
          {
            "key": "signature",
            "id": "5:2230",
            "name": "signature / Recipient signature"
          },
          {
            "key": "delivered",
            "id": "5:2272",
            "name": "delivered / Delivery recorded."
          }
        ]
      ]
    },
    {
      "name": "03 · Delivery exceptions and recovery",
      "rows": [
        [
          {
            "key": "missingProof",
            "id": "5:2312",
            "name": "missingProof / Proof still required"
          },
          {
            "key": "signatureException",
            "id": "5:2354",
            "name": "signatureException / Signature exception"
          },
          {
            "key": "partial",
            "id": "5:2401",
            "name": "partial / Partial delivery"
          },
          {
            "key": "issueSaved",
            "id": "5:2763",
            "name": "issueSaved / Exception recorded."
          }
        ]
      ]
    },
    {
      "name": "04 · Resume session offline → fuel → sync",
      "rows": [
        [
          {
            "key": "unlock",
            "id": "5:1744",
            "name": "unlock / Welcome back, Thabo."
          },
          {
            "key": "offlineHome",
            "id": "5:2544",
            "name": "offlineHome / Keep moving, Thabo."
          },
          {
            "key": "fuel",
            "id": "5:2450",
            "name": "fuel / Log a fuel stop"
          },
          {
            "key": "fuelSaved",
            "id": "5:2505",
            "name": "fuelSaved / Saved on this truck."
          }
        ],
        [
          {
            "key": "queue",
            "id": "5:2587",
            "name": "queue / Saved and pending"
          },
          {
            "key": "retry",
            "id": "5:2630",
            "name": "retry / One upload needs retry"
          },
          {
            "key": "synced",
            "id": "5:2673",
            "name": "synced / Everything is synced."
          }
        ]
      ]
    },
    {
      "name": "05 · End shift → mileage → receipt",
      "rows": [
        [
          {
            "key": "more",
            "id": "5:2847",
            "name": "more / Your truck session"
          },
          {
            "key": "shiftEnd",
            "id": "34:2739",
            "name": "shiftEnd / End your shift"
          },
          {
            "key": "shiftEndReady",
            "id": "34:2812",
            "name": "shiftEndReady / End your shift"
          },
          {
            "key": "shiftSummary",
            "id": "34:2955",
            "name": "shiftSummary / Shift recorded"
          }
        ],
        [
          {
            "key": "shiftEndMissing",
            "id": "34:2885",
            "name": "shiftEndMissing / Photo unavailable"
          }
        ]
      ]
    },
    {
      "name": "06 · Handover → outgoing mileage → next driver",
      "rows": [
        [
          {
            "key": "handover",
            "id": "5:2889",
            "name": "handover / Change the driver"
          },
          {
            "key": "handoverMileage",
            "id": "34:3025",
            "name": "handoverMileage / End this truck session"
          },
          {
            "key": "prepared",
            "id": "5:2928",
            "name": "prepared / Who is driving?"
          },
          {
            "key": "leratoPin",
            "id": "5:2970",
            "name": "leratoPin / Welcome, Lerato."
          },
          {
            "key": "leratoShiftStart",
            "id": "34:3098",
            "name": "leratoShiftStart / Start your truck session"
          },
          {
            "key": "leratoHome",
            "id": "5:3009",
            "name": "leratoHome / You’re signed in, Lerato."
          }
        ],
        [
          {
            "key": "unprepared",
            "id": "5:3050",
            "name": "unprepared / Connect to sign in"
          }
        ]
      ]
    },
    {
      "name": "07 · Lerato’s jobs, activity and session",
      "rows": [
        [
          {
            "key": "leratoJobs",
            "id": "11:741",
            "name": "leratoJobs / Your jobs"
          },
          {
            "key": "leratoHistory",
            "id": "11:780",
            "name": "leratoHistory / Your activity"
          },
          {
            "key": "leratoSession",
            "id": "11:819",
            "name": "leratoSession / Your truck session"
          },
          {
            "key": "leratoShiftEnd",
            "id": "35:3103",
            "name": "leratoShiftEnd / End your truck session"
          }
        ]
      ]
    },
    {
      "name": "08 · Thabo → vehicle issue → saved → sent",
      "rows": [
        [
          {
            "key": "reportTypes",
            "id": "5:2711",
            "name": "reportTypes / Report a vehicle issue"
          },
          {
            "key": "report_stuck",
            "id": "33:1491",
            "name": "report_stuck / Stuck / bogged down"
          },
          {
            "key": "report_puncture",
            "id": "33:1567",
            "name": "report_puncture / Puncture / tyre problem"
          },
          {
            "key": "report_mechanical",
            "id": "33:1643",
            "name": "report_mechanical / Engine, brakes or vehicle fault"
          },
          {
            "key": "report_blocked",
            "id": "33:1719",
            "name": "report_blocked / Road or access blocked"
          }
        ],
        [
          {
            "key": "report_delay",
            "id": "33:1795",
            "name": "report_delay / Delay / long queue"
          },
          {
            "key": "report_damage",
            "id": "33:1871",
            "name": "report_damage / Damage, load or delivery issue"
          },
          {
            "key": "report_safety",
            "id": "33:1947",
            "name": "report_safety / Accident / safety concern"
          },
          {
            "key": "report_other",
            "id": "33:2023",
            "name": "report_other / Something else"
          }
        ],
        [
          {
            "key": "reportValidation",
            "id": "33:2106",
            "name": "reportValidation / Add a little more detail"
          },
          {
            "key": "reportOtherFilled",
            "id": "55:8930",
            "name": "reportOtherFilled / Something else · details entered"
          },
          {
            "key": "reportQueued",
            "id": "33:2171",
            "name": "reportQueued / Report saved on this device"
          },
          {
            "key": "reportSent",
            "id": "33:2229",
            "name": "reportSent / Sent to operations"
          }
        ]
      ]
    },
    {
      "name": "09 · Lerato → vehicle issue → saved → sent",
      "rows": [
        [
          {
            "key": "leratoReportTypes",
            "id": "33:2550",
            "name": "leratoReportTypes / Report a vehicle issue"
          },
          {
            "key": "leratoReport_stuck",
            "id": "33:2609",
            "name": "leratoReport_stuck / Stuck / bogged down"
          },
          {
            "key": "leratoReport_puncture",
            "id": "33:2676",
            "name": "leratoReport_puncture / Puncture / tyre problem"
          },
          {
            "key": "leratoReport_mechanical",
            "id": "33:2743",
            "name": "leratoReport_mechanical / Engine, brakes or vehicle fault"
          },
          {
            "key": "leratoReport_blocked",
            "id": "33:2810",
            "name": "leratoReport_blocked / Road or access blocked"
          }
        ],
        [
          {
            "key": "leratoReport_delay",
            "id": "33:2877",
            "name": "leratoReport_delay / Delay / long queue"
          },
          {
            "key": "leratoReport_damage",
            "id": "33:2944",
            "name": "leratoReport_damage / Damage, load or delivery issue"
          },
          {
            "key": "leratoReport_safety",
            "id": "33:3011",
            "name": "leratoReport_safety / Accident / safety concern"
          },
          {
            "key": "leratoReport_other",
            "id": "33:3078",
            "name": "leratoReport_other / Something else"
          }
        ],
        [
          {
            "key": "leratoReportValidation",
            "id": "33:3152",
            "name": "leratoReportValidation / Add a little more detail"
          },
          {
            "key": "leratoReportOtherFilled",
            "id": "55:9025",
            "name": "leratoReportOtherFilled / Something else · details entered"
          },
          {
            "key": "leratoReportQueued",
            "id": "33:3208",
            "name": "leratoReportQueued / Report saved on this device"
          },
          {
            "key": "leratoReportSent",
            "id": "33:3257",
            "name": "leratoReportSent / Sent to operations"
          }
        ]
      ]
    },
    {
      "name": "10 · Activity, vehicle records and scroll state",
      "rows": [
        [
          {
            "key": "history",
            "id": "5:2801",
            "name": "history / Your activity"
          },
          {
            "key": "shiftVehicleHistory",
            "id": "35:3026",
            "name": "shiftVehicleHistory / Shift & vehicle records"
          },
          {
            "key": "vehicleReportDetail",
            "id": "35:2945",
            "name": "vehicleReportDetail / Vehicle issue report"
          },
          {
            "key": "homeScrolled",
            "id": "38:4158",
            "name": "homeScrolled / Today · truck context hidden"
          }
        ]
      ]
    }
  ],
  "flows": [
    {
      "nodeId": "5:1555",
      "name": "01 · Full driver journey · sign in to delivery"
    },
    {
      "nodeId": "5:1785",
      "name": "02 · Check assigned truck · match or report mismatch"
    },
    {
      "nodeId": "5:1909",
      "name": "03 · Jobs · loading and delivery"
    },
    {
      "nodeId": "5:1744",
      "name": "04 · Resume active session offline · fuel and sync"
    },
    {
      "nodeId": "5:2847",
      "name": "05 · End shift · mileage and receipt"
    },
    {
      "nodeId": "5:2889",
      "name": "06 · Handover · Thabo to Lerato"
    },
    {
      "nodeId": "5:3009",
      "name": "07 · Lerato · jobs, activity and session"
    },
    {
      "nodeId": "5:2711",
      "name": "08 · Thabo · vehicle issue and custom report"
    },
    {
      "nodeId": "33:2550",
      "name": "09 · Lerato · vehicle issue and custom report"
    },
    {
      "nodeId": "5:2801",
      "name": "10 · Activity · shift and vehicle records"
    },
    {
      "nodeId": "38:4158",
      "name": "11 · Today · truck bar collapsed"
    }
  ],
  "textEdits": {
    "5:1803": "Check assigned truck",
    "5:1804": "This device is assigned to VHH-012.",
    "I38:3887;37:206": "VHH-012 · assigned truck",
    "I5:1805;3:70": "Assigned by admin · VHH-TAB-012",
    "5:1810": "Check that this registration matches the truck you are in. Only your fleet administrator can change the device assignment.",
    "I5:1812;3:39": "Continue to clock-in",
    "5:1843": "Truck does not match?",
    "5:1844": "Do not start a session on the wrong truck.",
    "I38:3891;37:206": "VHH-012 · assigned truck",
    "I5:1845;3:75": "Ask operations to check this device’s truck assignment.",
    "I5:1851;3:39": "Check assigned truck",
    "5:1763": "Resume your session · VHH-012",
    "I5:1764;3:75": "Your session is already active on this truck.",
    "I5:2915;3:39": "Continue to handover mileage"
  }
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
      colX+=node.width+80;rowHeight=Math.max(rowHeight,node.height);
    }
    maxWidth=Math.max(maxWidth,colX-80+48);
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

// Run in LEbt69of7SErhXVRHps0B3 using the Figma Plugin API.
// A shared 3:4 diagonal grid gives every cut a 4-unit perpendicular gap.
// Stems are 17 units wide, with symmetric 31 / 16 / 31 spacing.
const polygons = [
  [[2,267],[23,267],[82,364.5],[185,287.25],[185,347.75],[168,360.5],[168,326.5],[78,394]],
  [[120,260],[137,247.25],[137,318.25],[120,331]],
  [[168,224],[185,211.25],[185,282.25],[168,295]],
  [[201,279.25],[218,266.5],[218,296.5],[249,273.25],[249,243.25],[266,230.5],[266,357.5],[249,370.25],[249,299.75],[201,335.75]],
  [[120,367.5],[137,354.75],[137,388.75],[218,328],[218,393.5],[201,406.25],[201,367.25],[120,428]],
];
const masters = [
  { scale: 0.5, ids: ['4:25','4:26','4:27','4:28','4:29'] },
  { scale: 0.25, ids: ['4:83','4:84','4:85','4:86','4:87'] },
];
const mutatedNodeIds = [];
for (const { scale, ids } of masters) {
  for (let index = 0; index < polygons.length; index++) {
    const points = polygons[index];
    const minX = Math.min(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1]));
    const data = points.map(([x,y], i) => `${i ? 'L' : 'M'} ${(x-minX)*scale} ${(y-minY)*scale}`).join(' ') + ' Z';
    const node = await figma.getNodeByIdAsync(ids[index]);
    node.vectorPaths = [{ windingRule: 'NONZERO', data }];
    node.x = minX * scale;
    node.y = (minY - 200) * scale;
    mutatedNodeIds.push(node.id);
  }
}
return { mutatedNodeIds };

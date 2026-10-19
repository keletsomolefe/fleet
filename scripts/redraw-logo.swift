import Foundation
import CoreText
import CoreGraphics
let out = CommandLine.arguments[1]
func n(_ v: CGFloat) -> String { String(format:"%.3f",Double(v)) }
func outline(_ text:String, _ fontSize:CGFloat, _ x:CGFloat, _ baseline:CGFloat, _ tracking:CGFloat, _ id:String) -> String {
 let font=CTFontCreateWithName("ArialMT" as CFString,fontSize,nil)
 var cursor=x; var result="<g id=\"\(id)\">"
 for u in text.utf16 {
  var c=u; var g:CGGlyph=0
  CTFontGetGlyphsForCharacters(font,&c,&g,1)
  var advance=CGSize.zero
  CTFontGetAdvancesForGlyphs(font,.horizontal,&g,&advance,1)
  if let path=CTFontCreatePathForGlyph(font,g,nil) {
   var d=""
   path.applyWithBlock { pointer in
    let e=pointer.pointee
    func p(_ i:Int)->String { "\(n(cursor+e.points[i].x)) \(n(baseline-e.points[i].y))" }
    switch e.type {
    case .moveToPoint: d += "M\(p(0))"
    case .addLineToPoint: d += "L\(p(0))"
    case .addQuadCurveToPoint: d += "Q\(p(0)) \(p(1))"
    case .addCurveToPoint: d += "C\(p(0)) \(p(1)) \(p(2))"
    case .closeSubpath: d += "Z"
    @unknown default: break
    }
   }
   result += "<path d=\"\(d)\"/>"
  }
  cursor += advance.width+tracking
 }
 return result+"</g>"
}
let monogram="""
<g id="monogram">
<path d="M2 267H23L82 364.5L185 287.25V347.75L168 360.5V326.5L78 394Z"/>
<path d="M120 260L137 247.25V318.25L120 331Z"/>
<path d="M168 224L185 211.25V282.25L168 295Z"/>
<path d="M201 279.25L218 266.5V296.5L249 273.25V243.25L266 230.5V357.5L249 370.25V299.75L201 335.75Z"/>
<path d="M120 367.5L137 354.75V388.75L218 328V393.5L201 406.25V367.25L120 428Z"/>
</g>
"""
let wordmark="""
<g id="wordmark">
<path d="M358 247H372L393 299L414 247H428L400 315H386Z"/>
<path d="M451 247H464V275H495V247H508V315H495V287H464V315H451Z"/>
<path d="M539 247H552V275H583V247H596V315H583V287H552V315H539Z"/>
</g>
"""
let lettering=outline("GROUP",38,355,361,27,"group-lettering")+outline("DRIVEN BY VALUE.",17,378,414,1.7,"tagline-first")+outline("DELIVERING EXCELLENCE.",17,350,437,1.3,"tagline-second")
let full=monogram+"<path id=\"divider\" d=\"M309 230H311V446H309Z\"/>"+wordmark+lettering+"<path id=\"rule\" d=\"M351 380H603V382H351Z\"/>"
func svg(_ body:String,_ box:String,_ width:Int,_ height:Int,_ inverse:Bool=false)->String {
 "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"\(width)\" height=\"\(height)\" viewBox=\"\(box)\"><title>VHH Group</title><g fill=\"\(inverse ? "#ffffff" : "#000000")\">\(body)</g></svg>"
}
let outputs=["vhh-full-vector.svg":svg(full,"0 0 640 640",640,640),"vhh-lockup-vector.svg":svg(full,"0 200 640 256",640,256),"vhh-monogram-vector.svg":svg(monogram,"0 200 280 240",280,240),"vhh-inverse-vector.svg":svg(full,"0 200 640 256",640,256,true)]
for (name,content) in outputs { try content.write(toFile:out+"/"+name,atomically:true,encoding:.utf8) }
print("Created \(outputs.count) outlined SVG masters")
